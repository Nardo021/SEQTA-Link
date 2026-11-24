  /** @typedef {{ date: string; from: string; until: string; description: string; staff?: string; room?: string; code?: string; type?: string; period?: string; notes?: string; calendarid?: string | number; ci?: number }} SeqtaLesson */

  const STORAGE = {
    backendUrl: 'seqtaCal.backendUrl',
    uploadToken: 'seqtaCal.uploadToken',
    calendarUrl: 'seqtaCal.calendarUrl',
    weeksAhead: 'seqtaCal.weeksAhead',
    studentRefOverride: 'seqtaCal.studentRefOverride',
    profiles: 'seqtaCal.profiles',
    activeProfileId: 'seqtaCal.activeProfileId',
  };

  const DEFAULTS = {
    backendUrl: 'https://timetable.yanze.me',
    weeksAhead: 12,
    timezone: 'Australia/Sydney',
    maxWeeks: 17,
    maxLessons: 2000,
  };

  const LEGACY_BACKEND_URL = 'https://timetable.leoze.top';

  const SKIP_LESSON_TYPES = new Set(['note', 'holiday', 'assembly-note']);
