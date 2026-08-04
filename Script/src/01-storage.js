  /** @param {string} key */
  function getSetting(key) {
    return GM_getValue(key);
  }

  /** @param {string} key @param {unknown} value */
  function setSetting(key, value) {
    GM_setValue(key, value);
  }

  function loadConfig() {
    const activeProfile = getActiveProfile();
    return {
      backendUrl: String(getSetting(STORAGE.backendUrl) || DEFAULTS.backendUrl).replace(/\/+$/, ''),
      uploadToken: String(activeProfile?.uploadToken || getSetting(STORAGE.uploadToken) || '').trim(),
      deviceToken: String(activeProfile?.deviceToken || '').trim(),
      deviceId: String(activeProfile?.deviceId || '').trim(),
      calendarUrl: String(activeProfile?.calendarUrl || getSetting(STORAGE.calendarUrl) || '').trim(),
      profileName: String(activeProfile?.name || 'Default'),
      calendarLabel: String(activeProfile?.calendarLabel || activeProfile?.name || 'My Timetable'),
      weeksAhead: clampWeeks(Number(getSetting(STORAGE.weeksAhead)) || DEFAULTS.weeksAhead),
      studentRefOverride: String(getSetting(STORAGE.studentRefOverride) || '').trim(),
    };
  }

  /** @returns {{ id: string; name: string; deviceToken?: string; uploadToken?: string; deviceId?: string; calendarUrl?: string; calendarLabel?: string } | null} */
  function getActiveProfile() {
    const profiles = loadProfiles();
    const activeId = String(getSetting(STORAGE.activeProfileId) || '');
    return profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null;
  }

  /** @returns {Array<{ id: string; name: string; deviceToken?: string; uploadToken?: string; deviceId?: string; calendarUrl?: string; calendarLabel?: string }>} */
  function loadProfiles() {
    const raw = getSetting(STORAGE.profiles);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** @param {Array<{ id: string; name: string; deviceToken?: string; uploadToken?: string; deviceId?: string; calendarUrl?: string; calendarLabel?: string }>} profiles */
  function saveProfiles(profiles) {
    setSetting(STORAGE.profiles, JSON.stringify(profiles));
  }

  /** @param {string} profileId */
  function setActiveProfileId(profileId) {
    setSetting(STORAGE.activeProfileId, profileId);
  }

  /** @param {{ name: string; deviceToken: string; deviceId: string; calendarLabel: string; calendarUrl?: string }} input */
  function upsertDeviceProfile(input) {
    const profiles = loadProfiles();
    const id = crypto.randomUUID();
    profiles.push({
      id,
      name: input.name,
      deviceToken: input.deviceToken,
      deviceId: input.deviceId,
      calendarLabel: input.calendarLabel,
      calendarUrl: input.calendarUrl || '',
    });
    saveProfiles(profiles);
    setActiveProfileId(id);
    return id;
  }

  /** @param {number} value */
  function clampWeeks(value) {
    if (!Number.isFinite(value) || value < 1) return DEFAULTS.weeksAhead;
    return Math.min(value, DEFAULTS.maxWeeks);
  }
