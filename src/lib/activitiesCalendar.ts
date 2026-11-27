import { google } from 'googleapis';

export type ActivityCategory = 'salsa' | 'wellness' | 'culture';

export interface ActivityEvent {
  id: string;
  summary: string;
  cleanTitle: string;
  startIso: string; // ISO string with -05:00 offset, e.g. 2026-11-27T15:00:00-05:00
  endIso: string;
  dateKey: string; // YYYY-MM-DD in America/Bogota
  startTimeLabel: string; // e.g. "3:00 PM"
  endTimeLabel: string; // e.g. "4:30 PM"
  startMinutes: number; // minutes from midnight (0..1439) for sorting & live status
  endMinutes: number;
  location: string;
  shortVenue: string;
  descriptionHtml: string;
  descriptionPlain: string;
  isFree: boolean;
  isFeatured: boolean;
  category: ActivityCategory;
  mapsUrl: string;
  addToCalendarUrl: string;
}

export interface ActivityDayGroup {
  dateKey: string; // YYYY-MM-DD
  weekdayShort: string; // "Fri"
  weekdayLong: string; // "Friday"
  dayNum: string; // "27"
  monthShort: string; // "Nov"
  isToday: boolean;
  isTomorrow: boolean;
  events: ActivityEvent[];
}

export const ACTIVITIES_CALENDAR_ID =
  'e36bf6f2b2e2451f1c72fc6e9f9f6dc5ca390232df6522eeeb90f456c6c97687@group.calendar.google.com';

export const PUBLIC_ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
  ACTIVITIES_CALENDAR_ID
)}/public/basic.ics`;

export const SUBSCRIBE_CALENDAR_URL = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(
  ACTIVITIES_CALENDAR_ID
)}`;

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; // America/Bogota is UTC-5 year-round
const CACHE_TTL_MS = 15 * 60 * 1000; // 15-minute server memory cache
const WINDOW_DAYS = 14;

let calendarCache: {
  todayKey: string;
  days: ActivityDayGroup[];
  expiresAt: number;
} | null = null;

function getEnv(name: string): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const fromImportMeta = (import.meta as any)?.env?.[name];
  return String(fromProcess || fromImportMeta || '').trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function getBogotaNowParts(nowMs = Date.now()) {
  const d = new Date(nowMs - BOGOTA_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dateKey: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
  };
}

function addDaysToDateKey(dateKey: string, offsetDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function getWeekdayCode(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][dow];
}

