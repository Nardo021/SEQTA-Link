  /** @param {string} text */
  function parseTimeRange(text) {
    const cleaned = text.replace(/\u2013|\u2014|–|—/g, '-');
    const parts = cleaned.split('-').map((p) => p.trim());
    if (parts.length < 2) return null;
    const from = normalizeTime(parts[0]);
    const until = normalizeTime(parts[1]);
    if (!from || !until) return null;
    return { from, until };
  }

  /** @returns {SeqtaLesson[]} */
  function extractLessonsFromDom() {
    /** @type {SeqtaLesson[]} */
    const lessons = [];
    const root = document.querySelector('.timetablepage, .timetable');
    if (!root) return lessons;

    const dayNodes = root.querySelectorAll('.day');
    if (dayNodes.length > 0) {
      dayNodes.forEach((dayEl) => {
        const date =
          dayEl.getAttribute('data-date') ||
          dayEl.querySelector('[data-date]')?.getAttribute('data-date') ||
          dayEl.querySelector('.date')?.textContent?.trim() ||
          '';
        const isoDate = normalizeDomDate(date);
        if (!isoDate) return;

        dayEl.querySelectorAll('.entry.class, .entry').forEach((entry) => {
          const lesson = parseDomEntry(entry, isoDate);
          if (lesson) lessons.push(lesson);
        });
      });
      return lessons;
    }

    document.querySelectorAll('.timetablepage .entry.class, .timetable .entry.class').forEach((entry) => {
      const dateAttr = entry.closest('.day')?.getAttribute('data-date');
      const lesson = parseDomEntry(entry, dateAttr ? normalizeDomDate(dateAttr) : '');
      if (lesson) lessons.push(lesson);
    });

    return lessons;
  }

  /** @param {string} raw */
  function normalizeDomDate(raw) {
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return toISODate(new Date(parsed));
    return '';
  }

  /** @param {Element} entry @param {string} date */
  function parseDomEntry(entry, date) {
    if (!date) return null;

    const title =
      entry.querySelector('.title, .subject, .description')?.textContent?.trim() ||
      entry.getAttribute('title') ||
      '';
    const staff = entry.querySelector('.staff, .teacher')?.textContent?.trim() || '';
    const room = entry.querySelector('.room, .location')?.textContent?.trim() || '';
    const code = entry.querySelector('.code')?.textContent?.trim() || '';
    const period = entry.querySelector('.period')?.textContent?.trim() || '';

    const timeEl = entry.querySelector('.times, .time');
    const timeText = timeEl?.textContent?.trim() || '';
    const range = parseTimeRange(timeText);
    if (!range && !title) return null;

    const calendarid =
      entry.getAttribute('data-id') ||
      entry.getAttribute('data-calendarid') ||
      entry.getAttribute('data-ci') ||
      undefined;
    const ciRaw = entry.getAttribute('data-ci');
    const ci = ciRaw ? Number.parseInt(ciRaw, 10) : undefined;

    return {
      date,
      from: range?.from || '00:00:00',
      until: range?.until || '00:00:00',
      description: title || code || 'Class',
      staff: staff || undefined,
      room: room || undefined,
      code: code || undefined,
      period: period || undefined,
      type: entry.classList.contains('assessment') ? 'assessment' : 'class',
      calendarid: calendarid || undefined,
      ci: Number.isFinite(ci) ? ci : undefined,
    };
  }
