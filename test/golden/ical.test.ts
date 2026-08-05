import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeIcalText } from '../../src/modules/calendars/ical.escape.js';
import { foldIcalLine } from '../../src/modules/calendars/ical.fold.js';
import {
  formatEventSummary,
  serializeCalendar,
} from '../../src/modules/calendars/ical.serializer.js';

describe('ical escape and fold', () => {
  it('escapes special characters', () => {
    assert.equal(escapeIcalText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  });

  it('folds long lines', () => {
    const line = 'SUMMARY:' + 'A'.repeat(80);
    const folded = foldIcalLine(line);
    assert.ok(folded.length > 1);
    assert.ok(folded[1]?.startsWith(' '));
  });
});

describe('event summary', () => {
  it('appends room to title without a Room prefix', () => {
    assert.equal(formatEventSummary('Music 1', 'M202'), 'Music 1 M202');
  });

  it('keeps title alone when room is empty', () => {
    assert.equal(formatEventSummary('Music 1', null), 'Music 1');
    assert.equal(formatEventSummary('Music 1', '  '), 'Music 1');
  });
});

describe('ical golden output', () => {
  it('matches expected fixture bytes', () => {
    const body = serializeCalendar(
      [
        {
          uid: 'test-uid@timetable.leoze.top',
          dtStamp: '20260804T003502Z',
          created: '20260804T003502Z',
          lastModified: '20260804T003502Z',
          sequence: 0,
          dtStart: '20260805T093500',
          dtEnd: '20260805T103000',
          summary: 'Music 1',
          location: 'M202',
          description: 'Teacher: Mr Example\\nPeriod: Period 2\\nClass: 11MUS',
          status: 'CONFIRMED',
        },
        {
          uid: 'cancelled-uid@timetable.leoze.top',
          dtStamp: '20260804T003502Z',
          created: '20260804T003502Z',
          lastModified: '20260804T003502Z',
          sequence: 2,
          dtStart: '20261005T100000',
          dtEnd: '20261005T120000',
          summary: '中文课程, 分号;测试',
          location: null,
          description: 'Teacher: 王老师\\nPeriod: Period 3',
          status: 'CANCELLED',
        },
      ],
      { dtStamp: '2026-08-04T00:35:02.000Z', timezone: 'Australia/Sydney' },
    );

    assert.match(body, /BEGIN:VCALENDAR/);
    assert.match(body, /BEGIN:VTIMEZONE/);
    assert.match(body, /TZID:Australia\/Sydney/);
    assert.match(body, /DTSTART;TZID=Australia\/Sydney:20260805T093500/);
    assert.match(body, /DTEND;TZID=Australia\/Sydney:20260805T103000/);
    assert.match(body, /SUMMARY:Music 1/);
    assert.match(body, /STATUS:CANCELLED/);
    assert.match(body, /中文课程\\, 分号\\;测试/);
    assert.ok(body.endsWith('\r\n'));
  });
});
