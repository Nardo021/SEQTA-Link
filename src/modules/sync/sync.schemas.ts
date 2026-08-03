export const syncBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'schoolHost',
    'studentRef',
    'timezone',
    'generatedAt',
    'coverage',
    'lessons',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    schoolHost: { type: 'string', minLength: 1, maxLength: 255 },
    studentRef: { type: 'string', minLength: 1, maxLength: 64 },
    timezone: { type: 'string', const: 'Australia/Sydney' },
    generatedAt: { type: 'string', minLength: 1 },
    allowEmptySnapshot: { type: 'boolean' },
    coverage: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'until', 'complete'],
        properties: {
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          until: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          complete: { type: 'boolean' },
        },
      },
    },
    lessons: {
      type: 'array',
      maxItems: 2000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceKey',
          'date',
          'periodKey',
          'periodLabel',
          'title',
          'start',
          'end',
          'type',
        ],
        properties: {
          sourceKey: { type: 'string', minLength: 1, maxLength: 300 },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          periodKey: { type: 'string', minLength: 1, maxLength: 64 },
          periodLabel: { type: 'string', minLength: 1, maxLength: 100 },
          courseCode: { type: 'string', maxLength: 32 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          teacher: { type: 'string', maxLength: 200 },
          room: { type: 'string', maxLength: 100 },
          description: { type: 'string', maxLength: 2000 },
          start: { type: 'string', pattern: '^\\d{2}:\\d{2}:\\d{2}$' },
          end: { type: 'string', pattern: '^\\d{2}:\\d{2}:\\d{2}$' },
          type: { type: 'string', enum: ['class'] },
        },
      },
    },
  },
} as const;

export interface SyncCoverageInput {
  from: string;
  until: string;
  complete: boolean;
}

export interface SyncLessonInput {
  sourceKey: string;
  date: string;
  periodKey: string;
  periodLabel: string;
  courseCode?: string;
  title: string;
  teacher?: string;
  room?: string;
  description?: string;
  start: string;
  end: string;
  type: 'class';
}

export interface SyncRequestBody {
  schemaVersion: 1;
  schoolHost: string;
  studentRef: string;
  timezone: 'Australia/Sydney';
  generatedAt: string;
  allowEmptySnapshot?: boolean;
  coverage: SyncCoverageInput[];
  lessons: SyncLessonInput[];
}

export interface NormalizedLesson {
  sourceKey: string;
  date: string;
  periodKey: string;
  periodLabel: string;
  courseCode: string | null;
  title: string;
  teacher: string | null;
  room: string | null;
  description: string | null;
  start: string;
  end: string;
  startUtc: string;
  endUtc: string;
  type: 'class';
  naturalKey: string;
  contentHash: string;
}
