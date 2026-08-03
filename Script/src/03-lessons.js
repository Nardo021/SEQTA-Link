  /** @param {SeqtaLesson} lesson */
  function normalizePeriodKey(lesson) {
    if (lesson.period) {
      const slug = lesson.period
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (slug) {
        return slug.startsWith('period') ? slug : `period-${slug}`;
      }
    }
    const from = normalizeTime(lesson.from);
    if (from) {
      return `slot-${from.slice(0, 5).replace(':', '')}`;
    }
    return 'unknown-period';
  }

  /** @param {string | undefined} code */
  function normalizeCourseCode(code) {
    if (!code) return '';
    return code.trim().toUpperCase().replace(/\s+/g, '');
  }

  /** @param {string | undefined} title */
  function normalizeTitle(title) {
    return String(title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  /** @param {string | number | undefined} calendarid */
  function stableOccurrenceId(calendarid, ci) {
    if (calendarid != null && String(calendarid).length > 0) {
      return String(calendarid).replace(/^event:/i, '');
    }
    if (ci != null && Number.isFinite(Number(ci))) {
      return String(ci);
    }
    return '';
  }

  function buildSourceKey(lesson) {
    const date = lesson.date;
    const periodKey = normalizePeriodKey(lesson);
    const occurrenceId = stableOccurrenceId(lesson.calendarid, lesson.ci);
    if (occurrenceId) {
      return `${date}|${periodKey}|${occurrenceId}`;
    }
    const courseCode = normalizeCourseCode(lesson.code);
    if (courseCode) {
      return `${date}|${periodKey}|${courseCode}`;
    }
    return `${date}|${periodKey}|${normalizeTitle(lesson.description)}`;
  }

  /** @param {SeqtaLesson} lesson */
  function shouldIncludeLesson(lesson) {
    if (!lesson.date || !lesson.from || !lesson.until) return false;
    if (lesson.type && SKIP_LESSON_TYPES.has(lesson.type.toLowerCase())) return false;
    const title = (lesson.description || lesson.code || '').trim();
    return title.length > 0;
  }

  /** @param {SeqtaLesson} lesson */
  function mapLessonToPayload(lesson) {
    const start = normalizeTime(lesson.from);
    const end = normalizeTime(lesson.until);
    if (!start || !end) return null;

    return {
      sourceKey: truncate(buildSourceKey(lesson), 300),
      date: lesson.date,
      periodKey: normalizePeriodKey(lesson),
      periodLabel: truncate(lesson.period || normalizePeriodKey(lesson), 100),
      courseCode: normalizeCourseCode(lesson.code) || undefined,
      title: truncate((lesson.description || lesson.code || 'Class').trim(), 200),
      teacher: truncate(lesson.staff?.trim() || undefined, 200),
      room: truncate(lesson.room?.trim() || undefined, 100),
      start,
      end,
      type: 'class',
    };
  }

  /** @param {SeqtaLesson[]} lessons */
  function dedupeLessons(lessons) {
    const seen = new Set();
    const out = [];
    for (const lesson of lessons) {
      if (!shouldIncludeLesson(lesson)) continue;
      const mapped = mapLessonToPayload(lesson);
      if (!mapped || seen.has(mapped.sourceKey)) continue;
      seen.add(mapped.sourceKey);
      out.push(mapped);
    }
    return out;
  }
