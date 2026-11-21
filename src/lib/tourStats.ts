import { google } from 'googleapis';
import content from '../data/site_content_skeleton.json';

export interface TourMetric {
  tourId: string;
  views: number;
  guideReferrals: number;
  bookClicks: number;
  score: number;
  lastUpdated: string;
}

export type TourStatsMap = Record<string, TourMetric>;

const SHEET_TAB = 'TOUR_STATS';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in-memory cache
const MIN_PROVEN_SCORE = 5; // Minimum weighted points to lock into popularity ranking

let statsCache: { data: TourStatsMap; expiresAt: number } | null = null;
let pendingFetch: Promise<TourStatsMap> | null = null;
let tabVerified = false;

function getEnv(name: string): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const fromImportMeta = (import.meta as any)?.env?.[name];
  return String(fromProcess || fromImportMeta || '').trim();
}

export function computeTourScore(views: number, bookClicks: number): number {
  return views * 1 + bookClicks * 3;
}

export function getValidTourIds(): Set<string> {
  return new Set((content.tours as any[]).map((t) => String(t.id)));
}

function getSheetsClient() {
  const clientEmail = getEnv('GOOGLE_CLIENT_EMAIL');
  const rawKey = getEnv('GOOGLE_PRIVATE_KEY');
  const spreadsheetId = getEnv('GOOGLE_SHEET_ID');

  if (!clientEmail || !rawKey || !spreadsheetId) {
    return null;
  }

  const privateKey = rawKey.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, spreadsheetId };
}

async function ensureTourStatsTab(sheets: any, spreadsheetId: string): Promise<void> {
  if (tabVerified) return;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });

  const exists = (meta.data.sheets || []).some(
    (s: any) => s.properties?.title === SHEET_TAB
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_TAB } } }],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TAB}!A1:F1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['tour_id', 'views', 'guide_referrals', 'book_clicks', 'score', 'last_updated'],
        ],
      },
    });
  }

  tabVerified = true;
}

export function invalidateTourStatsCache(): void {
  statsCache = null;
}