function formatTime12h(hour24: number, minute: number): string {
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${h12}:00 ${period}` : `${h12}:${pad2(minute)} ${period}`;
}

function dateKeyToUtcMs(dateKey: string, hour: number, minute: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, minute, 0) + BOGOTA_OFFSET_MS;
}

function utcMsToBogotaParts(utcMs: number) {
  const d = new Date(utcMs - BOGOTA_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
  const iso = `${dateKey}T${pad2(hour)}:${pad2(minute)}:00-05:00`;
  return { year, month, day, hour, minute, dateKey, iso };
}

function classifyEvent(summary: string, plainDesc: string): {
  category: ActivityCategory;
  isFree: boolean;
  isFeatured: boolean;
} {
  const combined = `${summary} ${plainDesc}`;
  const isFree =
    /\*free\*|🆓|\bfree\b|\bgratis\b|free entry|free entrance|tip[\s-]based/i.test(combined);
  const isFeatured = /⭐|★/.test(summary);

  let category: ActivityCategory = 'culture';
  if (
    /salsa|bachata|danc|baile|bailar|folcl|rumba|topa|cha\s*cha|bolero|live music|concert|jazz|jam|💃|🕺|🎼|🎺|🎸|🎤/i.test(
      summary
    )
  ) {
    category = 'salsa';
  } else if (
    /yoga|hike|hiking|crosses|cruces|capoeira|run\b|running|bike|cycling|climb|pilates|swim|nature|river|pance|aerorumba|🧘|🥾|⛰️|🚵|🏃|🏞️/i.test(
      summary
    )
  ) {
    category = 'wellness';
  }

  return { category, isFree, isFeatured };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTagsToPlain(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Safely renders Google Calendar descriptions into clean HTML with clickable
 * web, Instagram (@handle), and WhatsApp links without risking XSS.
 */
function sanitizeAndLinkifyDescription(raw: string): { html: string; plain: string } {
  if (!raw) return { html: '', plain: '' };

  // Preserve existing <a href="https?://...">text</a> anchors safely before escaping
  const preservedLinks: Array<{ placeholder: string; html: string }> = [];
  let working = raw
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/&nbsp;/gi, ' ');

  working = working.replace(
    /<a\s+[^>]*href=["'](https?:\/\/[^"'\s<>]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, label) => {
      const cleanLabel = stripTagsToPlain(label) || href;
      const placeholder = `__CAL_LINK_${preservedLinks.length}__`;
      preservedLinks.push({
        placeholder,
        html: `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          cleanLabel
        )}</a>`,
      });
      return placeholder;
    }
  );

  // Strip any remaining raw HTML tags and decode entities
  const plainText = stripTagsToPlain(working);
  let safe = escapeHtml(plainText);

  // Linkify raw https:// or www. URLs
  safe = safe.replace(
    /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi,
    (match) => {
      const cleanMatch = match.replace(/[.,;!?)]+$/, '');
      const trailing = match.slice(cleanMatch.length);
      const href = /^https?:\/\//i.test(cleanMatch) ? cleanMatch : `https://${cleanMatch}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${cleanMatch}</a>${trailing}`;
    }
  );

  // Linkify Instagram handles like @bailamelo.cali (avoiding emails like info@...)
  safe = safe.replace(
    /(^|[\s(:])@([a-zA-Z0-9._]{2,30})\b/g,
    (_m, prefix, handle) =>
      `${prefix}<a href="https://www.instagram.com/${handle}/" target="_blank" rel="noopener noreferrer">@${handle}</a>`
  );

  // Restore preserved anchor placeholders
  for (const item of preservedLinks) {
    safe = safe.replace(item.placeholder, item.html);
  }

  const html = safe.replace(/\n/g, '<br>');
  // Build clean plain text for Google Calendar template URL
  let plain = plainText;
  for (const item of preservedLinks) {
    const hrefMatch = item.html.match(/href="([^"]+)"/);
    plain = plain.replace(item.placeholder, hrefMatch ? hrefMatch[1] : '');
  }

  return { html, plain: plain.trim() };
}

