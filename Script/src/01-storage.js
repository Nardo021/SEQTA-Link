  /** @param {string} key */
  function getSetting(key) {
    return GM_getValue(key);
  }

  /** @param {string} key @param {unknown} value */
  function setSetting(key, value) {
    GM_setValue(key, value);
  }

  function loadConfig() {
    return {
      backendUrl: String(getSetting(STORAGE.backendUrl) || DEFAULTS.backendUrl).replace(/\/+$/, ''),
      uploadToken: String(getSetting(STORAGE.uploadToken) || '').trim(),
      calendarUrl: String(getSetting(STORAGE.calendarUrl) || '').trim(),
      weeksAhead: clampWeeks(Number(getSetting(STORAGE.weeksAhead)) || DEFAULTS.weeksAhead),
      studentRefOverride: String(getSetting(STORAGE.studentRefOverride) || '').trim(),
    };
  }

  /** @param {number} value */
  function clampWeeks(value) {
    if (!Number.isFinite(value) || value < 1) return DEFAULTS.weeksAhead;
    return Math.min(value, DEFAULTS.maxWeeks);
  }