export async function getTourStatsMap(): Promise<TourStatsMap> {
  const now = Date.now();
  if (statsCache && now < statsCache.expiresAt) {
    return statsCache.data;
  }

  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = (async () => {
    const client = getSheetsClient();
    if (!client) {
      return {};
    }

    try {
      const { sheets, spreadsheetId } = client;
      let rows: any[][] = [];

      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${SHEET_TAB}!A:F`,
        });
        rows = res.data.values || [];
      } catch {
        // Tab not yet created before the first tracked tour visit
        return {};
      }

      const map: TourStatsMap = {};
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;

        const tourId = String(row[0]).trim();
        const views = Math.max(0, Number(row[1]) || 0);
        const guideReferrals = Math.max(0, Number(row[2]) || 0);
        const bookClicks = Math.max(0, Number(row[3]) || 0);
        const lastUpdated = String(row[5] || '');

        map[tourId] = {
          tourId,
          views,
          guideReferrals,
          bookClicks,
          score: computeTourScore(views, bookClicks),
          lastUpdated,
        };
      }

      statsCache = {
        data: map,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return map;
    } catch (err: any) {
      console.warn('Could not read TOUR_STATS from Google Sheets:', err?.message || err);
      return statsCache?.data || {};
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

// Deterministic seeded PRNG (Mulberry32) so catalog order stays consistent within each 1-hour window
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Progressive Exploration + Global Popularity Ordering for /tours:
 * - Before enough data exists (score < 5), tours rotate cleanly every hour so all tours get fair top visibility.
 * - As tours accumulate global views (from /tours, Travel Guides, Google, ChatGPT Ads, WhatsApp) and book clicks,
 *   proven winners rise automatically to the top sorted by score = views + 3 * bookClicks.
 * - Once 4+ tours are proven winners, slot #4 acts as a gentle hourly discovery slot for less-seen/new tours
 *   so no tour stays permanently buried.
 */
export function rankToursForCatalog<T extends { id: string }>(
  tours: T[],
  statsMap: TourStatsMap,
  nowMs = Date.now()
): T[] {
  if (!Array.isArray(tours) || tours.length <= 1) return [...(tours || [])];

  const hourBucket = Math.floor(nowMs / (60 * 60 * 1000));

  // Assign an hourly tie-breaker key to each tour
  const shuffledBase = seededShuffle(tours, hourBucket ^ 0x9e3779b9);
  const tieOrder = new Map<string, number>();
  shuffledBase.forEach((t, idx) => tieOrder.set(t.id, idx));

  const proven: T[] = [];
  const exploring: T[] = [];

  for (const tour of tours) {
    const score = statsMap[tour.id]?.score || 0;
    if (score >= MIN_PROVEN_SCORE) {
      proven.push(tour);
    } else {
      exploring.push(tour);
    }
  }

  // Sort proven winners by global popularity descending (hourly random tie-break)
  proven.sort((a, b) => {
    const scoreA = statsMap[a.id]?.score || 0;
    const scoreB = statsMap[b.id]?.score || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (tieOrder.get(a.id) ?? 0) - (tieOrder.get(b.id) ?? 0);
  });

  // Shuffle exploring tours fairly every hour
  const shuffledExploring = seededShuffle(exploring, hourBucket ^ 0x85ebca6b);

  // If fewer than 4 proven winners, simply put proven winners first followed by hourly shuffled explorers
  if (proven.length < 4) {
    return [...proven, ...shuffledExploring];
  }

  // Mature state: Top 3 are pure global popularity winners; slot #4 rotates hourly from explorers or lower-half tours
  const top3 = proven.slice(0, 3);
  const restProven = proven.slice(3);

  const discoveryPool =
    shuffledExploring.length > 0
      ? shuffledExploring
      : restProven.slice(Math.floor(restProven.length / 2));

  const discoveryTour =
    discoveryPool.length > 0
      ? discoveryPool[hourBucket % discoveryPool.length]
      : null;

  const remainingRest = [
    ...restProven.filter((t) => !discoveryTour || t.id !== discoveryTour.id),
    ...shuffledExploring.filter((t) => !discoveryTour || t.id !== discoveryTour.id),
  ];

  return discoveryTour
    ? [...top3, discoveryTour, ...remainingRest]
    : [...top3, ...remainingRest];
}

export async function recordTourEvent(params: {
  tourId: string;
  view?: number;
  bookClick?: number;
  fromGuide?: boolean;
}): Promise<{ updated: boolean; inserted: boolean; skipped?: boolean }> {
  const client = getSheetsClient();
  if (!client) {
    return { updated: false, inserted: false, skipped: true };
  }

  const addView = params.view ? 1 : 0;
  const addGuide = addView && params.fromGuide ? 1 : 0;
  const addBook = params.bookClick ? 1 : 0;

  if (addView + addBook === 0) {
    return { updated: false, inserted: false };
  }

  const { sheets, spreadsheetId } = client;
  await ensureTourStatsTab(sheets, spreadsheetId);

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB}!A:F`,
  });

  const rows = existingRes.data.values || [];
  let matchRowNumber = -1;
  let prevViews = 0;
  let prevGuide = 0;
  let prevBook = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && String(row[0]).trim() === params.tourId) {
      matchRowNumber = i + 1;
      prevViews = Number(row[1]) || 0;
      prevGuide = Number(row[2]) || 0;
      prevBook = Number(row[3]) || 0;
      break;
    }
  }

  const newViews = prevViews + addView;
  const newGuide = prevGuide + addGuide;
  const newBook = prevBook + addBook;
  const newScore = computeTourScore(newViews, newBook);
  const nowIso = new Date().toISOString();

  if (matchRowNumber !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TAB}!B${matchRowNumber}:F${matchRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[newViews, newGuide, newBook, newScore, nowIso]],
      },
    });
    invalidateTourStatsCache();
    return { updated: true, inserted: false };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_TAB}!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[params.tourId, newViews, newGuide, newBook, newScore, nowIso]],
    },
  });

  invalidateTourStatsCache();
  return { updated: false, inserted: true };
}
