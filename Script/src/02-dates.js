  /** @param {Date} d */
  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Monday–Sunday range containing `date`. */
  /** @param {Date} date */
  function weekRangeContaining(date) {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = local.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    local.setDate(local.getDate() + diff);
    const monday = local;
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { from: toISODate(monday), until: toISODate(sunday) };
  }

  /** @param {string} iso @returns {Date} */
  function parseLocalDate(iso) {
    return new Date(`${iso}T12:00:00`);
  }

  /** @param {number} weeksAhead */
  function buildWeekRanges(weeksAhead) {
    const ranges = [];
    let cursor = weekRangeContaining(new Date()).from;
    for (let i = 0; i < weeksAhead; i += 1) {
      const start = parseLocalDate(cursor);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      ranges.push({ from: toISODate(start), until: toISODate(end) });
      const next = new Date(start);
      next.setDate(next.getDate() + 7);
      cursor = toISODate(next);
    }
    return ranges;
  }

  /** @param {Date} [date] */
  function getSydneyOffset(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: DEFAULTS.timezone,
      timeZoneName: 'shortOffset',
    });
    const part = formatter.formatToParts(date).find((p) => p.type === 'timeZoneName');
    const raw = part?.value || 'GMT+10';
    const match = raw.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return '+10:00';
    const sign = match[1].startsWith('-') ? '-' : '+';
    const hours = String(Math.abs(Number.parseInt(match[1], 10))).padStart(2, '0');
    const mins = match[2] || '00';
    return `${sign}${hours}:${mins}`;
  }

  /** @param {Date} [date] */
  function formatGeneratedAt(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULTS.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${getSydneyOffset(date)}`;
  }

  /** @param {string} value */
  function normalizeTime(value) {
    const trimmed = String(value || '').trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
  }

  /** @param {string | undefined} value */
  function truncate(value, max) {
    if (!value) return value;
    return value.length <= max ? value : value.slice(0, max);
  }
