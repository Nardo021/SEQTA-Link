import { canonicalJsonHash, sha256Hex } from '../../shared/crypto.js';

const IDENTITY_VERSION = 'v1';

export function normalizePeriodKey(periodKey: string): string {
  return periodKey.trim().toLowerCase().replace(/\s+/g, '-');
}

export function normalizeCourseCodeOrTitle(courseCode: string | null, title: string): string {
  if (courseCode) {
    return courseCode;
  }
  return title.toLowerCase();
}

export function computeNaturalKey(
  feedId: string,
  date: string,
  periodKey: string,
  courseCode: string | null,
  title: string,
): string {
  const normalizedPeriodKey = normalizePeriodKey(periodKey);
  const normalizedCourseOrTitle = normalizeCourseCodeOrTitle(courseCode, title);
  const input = `${IDENTITY_VERSION}:${feedId}:${date}:${normalizedPeriodKey}:${normalizedCourseOrTitle}`;
  return sha256Hex(input);
}

export function computeContentHash(fields: {
  date: string;
  startUtc: string;
  endUtc: string;
  title: string;
  courseCode: string | null;
  periodLabel: string;
  teacher: string | null;
  room: string | null;
  description: string | null;
  type: string;
  status: string;
}): string {
  return canonicalJsonHash({
    courseCode: fields.courseCode,
    date: fields.date,
    description: fields.description,
    endUtc: fields.endUtc,
    periodLabel: fields.periodLabel,
    room: fields.room,
    startUtc: fields.startUtc,
    status: fields.status,
    teacher: fields.teacher,
    title: fields.title,
    type: fields.type,
  });
}
