// src/utils/today.js — "today" in the company timezone
// Returns the calendar date in Asia/Kuwait (or whatever COMPANY_TIMEZONE is set to).
// Used by overdue and other date comparisons.

const TZ = process.env.COMPANY_TIMEZONE || 'Asia/Kuwait';

function today() {
  // Intl.DateTimeFormat with formatToParts returns the local date components in the target tz.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

// Returns a Date object set to midnight (00:00:00) at the company timezone on `dateStr` (YYYY-MM-DD).
// For comparison, two such Dates represent whole days. We use UTC to avoid DST issues by treating
// each day as the same instant: midnight in the company tz on that calendar day.
function midnightInTz(dateStr) {
  // Find the UTC instant at which the company-tz clock shows `dateStr` 00:00:00.
  // Use a small offset search: start with the UTC midnight, then adjust by the tz offset.
  // Simpler approach: parse the components and use the offset of an arbitrary noon to find tz.
  const [y, m, d] = dateStr.split('-').map(Number);
  // Use a known reference: noon UTC on the date. Get tz offset at that instant.
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(ref);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const tzY = get('year');
  const tzM = get('month');
  const tzD = get('day');
  const tzH = get('hour');
  const tzMin = get('minute');
  // The wall clock in TZ at this UTC ref is (tzY,tzM,tzD, tzH, tzMin). We want (y,m,d, 0,0).
  // Compute the offset: wall - utc.
  const wallAsUTC = Date.UTC(tzY, tzM - 1, tzD, tzH === 24 ? 0 : tzH, tzMin);
  const utcMs = ref.getTime();
  const offsetMs = wallAsUTC - utcMs;
  // The UTC instant corresponding to wall (y,m,d, 0,0) is target - offset:
  const target = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(target - offsetMs);
}

// Format a Date (or string) as YYYY-MM-DD in the company timezone.
// pg returns DATE columns as Date objects in the session timezone (often UTC+2
// on this server), so `.toISOString().slice(0,10)` gives the wrong date.
// Always go through the company timezone for consistency with `today()`.
function toDateStrInTz(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.length > 10 ? value.slice(0, 10) : value;
  }
  if (value instanceof Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value);
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
  }
  return null;
}

module.exports = { today, midnightInTz, TZ, toDateStrInTz };
