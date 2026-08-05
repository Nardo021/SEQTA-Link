import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatIcalLocal, localDateTimeToUtcIso } from '../../src/shared/dates.js';
import { computeNaturalKey, computeContentHash } from '../../src/modules/sync/identity.js';
import { deduplicateLessons } from '../../src/modules/sync/deduplicator.js';
import { normalizeLesson } from '../../src/modules/sync/normalizer.js';

describe('identity and normalizer', () => {
  const lesson = {
    sourceKey: '2026-08-05|period-2|1575659',
    date: '2026-08-05',
    periodKey: 'Period-2',
    periodLabel: 'Period 2',
    courseCode: '11mus',
    title: 'Music 1',
    teacher: 'Mr Example',
    room: 'M202',
    start: '09:35:00',
    end: '10:30:00',
    type: 'class' as const,
  };

  it('normalizes course code to uppercase', () => {
    const normalized = normalizeLesson(lesson, 'feed-1', 'Australia/Sydney');
    assert.equal(normalized.courseCode, '11MUS');
    assert.equal(normalized.periodKey, 'period-2');
  });

  it('computes stable natural keys', () => {
    const a = computeNaturalKey('feed-1', '2026-08-05', 'period-2', '11MUS', 'Music 1');
    const b = computeNaturalKey('feed-1', '2026-08-05', 'period-2', '11MUS', 'Music 1');
    assert.equal(a, b);
  });

  it('computes stable content hashes', () => {
    const normalized = normalizeLesson(lesson, 'feed-1', 'Australia/Sydney');
    const hash = computeContentHash({
      date: normalized.date,
      startUtc: normalized.startUtc,
      endUtc: normalized.endUtc,
      title: normalized.title,
      courseCode: normalized.courseCode,
      periodLabel: normalized.periodLabel,
      teacher: normalized.teacher,
      room: normalized.room,
      description: normalized.description,
      type: normalized.type,
      status: 'confirmed',
    });
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it('deduplicates source keys', () => {
    const normalized = normalizeLesson(lesson, 'feed-1', 'Australia/Sydney');
    const result = deduplicateLessons([normalized, { ...normalized }]);
    assert.equal(result.lessons.length, 1);
    assert.equal(result.duplicateCount, 1);
  });
});

describe('timezone conversion', () => {
  it('converts Sydney standard time to UTC', () => {
    const utc = localDateTimeToUtcIso('2026-08-05', '09:35:00', 'Australia/Sydney');
    assert.equal(utc, '2026-08-04T23:35:00Z');
  });

  it('handles DST boundary in October', () => {
    const utc = localDateTimeToUtcIso('2026-10-05', '09:35:00', 'Australia/Sydney');
    assert.equal(utc, '2026-10-04T22:35:00Z');
  });

  it('formats ICS event times as Sydney wall-clock (not UTC Z)', () => {
    assert.equal(
      formatIcalLocal('2026-08-04T23:35:00Z', 'Australia/Sydney'),
      '20260805T093500',
    );
    assert.equal(
      formatIcalLocal('2026-10-04T22:35:00Z', 'Australia/Sydney'),
      '20261005T093500',
    );
  });
});
