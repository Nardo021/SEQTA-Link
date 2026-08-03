  /** @typedef {{ from: string; until: string; complete: boolean }} CoverageWeek */

  /**
   * @param {(message: string) => void} onProgress
   * @returns {Promise<{ payload: object; stats: { weeksOk: number; weeksFailed: number; lessonCount: number } }>}
   */
  async function buildSyncPayload(onProgress) {
    const config = loadConfig();
    const weekRanges = buildWeekRanges(config.weeksAhead);
    /** @type {CoverageWeek[]} */
    const coverage = [];
    /** @type {SeqtaLesson[]} */
    const allLessons = [];
    let weeksOk = 0;
    let weeksFailed = 0;
    let apiAvailable = true;

    for (let i = 0; i < weekRanges.length; i += 1) {
      const range = weekRanges[i];
      onProgress(`Fetching week ${i + 1}/${weekRanges.length} (${range.from} → ${range.until})…`);
      try {
        const items = await fetchTimetableWeek(range);
        allLessons.push(...items);
        coverage.push({ from: range.from, until: range.until, complete: true });
        weeksOk += 1;
      } catch (error) {
        apiAvailable = false;
        coverage.push({ from: range.from, until: range.until, complete: false });
        weeksFailed += 1;
        console.warn('[seqta-calendar-sync] Week fetch failed:', range, error);
      }
    }

    if (!apiAvailable && allLessons.length === 0) {
      onProgress('SEQTA API unavailable — trying DOM extraction for the visible week…');
      const domLessons = extractLessonsFromDom();
      if (domLessons.length > 0) {
        const visible = weekRangeContaining(new Date());
        allLessons.push(...domLessons);
        coverage.length = 0;
        coverage.push({ from: visible.from, until: visible.until, complete: true });
        weeksOk = 1;
        weeksFailed = weekRanges.length - 1;
      }
    }

    const lessons = dedupeLessons(allLessons).slice(0, DEFAULTS.maxLessons);
    const schoolHost = location.hostname;
    const studentRef = await resolveStudentRef();

    const payload = {
      schemaVersion: 1,
      schoolHost,
      studentRef,
      timezone: DEFAULTS.timezone,
      generatedAt: formatGeneratedAt(),
      coverage,
      lessons,
    };

    return {
      payload,
      stats: {
        weeksOk,
        weeksFailed,
        lessonCount: lessons.length,
      },
    };
  }

  /** @param {(message: string) => void} onProgress */
  async function runSync(onProgress) {
    const idempotencyKey = crypto.randomUUID();
    onProgress('Building timetable snapshot…');

    const { payload, stats } = await buildSyncPayload(onProgress);
    const body = JSON.stringify(payload);

    onProgress(`Uploading ${stats.lessonCount} lessons (${stats.weeksOk} complete weeks, ${stats.weeksFailed} incomplete)…`);

    const allowEmptySnapshot = needsEmptySnapshotConfirmation(payload);
    if (allowEmptySnapshot) {
      onProgress('Empty snapshot over 7+ complete days — sending allowEmptySnapshot…');
    }

    const result = await postSyncPayload(body, idempotencyKey, allowEmptySnapshot);
    return {
      result,
      stats,
      idempotencyKey,
      emptySnapshotConfirmed: allowEmptySnapshot,
    };
  }
