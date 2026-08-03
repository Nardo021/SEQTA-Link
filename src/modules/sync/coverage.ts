import { daysBetweenInclusive, isDateWithinRange } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { SyncCoverageInput } from './sync.schemas.js';

export interface CoverageRange {
  from: string;
  until: string;
  complete: boolean;
}

export function normalizeCoverage(coverage: SyncCoverageInput[]): CoverageRange[] {
  return coverage.map((entry) => {
    if (entry.from > entry.until) {
      throw new AppError('INVALID_DATE_RANGE', 'Coverage from date must be on or before until date.', 400);
    }
    return {
      from: entry.from,
      until: entry.until,
      complete: entry.complete,
    };
  });
}

export function validateLessonsWithinCoverage(
  lessonDates: string[],
  coverage: CoverageRange[],
): void {
  for (const date of lessonDates) {
    const covered = coverage.some((range) => isDateWithinRange(date, range.from, range.until));
    if (!covered) {
      throw new AppError(
        'INVALID_DATE_RANGE',
        `Lesson date ${date} is outside declared coverage ranges.`,
        400,
      );
    }
  }
}

export function validateEmptySnapshot(
  lessonsCount: number,
  coverage: CoverageRange[],
  allowEmptySnapshot: boolean | undefined,
): void {
  if (lessonsCount > 0) {
    return;
  }

  const completeDays = coverage
    .filter((range) => range.complete)
    .reduce((total, range) => total + daysBetweenInclusive(range.from, range.until), 0);

  if (completeDays > 7 && !allowEmptySnapshot) {
    throw new AppError(
      'SUSPICIOUS_EMPTY_SNAPSHOT',
      'An empty snapshot covering more than seven days requires explicit confirmation.',
      422,
    );
  }
}

export function getCompleteCoverageRanges(coverage: CoverageRange[]): CoverageRange[] {
  return coverage.filter((range) => range.complete);
}

export function isDateInCompleteCoverage(date: string, coverage: CoverageRange[]): boolean {
  return getCompleteCoverageRanges(coverage).some((range) =>
    isDateWithinRange(date, range.from, range.until),
  );
}

export function getOverallRange(coverage: CoverageRange[]): { from: string; until: string } {
  const sortedFrom = [...coverage].sort((a, b) => a.from.localeCompare(b.from));
  const sortedUntil = [...coverage].sort((a, b) => b.until.localeCompare(a.until));
  return {
    from: sortedFrom[0]!.from,
    until: sortedUntil[0]!.until,
  };
}

export function validateCoverageSpan(coverage: CoverageRange[], maxDays: number): void {
  for (const range of coverage) {
    const days = daysBetweenInclusive(range.from, range.until);
    if (days > maxDays) {
      throw new AppError(
        'INVALID_DATE_RANGE',
        `Coverage range exceeds maximum of ${maxDays} days.`,
        400,
      );
    }
  }
}
