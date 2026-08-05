import type { EventRecord } from '../../shared/types.js';
import { formatIcalLocal, formatIcalUtc } from '../../shared/dates.js';
import { escapeIcalText } from './ical.escape.js';
import { foldIcalContent } from './ical.fold.js';

const DEFAULT_TIMEZONE = 'Australia/Sydney';

/** Australia/Sydney DST rules (AEST UTC+10 / AEDT UTC+11). */
function buildSydneyVTimezone(): string[] {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Australia/Sydney',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+1100',
    'TZOFFSETTO:+1000',
    'TZNAME:AEST',
    'DTSTART:19700405T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+1000',
    'TZOFFSETTO:+1100',
    'TZNAME:AEDT',
    'DTSTART:19701004T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
  ];
}

export interface CalendarEventView {
  uid: string;
  dtStamp: string;
  created: string;
  lastModified: string;
  sequence: number;
  dtStart: string;
  dtEnd: string;
  summary: string;
  location: string | null;
  description: string;
  status: 'CONFIRMED' | 'CANCELLED';
}

function formatPeriodLabel(periodKey: string): string {
  return periodKey
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildEventDescription(event: EventRecord): string {
  const parts: string[] = [];
  if (event.teacher) {
    parts.push(`Teacher: ${event.teacher}`);
  }
  parts.push(`Period: ${formatPeriodLabel(event.periodKey)}`);
  if (event.courseCode) {
    parts.push(`Class: ${event.courseCode}`);
  }
  if (event.description) {
    parts.push(event.description);
  }
  return parts.join('\\n');
}

export function formatEventSummary(title: string, room: string | null): string {
  const trimmedRoom = room?.trim();
  if (!trimmedRoom) {
    return title;
  }
  return `${title} ${trimmedRoom}`;
}

export function eventToView(event: EventRecord, timestamps: CalendarTimestamps): CalendarEventView {
  const timezone = event.timezone?.trim() || timestamps.timezone?.trim() || DEFAULT_TIMEZONE;
  return {
    uid: event.icalUid,
    dtStamp: formatIcalUtc(timestamps.dtStamp),
    created: formatIcalUtc(event.createdAt),
    lastModified: formatIcalUtc(event.updatedAt),
    sequence: event.sequence,
    dtStart: formatIcalLocal(event.startsAtUtc, timezone),
    dtEnd: formatIcalLocal(event.endsAtUtc, timezone),
    summary: formatEventSummary(event.title, event.room),
    location: event.room,
    description: buildEventDescription(event),
    status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
  };
}

export interface CalendarTimestamps {
  dtStamp: string;
  calendarName?: string;
  timezone?: string;
}

export function serializeCalendar(
  events: CalendarEventView[],
  timestamps: CalendarTimestamps,
): string {
  const sorted = [...events].sort((a, b) => {
    const startCompare = a.dtStart.localeCompare(b.dtStart);
    if (startCompare !== 0) {
      return startCompare;
    }
    return a.uid.localeCompare(b.uid);
  });

  const calendarName = timestamps.calendarName?.trim() || 'Seqta Link';
  const timezone = timestamps.timezone?.trim() || DEFAULT_TIMEZONE;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Leoze//Seqta Link//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
    `X-WR-TIMEZONE:${escapeIcalText(timezone)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...buildSydneyVTimezone(),
  ];

  for (const event of sorted) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcalText(event.uid)}`);
    lines.push(`DTSTAMP:${timestamps.dtStamp ? formatIcalUtc(timestamps.dtStamp) : event.dtStamp}`);
    lines.push(`CREATED:${event.created}`);
    lines.push(`LAST-MODIFIED:${event.lastModified}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    // Wall-clock times fixed to Australia/Sydney (same as SEQTA), not UTC.
    lines.push(`DTSTART;TZID=${timezone}:${event.dtStart}`);
    lines.push(`DTEND;TZID=${timezone}:${event.dtEnd}`);
    lines.push(`SUMMARY:${escapeIcalText(event.summary)}`);
    if (event.location) {
      lines.push(`LOCATION:${escapeIcalText(event.location)}`);
    }
    lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`);
    lines.push(`STATUS:${event.status}`);
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  lines.push('');

  const raw = lines.join('\r\n');
  return foldIcalContent(raw);
}

export function serializeEvents(
  events: EventRecord[],
  timestamps: CalendarTimestamps,
): string {
  const views = events.map((event) => eventToView(event, timestamps));
  return serializeCalendar(views, timestamps);
}
