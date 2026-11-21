import { google } from 'googleapis';

export interface CouponRecord {
  code: string;
  discountPercent: number;
  active: boolean;
  partnerName: string;
  expiresAt: string;
}

export interface CouponValidationResult {
  valid: boolean;
  code?: string;
  discountPercent?: number;
  partnerName?: string;
  error?: string;
}

const SHEET_TAB = 'COUPONS';
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes so newly created partner codes go live quickly

let couponsCache: { data: Map<string, CouponRecord>; expiresAt: number } | null = null;
let pendingFetch: Promise<Map<string, CouponRecord>> | null = null;
let tabVerified = false;

function getEnv(name: string): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const fromImportMeta = (import.meta as any)?.env?.[name];
  return String(fromProcess || fromImportMeta || '').trim();
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

async function ensureCouponsTab(sheets: any, spreadsheetId: string): Promise<void> {
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
      range: `${SHEET_TAB}!A1:E2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['code', 'discount_percent', 'active', 'partner_name', 'expires_at'],
          ['EXAMPLE10', '10', 'FALSE', 'Example Partner (set active to TRUE to enable)', ''],
        ],
      },
    });
  }

  tabVerified = true;
}

function parseActiveFlag(raw: any): boolean {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return true; // If left blank, treat as active
  return !['FALSE', 'NO', '0', 'INACTIVE', 'OFF', 'N'].includes(s);
}

function parsePercent(raw: any): number {
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0 || num > 90) return 0;
  return Math.round(num * 100) / 100;
}

function getBogotaDateString(): string {
  // America/Bogota is UTC-5 year-round
  const bogotaMs = Date.now() - 5 * 60 * 60 * 1000;
  return new Date(bogotaMs).toISOString().slice(0, 10);
}

export async function getCouponsMap(forceRefresh = false): Promise<Map<string, CouponRecord>> {
  const now = Date.now();
  if (!forceRefresh && couponsCache && now < couponsCache.expiresAt) {
    return couponsCache.data;
  }

  if (pendingFetch && !forceRefresh) {
    return pendingFetch;
  }

  pendingFetch = (async () => {
    const client = getSheetsClient();
    if (!client) {
      return new Map<string, CouponRecord>();
    }

    try {
      const { sheets, spreadsheetId } = client;
      await ensureCouponsTab(sheets, spreadsheetId);

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_TAB}!A:E`,
      });

      const rows = res.data.values || [];
      const map = new Map<string, CouponRecord>();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;

        const code = String(row[0]).trim().toUpperCase();
        const discountPercent = parsePercent(row[1]);
        const active = parseActiveFlag(row[2]);
        const partnerName = String(row[3] || '').trim();
        const expiresAt = String(row[4] || '').trim();

        if (code && discountPercent > 0) {
          map.set(code, {
            code,
            discountPercent,
            active,
            partnerName,
            expiresAt,
          });
        }
      }

      couponsCache = {
        data: map,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return map;
    } catch (err: any) {
      console.warn('Could not read COUPONS from Google Sheets:', err?.message || err);
      return couponsCache?.data || new Map<string, CouponRecord>();
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

export async function validateCouponCode(rawCode: string): Promise<CouponValidationResult> {
  const normalized = String(rawCode || '').trim().toUpperCase();
  if (!normalized || normalized.length > 40) {
    return { valid: false, error: 'Please enter a valid promo code.' };
  }

  let map = await getCouponsMap(false);
  let record = map.get(normalized);

  // If not found in cache, do one fresh lookup in case Juan Camilo just added it in Google Sheets
  if (!record) {
    map = await getCouponsMap(true);
    record = map.get(normalized);
  }

  if (!record || !record.active) {
    return { valid: false, error: 'This promo code is not valid or is no longer active.' };
  }

  if (record.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(record.expiresAt)) {
    const todayBogota = getBogotaDateString();
    if (record.expiresAt < todayBogota) {
      return { valid: false, error: 'This promo code has expired.' };
    }
  }

  return {
    valid: true,
    code: record.code,
    discountPercent: record.discountPercent,
    partnerName: record.partnerName,
  };
}
