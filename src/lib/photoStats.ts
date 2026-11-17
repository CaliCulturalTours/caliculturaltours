import { google } from 'googleapis';
import content from '../data/site_content_skeleton.json';

export interface PhotoMetric {
  thumbClicks: number;
  lightboxOpens: number;
  dwellViews: number;
  score: number;
  lastUpdated: string;
}

export type PhotoStatsMap = Record<string, Record<string, PhotoMetric>>;

export interface IncomingPhotoEvent {
  photo: string;
  thumbClick?: number;
  lightboxOpen?: number;
  dwellView?: number;
}

const SHEET_TAB = 'PHOTO_STATS';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in-memory cache
const MIN_HERO_SCORE = 6; // Require >= 6 pts before promoting a photo to #1 hero

let statsCache: { data: PhotoStatsMap; expiresAt: number } | null = null;
let pendingFetch: Promise<PhotoStatsMap> | null = null;
let tabVerified = false;

function getEnv(name: string): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const fromImportMeta = (import.meta as any)?.env?.[name];
  return String(fromProcess || fromImportMeta || '').trim();
}

export function normalizePhotoPath(rawPath: string): string {
  let clean = String(rawPath || '').trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Keep original if malformed URI sequence
  }
  clean = clean.replace(/^https?:\/\/[^/]+/i, '');
  clean = clean.replace(/^\/+/, '');
  return clean;
}

export function computePhotoScore(m: {
  thumbClicks: number;
  lightboxOpens: number;
  dwellViews: number;
}): number {
  return m.thumbClicks * 1 + m.dwellViews * 2 + m.lightboxOpens * 4;
}

export function getTourCandidatePhotos(tour: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const rawList = [tour?.image, ...(Array.isArray(tour?.gallery) ? tour.gallery : [])];
  for (const item of rawList) {
    if (!item) continue;
    const norm = normalizePhotoPath(String(item));
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function getValidTourPhotosMap(): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const tour of content.tours as any[]) {
    map[tour.id] = new Set(getTourCandidatePhotos(tour));
  }
  return map;
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

async function ensurePhotoStatsTab(sheets: any, spreadsheetId: string): Promise<void> {
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
          ['tour_id', 'photo_path', 'thumb_clicks', 'lightbox_opens', 'dwell_views', 'last_updated'],
        ],
      },
    });
  }

  tabVerified = true;
}

export function invalidatePhotoStatsCache(): void {
  statsCache = null;
}

