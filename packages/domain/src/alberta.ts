// Alberta time, in which every time on the platform is typed and shown (owner's decision of
// 2026-10-29, docs/DECISIONS.md): GSS operates from Alberta, so what a due time or a quote's
// valid-until time means, and which day is "today", is the same for every viewer wherever
// their computer is. Times are stored as UTC instants; these helpers convert to and from
// Alberta wall-clock time.
//
// Alberta's clocks went forward to UTC−6 on 8 March 2026 and stay there all year: from
// November 2026 they no longer go back (Alberta's new time system; time zone database 2026e).
// From that instant the offset is fixed here rather than read from the browser's or the
// Worker's time zone rules, which may be of an older edition that still goes back to UTC−7.
// Earlier instants follow the time zone database, on which every edition agrees.

/** Alberta's time zone, for instants before its clocks were fixed at UTC−6. */
export const ALBERTA_TIME_ZONE = 'America/Edmonton';

/** The label shown after every time: Alberta time, as the owner calls it. */
export const ALBERTA_TIME_LABEL = 'MT';

/** 2026-03-08 09:00 UTC (2 am in Alberta): from here Alberta's clocks stay at UTC−6. */
export const ALBERTA_FIXED_FROM = Date.UTC(2026, 2, 8, 9);

/** UTC−6, in milliseconds. */
const FIXED_OFFSET = -6 * 3600 * 1000;

/** "2026-10-30T14:00": a wall-clock time as a datetime-local input holds it. */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: ALBERTA_TIME_ZONE,
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

/** Milliseconds that Alberta time is ahead of UTC at this instant (negative: behind). */
function offsetAt(time: number): number {
  if (time >= ALBERTA_FIXED_FROM) return FIXED_OFFSET;
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of parts.formatToParts(new Date(time))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    values.year ?? 0,
    (values.month ?? 1) - 1,
    values.day ?? 0,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

function wallClock(date: Date): WallClock {
  const shifted = new Date(date.getTime() + offsetAt(date.getTime()));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

const two = (value: number) => String(value).padStart(2, '0');

/**
 * An Alberta wall-clock time ("2026-10-30T14:00") as a UTC instant
 * ("2026-10-30T20:00:00.000Z"); null when it is not a wall-clock time. In the hour skipped
 * when clocks sprang forward, the time an hour later is meant; in an hour repeated when they
 * fell back (before 2026), the first one.
 */
export function albertaToUtc(local: string): string | null {
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

/** A UTC instant as an Alberta wall-clock time for a datetime-local input; empty when invalid. */
export function utcToAlberta(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const clock = wallClock(new Date(time));
  return `${String(clock.year)}-${two(clock.month)}-${two(clock.day)}T${two(clock.hour)}:${two(clock.minute)}`;
}

/** The Alberta calendar day of an instant: "2026-10-30". */
export function albertaDay(iso: string | Date): string {
  const clock = wallClock(typeof iso === 'string' ? new Date(iso) : iso);
  return `${String(clock.year)}-${two(clock.month)}-${two(clock.day)}`;
}

/** The end of the Alberta calendar day of `now` (the next midnight there), as a UTC instant. */
export function endOfAlbertaDay(now: Date): string {
  const next = new Date(`${albertaDay(now)}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = albertaToUtc(`${next.toISOString().slice(0, 10)}T00:00`);
  if (end === null) throw new Error('no Alberta midnight');
  return end;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "Fri 30 Oct 2026, 2:00 pm MT": an instant in Alberta time, the same for every viewer;
 * "30 Oct 2026, 2:00 pm MT" without the weekday.
 */
export function formatAlberta(iso: string, { weekday: withWeekday = true } = {}): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) throw new Error(`Not a timestamp: "${iso}"`);
  const clock = wallClock(new Date(time));
  const weekday = WEEKDAYS[new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay()];
  const hour12 = clock.hour % 12 === 0 ? 12 : clock.hour % 12;
  const half = clock.hour < 12 ? 'am' : 'pm';
  const day = withWeekday ? `${weekday ?? ''} ${String(clock.day)}` : String(clock.day);
  return `${day} ${MONTHS[clock.month - 1] ?? ''} ${String(clock.year)}, ${String(hour12)}:${two(clock.minute)} ${half} ${ALBERTA_TIME_LABEL}`;
}