function buildGoogleCalendarTemplateUrl(ev: {
  summary: string;
  startUtcMs: number;
  endUtcMs: number;
  location: string;
  descriptionPlain: string;
}): string {
  const fmt = (ms: number) => {
    const p = utcMsToBogotaParts(ms);
    return `${p.year}${pad2(p.month)}${pad2(p.day)}T${pad2(p.hour)}${pad2(p.minute)}00`;
  };
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.summary,
    dates: `${fmt(ev.startUtcMs)}/${fmt(ev.endUtcMs)}`,
    ctz: 'America/Bogota',
    details: ev.descriptionPlain.slice(0, 600),
    location: ev.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildActivityEvent(raw: {
  uid: string;
  summary: string;
  startUtcMs: number;
  endUtcMs: number;
  location: string;
  description: string;
}): ActivityEvent {
  const start = utcMsToBogotaParts(raw.startUtcMs);
  const end = utcMsToBogotaParts(raw.endUtcMs);
  const { html, plain } = sanitizeAndLinkifyDescription(raw.description);
  const { category, isFree, isFeatured } = classifyEvent(raw.summary, plain);

  const location = raw.location.trim();
  const shortVenue = location ? location.split(',')[0].trim() : '';
  const mapsUrl = location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
    : '';

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes =
    end.dateKey === start.dateKey
      ? end.hour * 60 + end.minute
      : end.hour * 60 + end.minute + 1440;

  return {
    id: `${raw.uid}-${start.dateKey}-${start.hour}${pad2(start.minute)}`,
    summary: raw.summary.trim(),
    cleanTitle: raw.summary.trim(),
    startIso: start.iso,
    endIso: end.iso,
    dateKey: start.dateKey,
    startTimeLabel: formatTime12h(start.hour, start.minute),
    endTimeLabel: formatTime12h(end.hour, end.minute),
    startMinutes,
    endMinutes,
    location,
    shortVenue,
    descriptionHtml: html,
    descriptionPlain: plain,
    isFree,
    isFeatured,
    category,
    mapsUrl,
    addToCalendarUrl: buildGoogleCalendarTemplateUrl({
      summary: raw.summary.trim(),
      startUtcMs: raw.startUtcMs,
      endUtcMs: raw.endUtcMs,
      location,
      descriptionPlain: plain,
    }),
  };
}

// ======================================================
// SOURCE 1: Google Calendar API (Preferred on Vercel)
// ======================================================
async function fetchEventsViaGoogleApi(
  windowStartUtcMs: number,
  windowEndUtcMs: number
): Promise<ActivityEvent[] | null> {
  const clientEmail = getEnv('GOOGLE_CLIENT_EMAIL');
  const rawKey = getEnv('GOOGLE_PRIVATE_KEY');
  if (!clientEmail || !rawKey) return null;

  try {
    const privateKey = rawKey.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.list({
      calendarId: ACTIVITIES_CALENDAR_ID,
      timeMin: new Date(windowStartUtcMs).toISOString(),
      timeMax: new Date(windowEndUtcMs).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const items = res.data.items || [];
    const results: ActivityEvent[] = [];

    for (const item of items) {
      if (item.status === 'cancelled' || !item.summary) continue;
      const startStr = item.start?.dateTime || item.start?.date;
      const endStr = item.end?.dateTime || item.end?.date;
      if (!startStr) continue;

      const startUtcMs = item.start?.dateTime
        ? new Date(startStr).getTime()
        : dateKeyToUtcMs(startStr, 9, 0);
      const endUtcMs = item.end?.dateTime
        ? new Date(endStr!).getTime()
        : startUtcMs + 60 * 60 * 1000;

      if (isNaN(startUtcMs)) continue;

      results.push(
        buildActivityEvent({
          uid: item.id || String(startUtcMs),
          summary: item.summary,
          startUtcMs,
          endUtcMs: isNaN(endUtcMs) ? startUtcMs + 60 * 60 * 1000 : endUtcMs,
          location: item.location || '',
          description: item.description || '',
        })
      );
    }

    return results;
  } catch (err: any) {
    console.warn('Google Calendar API read failed, falling back to public ICS:', err?.message || err);
    return null;
  }
}

// ======================================================
// SOURCE 2: Public .ics Feed Parser (Zero-credential fallback)
// ======================================================
function unescapeIcsText(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseIcsDateToUtcMs(propLine: string): number | null {
  const colonIdx = propLine.indexOf(':');
  if (colonIdx === -1) return null;
  const meta = propLine.slice(0, colonIdx).toUpperCase();
  const val = propLine.slice(colonIdx + 1).trim();

  // YYYYMMDDTHHMMSSZ (UTC)
  const utcMatch = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcMatch) {
    return Date.UTC(
      Number(utcMatch[1]),
      Number(utcMatch[2]) - 1,
      Number(utcMatch[3]),
      Number(utcMatch[4]),
      Number(utcMatch[5]),
      Number(utcMatch[6])
    );
  }

  // YYYYMMDDTHHMMSS (local America/Bogota)
  const localMatch = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (localMatch) {
    return (
      Date.UTC(
        Number(localMatch[1]),
        Number(localMatch[2]) - 1,
        Number(localMatch[3]),
        Number(localMatch[4]),
        Number(localMatch[5]),
        Number(localMatch[6])
      ) + BOGOTA_OFFSET_MS
    );
  }

  // YYYYMMDD (all-day)
  const dateMatch = val.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch && meta.includes('VALUE=DATE')) {
    return (
      Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), 9, 0, 0) +
      BOGOTA_OFFSET_MS
    );
  }

  return null;
}

