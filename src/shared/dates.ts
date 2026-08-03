import { AppError } from './errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

export function assertValidDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new AppError('INVALID_DATE_RANGE', 'Date must be in YYYY-MM-DD format.', 400);
  }
}

export function assertValidTime(time: string): void {
  if (!TIME_RE.test(time)) {
    throw new AppError('INVALID_LESSON', 'Time must be in HH:MM:SS format.', 400);
  }
}

export function parseDateParts(date: string): { year: number; month: number; day: number } {
  assertValidDate(date);
  const parts = date.split('-').map(Number);
  return { year: parts[0]!, month: parts[1]!, day: parts[2]! };
}

export function parseTimeParts(time: string): { hour: number; minute: number; second: number } {
  assertValidTime(time);
  const parts = time.split(':').map(Number);
  return { hour: parts[0]!, minute: parts[1]!, second: parts[2]! };
}

export function localDateTimeToUtcIso(
  localDate: string,
  localTime: string,
  timeZone: string,
): string {
  const { year, month, day } = parseDateParts(localDate);
  const { hour, minute, second } = parseTimeParts(localTime);

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = utcGuess;

  for (let attempt = 0; attempt < 4; attempt++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
    if (nextUtcMs === utcMs) {
      break;
    }
    utcMs = nextUtcMs;
  }

  const result = new Date(utcMs);
  if (Number.isNaN(result.getTime())) {
    throw new AppError('INVALID_LESSON', 'Failed to convert local time to UTC.', 400);
  }

  return formatUtcIso(result);
}

export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return asUtc - date.getTime();
}

export function formatUtcIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function formatIcalUtc(dateIso: string): string {
  const date = new Date(dateIso);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export function formatHttpDate(dateIso: string): string {
  return new Date(dateIso).toUTCString();
}

export function daysBetweenInclusive(from: string, until: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    throw new AppError('INVALID_DATE_RANGE', 'Invalid coverage date range.', 400);
  }
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

export function isDateWithinRange(date: string, from: string, until: string): boolean {
  return date >= from && date <= until;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