export async function getPhotoStatsMap(): Promise<PhotoStatsMap> {
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
        // Tab might not exist yet before the first photo click
        return {};
      }

      const map: PhotoStatsMap = {};
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0] || !row[1]) continue;

        const tourId = String(row[0]).trim();
        const photoPath = normalizePhotoPath(String(row[1]));
        const thumbClicks = Math.max(0, Number(row[2]) || 0);
        const lightboxOpens = Math.max(0, Number(row[3]) || 0);
        const dwellViews = Math.max(0, Number(row[4]) || 0);
        const lastUpdated = String(row[5] || '');

        if (!map[tourId]) map[tourId] = {};
        map[tourId][photoPath] = {
          thumbClicks,
          lightboxOpens,
          dwellViews,
          score: computePhotoScore({ thumbClicks, lightboxOpens, dwellViews }),
          lastUpdated,
        };
      }

      statsCache = {
        data: map,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };

      return map;
    } catch (err: any) {
      console.warn('Could not read PHOTO_STATS from Google Sheets:', err?.message || err);
      return statsCache?.data || {};
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

export function rankTourGallery(tour: any, statsMap: PhotoStatsMap) {
  const candidates = getTourCandidatePhotos(tour);
  if (candidates.length === 0) {
    return {
      heroImage: '',
      gallery: [] as string[],
      rankedMetrics: [] as Array<{ photo: string; score: number; thumbClicks: number; lightboxOpens: number; dwellViews: number }>,
    };
  }

  const tourStats = statsMap[tour.id] || {};
  const defaultHero = normalizePhotoPath(String(tour.image || candidates[0]));
  const defaultScore = tourStats[defaultHero]?.score || 0;

  const scored = candidates.map((photo, originalIndex) => {
    const m = tourStats[photo] || {
      thumbClicks: 0,
      lightboxOpens: 0,
      dwellViews: 0,
      score: 0,
      lastUpdated: '',
    };
    return { photo, originalIndex, ...m };
  });

  // Highest scoring photo across all candidates (ties prefer earlier original order)
  const sortedByScore = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  const topCandidate = sortedByScore[0];
  const shouldPromoteTop =
    topCandidate.photo !== defaultHero &&
    topCandidate.score >= MIN_HERO_SCORE &&
    topCandidate.score > defaultScore;

  const heroEntry = shouldPromoteTop
    ? topCandidate
    : scored.find((s) => s.photo === defaultHero) || scored[0];

  const remaining = sortedByScore.filter((s) => s.photo !== heroEntry.photo);
  const finalRanked = [heroEntry, ...remaining];

  return {
    heroImage: heroEntry.photo,
    gallery: finalRanked.map((s) => s.photo),
    rankedMetrics: finalRanked.map(({ photo, score, thumbClicks, lightboxOpens, dwellViews }) => ({
      photo,
      score,
      thumbClicks,
      lightboxOpens,
      dwellViews,
    })),
  };
}

export async function recordPhotoEvents(
  tourId: string,
  events: IncomingPhotoEvent[]
): Promise<{ updated: number; inserted: number; skipped?: boolean }> {
  const client = getSheetsClient();
  if (!client) {
    return { updated: 0, inserted: 0, skipped: true };
  }

  const { sheets, spreadsheetId } = client;
  await ensurePhotoStatsTab(sheets, spreadsheetId);

  // Merge incoming deltas per photo
  const deltas = new Map<string, { thumb: number; lightbox: number; dwell: number }>();
  for (const ev of events) {
    const photo = normalizePhotoPath(ev.photo);
    if (!photo) continue;
    const prev = deltas.get(photo) || { thumb: 0, lightbox: 0, dwell: 0 };
    prev.thumb = Math.min(1, prev.thumb + Math.max(0, Number(ev.thumbClick) || 0));
    prev.lightbox = Math.min(1, prev.lightbox + Math.max(0, Number(ev.lightboxOpen) || 0));
    prev.dwell = Math.min(1, prev.dwell + Math.max(0, Number(ev.dwellView) || 0));
    if (prev.thumb + prev.lightbox + prev.dwell > 0) {
      deltas.set(photo, prev);
    }
  }

  if (deltas.size === 0) {
    return { updated: 0, inserted: 0 };
  }

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB}!A:F`,
  });

  const rows = existingRes.data.values || [];
  const rowIndexMap = new Map<
    string,
    { rowNumber: number; thumb: number; lightbox: number; dwell: number }
  >();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0] || !row[1]) continue;
    const key = `${String(row[0]).trim()}:::${normalizePhotoPath(String(row[1]))}`;
    rowIndexMap.set(key, {
      rowNumber: i + 1,
      thumb: Number(row[2]) || 0,
      lightbox: Number(row[3]) || 0,
      dwell: Number(row[4]) || 0,
    });
  }

  const nowIso = new Date().toISOString();
  const batchUpdates: Array<{ range: string; values: any[][] }> = [];
  const newRows: any[][] = [];

  for (const [photo, delta] of deltas.entries()) {
    const key = `${tourId}:::${photo}`;
    const existing = rowIndexMap.get(key);

    if (existing) {
      batchUpdates.push({
        range: `${SHEET_TAB}!C${existing.rowNumber}:F${existing.rowNumber}`,
        values: [[
          existing.thumb + delta.thumb,
          existing.lightbox + delta.lightbox,
          existing.dwell + delta.dwell,
          nowIso,
        ]],
      });
    } else {
      newRows.push([
        tourId,
        photo,
        delta.thumb,
        delta.lightbox,
        delta.dwell,
        nowIso,
      ]);
    }
  }

  if (batchUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchUpdates,
      },
    });
  }

  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_TAB}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: newRows,
      },
    });
  }

  invalidatePhotoStatsCache();
  return { updated: batchUpdates.length, inserted: newRows.length };
}