export function parseIcsIntoWindow(
  icsText: string,
  windowDateKeys: string[],
  windowStartUtcMs: number,
  windowEndUtcMs: number
): ActivityEvent[] {
  // Unfold RFC 5545 folded lines
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);

  const events: ActivityEvent[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let uid = '';
    let summary = '';
    let description = '';
    let location = '';
    let dtstartLine = '';
    let dtendLine = '';
    let rrule = '';
    let status = '';
    const exdateKeys = new Set<string>();

    for (const line of lines) {
      if (line.startsWith('UID:')) uid = line.slice(4).trim();
      else if (line.startsWith('SUMMARY:')) summary = unescapeIcsText(line.slice(8));
      else if (line.startsWith('DESCRIPTION:')) description = unescapeIcsText(line.slice(12));
      else if (line.startsWith('LOCATION:')) location = unescapeIcsText(line.slice(9));
      else if (line.startsWith('DTSTART')) dtstartLine = line;
      else if (line.startsWith('DTEND')) dtendLine = line;
      else if (line.startsWith('RRULE:')) rrule = line.slice(6).trim();
      else if (line.startsWith('STATUS:')) status = line.slice(7).trim().toUpperCase();
      else if (line.startsWith('EXDATE')) {
        const exMs = parseIcsDateToUtcMs(line);
        if (exMs !== null) {
          exdateKeys.add(utcMsToBogotaParts(exMs).dateKey);
        }
      }
    }

    if (status === 'CANCELLED' || !summary || !dtstartLine) continue;

    const startUtcMs = parseIcsDateToUtcMs(dtstartLine);
    if (startUtcMs === null) continue;

    const endUtcMsRaw = dtendLine ? parseIcsDateToUtcMs(dtendLine) : null;
    const durationMs =
      endUtcMsRaw !== null && endUtcMsRaw > startUtcMs
        ? endUtcMsRaw - startUtcMs
        : 60 * 60 * 1000;

    // Non-recurring event
    if (!rrule) {
      if (startUtcMs >= windowStartUtcMs && startUtcMs < windowEndUtcMs) {
        events.push(
          buildActivityEvent({
            uid: uid || String(startUtcMs),
            summary,
            startUtcMs,
            endUtcMs: startUtcMs + durationMs,
            location,
            description,
          })
        );
      }
      continue;
    }

    // Parse RRULE parameters
    const ruleMap: Record<string, string> = {};
    for (const part of rrule.split(';')) {
      const [k, v] = part.split('=');
      if (k && v) ruleMap[k.toUpperCase()] = v.toUpperCase();
    }

    const freq = ruleMap['FREQ'];
    const interval = Math.max(1, Number(ruleMap['INTERVAL']) || 1);
    const untilRaw = ruleMap['UNTIL'];
    let untilMs = Infinity;
    if (untilRaw) {
      const parsedUntil = parseIcsDateToUtcMs(`UNTIL:${untilRaw}`);
      if (parsedUntil !== null) untilMs = parsedUntil;
    }

    // Quick skip if series ended before our window
    if (untilMs < windowStartUtcMs) continue;

    const startBogota = utcMsToBogotaParts(startUtcMs);
    const startDateKey = startBogota.dateKey;
    const byDays = ruleMap['BYDAY']
      ? ruleMap['BYDAY'].split(',').map((d) => d.replace(/[^A-Z]/g, ''))
      : [getWeekdayCode(startDateKey)];

    const [sy, sm, sd] = startDateKey.split('-').map(Number);
    const startMidnightUtc = Date.UTC(sy, sm - 1, sd);

    for (const candidateDateKey of windowDateKeys) {
      if (candidateDateKey < startDateKey) continue;
      if (exdateKeys.has(candidateDateKey)) continue;

      const [cy, cm, cd] = candidateDateKey.split('-').map(Number);
      const candMidnightUtc = Date.UTC(cy, cm - 1, cd);
      const diffDays = Math.round((candMidnightUtc - startMidnightUtc) / (24 * 60 * 60 * 1000));

      let matches = false;
      if (freq === 'DAILY') {
        matches = diffDays % interval === 0;
      } else if (freq === 'WEEKLY') {
        const dow = getWeekdayCode(candidateDateKey);
        if (byDays.includes(dow)) {
          const diffWeeks = Math.floor(diffDays / 7);
          matches = diffWeeks % interval === 0;
        }
      } else if (freq === 'MONTHLY') {
        matches = cd === sd;
      }

      if (!matches) continue;

      const occStartMs = dateKeyToUtcMs(
        candidateDateKey,
        startBogota.hour,
        startBogota.minute
      );
      if (occStartMs > untilMs) continue;
      if (occStartMs < windowStartUtcMs || occStartMs >= windowEndUtcMs) continue;

      events.push(
        buildActivityEvent({
          uid: uid || String(startUtcMs),
          summary,
          startUtcMs: occStartMs,
          endUtcMs: occStartMs + durationMs,
          location,
          description,
        })
      );
    }
  }

  return events;
}

