// Timezone helpers. Every timestamp is stored in UTC; "today", "this week" and date filters are
// computed in the *user's* IANA timezone and converted to UTC ranges here (BR-010, BR-011).

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

// True for IANA names like "Asia/Karachi" or "UTC"; the runtime throws RangeError for unknown zones.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  );
}

// How far `timeZone` is ahead of UTC at `date`, in ms (e.g. +5 h for Asia/Karachi).
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour, p.minute, p.second);
  return asIfUtc - (date.getTime() - date.getUTCMilliseconds());
}

export function localDateOf(date: Date, timeZone: string): LocalDate {
  const p = zonedParts(date, timeZone);
  return { year: p.year ?? 0, month: p.month ?? 1, day: p.day ?? 1 };
}

// The UTC instant at which `date` starts (local midnight) in `timeZone`. Two passes, because the
// offset itself can change across that midnight (daylight saving time).
export function zonedMidnight(date: LocalDate, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day);
  let instant = naive - zoneOffsetMs(new Date(naive), timeZone);
  instant = naive - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1 + months, date.day));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// Monday = 0 ... Sunday = 6, for a calendar date (timezone-independent).
export function weekdayIndex(date: LocalDate): number {
  return (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7;
}

// "Today" in the user's timezone as a UTC range [start, end).
export function todayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const today = localDateOf(now, timeZone);
  return { start: zonedMidnight(today, timeZone), end: zonedMidnight(addDays(today, 1), timeZone) };
}

// "2026-10-25" -> { year: 2026, month: 10, day: 25 }. Input is validated by localDateSchema first.
export function parseLocalDate(value: string): LocalDate {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

export function formatLocalDate(date: LocalDate): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.year)}-${pad(date.month)}-${pad(date.day)}`;
}
