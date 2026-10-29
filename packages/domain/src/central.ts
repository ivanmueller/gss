// Central time, in which the CRM's times are entered and shown (owner's decision of
// 2026-10-29, docs/DECISIONS.md): what a follow-up's due time means, and which day is
// "today", is the same for every viewer wherever their computer is. Times are stored as UTC
// instants; these helpers convert to and from Central wall-clock time, daylight saving
// included, through the Intl time zone database.

/** Central time, as the CRM uses it (Winnipeg follows Central time and its daylight saving). */
export const CENTRAL_TIME_ZONE = 'America/Winnipeg';

/** "2026-10-30T14:00": a wall-clock time as a datetime-local input holds it. */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: CENTRAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(date: Date): WallClock {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of parts.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Milliseconds that Central time is ahead of UTC at this instant (negative: behind). */
function offsetAt(time: number): number {
  const clock = wallClock(new Date(time));
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

const two = (value: number) => String(value).padStart(2, '0');

/**
 * A Central wall-clock time ("2026-10-30T14:00") as a UTC instant
 * ("2026-10-30T19:00:00.000Z"); null when it is not a wall-clock time. In the hour skipped
 * when clocks spring forward, the time an hour later is meant; in the hour repeated when
 * they fall back, the first one.
 */
export function centralToUtc(local: string): string | null {
  const match = WALL_TIME.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  // The offset a few hours either side settles which one applies (the earlier one first).
  const before = offsetAt(asUtc - 12 * 3600 * 1000);
  const after = offsetAt(asUtc + 12 * 3600 * 1000);
  for (const offset of [before, after]) {
    const candidate = asUtc - offset;
    if (offsetAt(candidate) === offset) return new Date(candidate).toISOString();
  }
  // A skipped wall time: read it with the offset before the change.
  return new Date(asUtc - before).toISOString();
}

/** A UTC instant as a Central wall-clock time for a datetime-local input; empty when invalid. */
export function utcToCentral(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const clock = wallClock(new Date(time));
  return `${String(clock.year)}-${two(clock.month)}-${two(clock.day)}T${two(clock.hour)}:${two(clock.minute)}`;
}

/** The Central calendar day of an instant: "2026-10-30". */
export function centralDay(iso: string | Date): string {
  const clock = wallClock(typeof iso === 'string' ? new Date(iso) : iso);
  return `${String(clock.year)}-${two(clock.month)}-${two(clock.day)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri 30 Oct 2026, 2:00 pm CT": an instant in Central time, the same for every viewer. */
export function formatCentral(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) throw new Error(`Not a timestamp: "${iso}"`);
  const clock = wallClock(new Date(time));
  const weekday = WEEKDAYS[new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay()];
  const hour12 = clock.hour % 12 === 0 ? 12 : clock.hour % 12;
  const half = clock.hour < 12 ? 'am' : 'pm';
  return `${weekday ?? ''} ${String(clock.day)} ${MONTHS[clock.month - 1] ?? ''} ${String(clock.year)}, ${String(hour12)}:${two(clock.minute)} ${half} CT`;
}
