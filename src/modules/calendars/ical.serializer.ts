import type { EventRecord } from '../../shared/types.js';
import { formatIcalUtc } from '../../shared/dates.js';
import { escapeIcalText } from './ical.escape.js';
import { foldIcalContent } from './ical.fold.js';

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
  return {
    uid: event.icalUid,
    dtStamp: formatIcalUtc(timestamps.dtStamp),
    created: formatIcalUtc(event.createdAt),
    lastModified: formatIcalUtc(event.updatedAt),
    sequence: event.sequence,
    dtStart: formatIcalUtc(event.startsAtUtc),
    dtEnd: formatIcalUtc(event.endsAtUtc),
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
  const timezone = timestamps.timezone?.trim() || 'Australia/Sydney';

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
  ];

  for (const event of sorted) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcalText(event.uid)}`);
    lines.push(`DTSTAMP:${timestamps.dtStamp ? formatIcalUtc(timestamps.dtStamp) : event.dtStamp}`);
    lines.push(`CREATED:${event.created}`);
    lines.push(`LAST-MODIFIED:${event.lastModified}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    lines.push(`DTSTART:${event.dtStart}`);
    lines.push(`DTEND:${event.dtEnd}`);
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
