import { AppError } from '../../shared/errors.js';
import type { NormalizedLesson } from './sync.schemas.js';

export interface DeduplicationResult {
  lessons: NormalizedLesson[];
  duplicateCount: number;
}

export function deduplicateLessons(lessons: NormalizedLesson[]): DeduplicationResult {
  const bySourceKey = new Map<string, NormalizedLesson>();
  let duplicateCount = 0;

  for (const lesson of lessons) {
    if (bySourceKey.has(lesson.sourceKey)) {
      duplicateCount++;
      continue;
    }
    bySourceKey.set(lesson.sourceKey, lesson);
  }

  const sourceDeduped = [...bySourceKey.values()];
  const byNaturalKey = new Map<string, NormalizedLesson[]>();

  for (const lesson of sourceDeduped) {
    const existing = byNaturalKey.get(lesson.naturalKey) ?? [];
    existing.push(lesson);
    byNaturalKey.set(lesson.naturalKey, existing);
  }

  const result: NormalizedLesson[] = [];

  for (const [naturalKey, group] of byNaturalKey) {
    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }

    const first = group[0]!;
    const allSame = group.every((lesson) => lesson.contentHash === first.contentHash);
    if (allSame) {
      result.push(first);
      duplicateCount += group.length - 1;
      continue;
    }

    throw new AppError(
      'DUPLICATE_LESSON_CONFLICT',
      'Two lessons resolve to the same timetable slot but contain conflicting data.',
      409,
      {
        naturalKey,
        sourceKeys: group.map((lesson) => lesson.sourceKey),
      },
    );
  }

  return { lessons: result, duplicateCount };
}