async function fetchEventsViaPublicIcs(
  windowDateKeys: string[],
  windowStartUtcMs: number,
  windowEndUtcMs: number
): Promise<ActivityEvent[]> {
  try {
    const res = await fetch(PUBLIC_ICS_URL);
    if (!res.ok) {
      console.warn('Public ICS fetch failed with status:', res.status);
      return [];
    }
    const icsText = await res.text();
    return parseIcsIntoWindow(icsText, windowDateKeys, windowStartUtcMs, windowEndUtcMs);
  } catch (err: any) {
    console.warn('Could not fetch public ICS calendar:', err?.message || err);
    return [];
  }
}

export async function getUpcomingActivities(nowMs = Date.now()): Promise<{
  days: ActivityDayGroup[];
  todayKey: string;
  totalEvents: number;
}> {
  const nowBogota = getBogotaNowParts(nowMs);
  const todayKey = nowBogota.dateKey;
  const tomorrowKey = addDaysToDateKey(todayKey, 1);

  if (calendarCache && calendarCache.todayKey === todayKey && Date.now() < calendarCache.expiresAt) {
    const totalEvents = calendarCache.days.reduce((sum, d) => sum + d.events.length, 0);
    return { days: calendarCache.days, todayKey, totalEvents };
  }

  const windowDateKeys: string[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    windowDateKeys.push(addDaysToDateKey(todayKey, i));
  }

  const windowStartUtcMs = dateKeyToUtcMs(todayKey, 0, 0);
  const windowEndUtcMs = dateKeyToUtcMs(addDaysToDateKey(todayKey, WINDOW_DAYS), 0, 0);

  let rawEvents = await fetchEventsViaGoogleApi(windowStartUtcMs, windowEndUtcMs);
  if (!rawEvents) {
    rawEvents = await fetchEventsViaPublicIcs(windowDateKeys, windowStartUtcMs, windowEndUtcMs);
  }

  // Deduplicate identical (dateKey + startMinutes + summary) entries cleanly
  const seen = new Set<string>();
  const uniqueEvents: ActivityEvent[] = [];
  for (const ev of rawEvents) {
    const key = `${ev.dateKey}|${ev.startMinutes}|${ev.summary.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEvents.push(ev);
    }
  }

  uniqueEvents.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.summary.localeCompare(b.summary);
  });

  const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdaysLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const byDay = new Map<string, ActivityEvent[]>();
  for (const key of windowDateKeys) byDay.set(key, []);
  for (const ev of uniqueEvents) {
    if (byDay.has(ev.dateKey)) {
      byDay.get(ev.dateKey)!.push(ev);
    }
  }

  const days: ActivityDayGroup[] = windowDateKeys.map((dateKey) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();
    return {
      dateKey,
      weekdayShort: weekdaysShort[dow],
      weekdayLong: weekdaysLong[dow],
      dayNum: String(d),
      monthShort: monthsShort[m - 1],
      isToday: dateKey === todayKey,
      isTomorrow: dateKey === tomorrowKey,
      events: byDay.get(dateKey) || [],
    };
  });

  calendarCache = {
    todayKey,
    days,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return { days, todayKey, totalEvents: uniqueEvents.length };
}
