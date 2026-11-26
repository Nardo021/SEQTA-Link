// ==UserScript==
// @name         Seqta Link
// @namespace    https://timetable.leoze.top
// @version      3.2.0
// @description  Sync SEQTA Learn timetable to Seqta Link (Apple / Google Calendar feed)
// @author       Leo
// @match        https://learn.masada.onseqtacloud.com/*
// @match        https://*.onseqtacloud.com/*
// @match        https://learn.*.edu.au/*
// @match        https://*.seqta.com.au/*
// @match        https://learn.*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=seqta.com.au
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      timetable.yanze.me
// @connect      seqta-link-staging.raspy-heart-8d21.workers.dev
// @connect      timetable.leoze.top
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function seqtaCalendarSync() {
  'use strict';

  /** @typedef {{ date: string; from: string; until: string; description: string; staff?: string; room?: string; code?: string; type?: string; period?: string; notes?: string; calendarid?: string | number; ci?: number }} SeqtaLesson */

  const STORAGE = {
    backendUrl: 'seqtaCal.backendUrl',
    uploadToken: 'seqtaCal.uploadToken',
    calendarUrl: 'seqtaCal.calendarUrl',
    weeksAhead: 'seqtaCal.weeksAhead',
    studentRefOverride: 'seqtaCal.studentRefOverride',
    profiles: 'seqtaCal.profiles',
    activeProfileId: 'seqtaCal.activeProfileId',
    autoPrefix: 'seqtaCal.auto.v1.',
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

  /** @param {string} key */
  function getSetting(key) {
    return GM_getValue(key);
  }

  /** @param {string} key @param {unknown} value */
  function setSetting(key, value) {
    GM_setValue(key, value);
  }

  function resolveBackendUrl() {
    const configured = String(getSetting(STORAGE.backendUrl) || DEFAULTS.backendUrl).replace(/\/+$/, '');
    // The historical default is no longer the canonical production endpoint.
    // Migrate only that exact value; never overwrite a custom server URL.
    if (configured === LEGACY_BACKEND_URL) {
      setSetting(STORAGE.backendUrl, DEFAULTS.backendUrl);
      return DEFAULTS.backendUrl;
    }
    return configured;
  }

  function loadConfig() {
    const activeProfile = getActiveProfile();
    return {
      backendUrl: resolveBackendUrl(),
      profileId: String(activeProfile?.id || ''),
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

  /** @param {string} path @param {Record<string, unknown>} body */
  async function postSeqtaJson(path, body) {
    const res = await fetch(`${location.origin}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/javascript, text/html, application/xml, text/xml, */*',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`SEQTA request failed (${res.status}) for ${path}`);
    }
    return res.json();
  }

  function isParentContext() {
    return (
      location.pathname.includes('/parent/') ||
      location.hash.includes('/parent/') ||
      document.body.classList.contains('parent')
    );
  }

  /** @type {{ id?: number; student?: number; type?: string } | null} */
  let cachedLogin = null;

  async function resolveLoginPayload() {
    if (cachedLogin) return cachedLogin;
    if (isParentContext()) return null;
    try {
      const json = await postSeqtaJson('/seqta/student/login', {
        mode: 'normal',
        query: null,
        redirect_url: location.href,
      });
      cachedLogin = json?.payload || null;
      return cachedLogin;
    } catch {
      return null;
    }
  }

  async function resolveStudentId() {
    const config = loadConfig();
    if (config.studentRefOverride) {
      const parsed = Number.parseInt(config.studentRefOverride, 10);
      return Number.isFinite(parsed) ? parsed : config.studentRefOverride;
    }
    const payload = await resolveLoginPayload();
    const id = payload?.id ?? payload?.student;
    return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
  }

  async function resolveStudentRef() {
    const config = loadConfig();
    if (config.studentRefOverride) return config.studentRefOverride;

    if (isParentContext()) {
      const listJson = await postSeqtaJson('/seqta/parent/load/timetable', { list: true });
      const firstChild = Array.isArray(listJson?.payload) ? listJson.payload[0] : undefined;
      if (firstChild?.id != null) return String(firstChild.id);
    }

    const id = await resolveStudentId();
    if (id == null) throw new Error('Could not determine student ID. Set it manually in settings.');
    return String(id);
  }

  /** @param {{ from: string; until: string }} range @returns {Promise<SeqtaLesson[]>} */
  async function fetchTimetableWeek(range) {
    const { from, until } = range;

    if (isParentContext()) {
      const listJson = await postSeqtaJson('/seqta/parent/load/timetable', { list: true });
      const firstChild = Array.isArray(listJson?.payload) ? listJson.payload[0] : undefined;
      const studentId = firstChild?.id;
      if (studentId == null) {
        throw new Error('No student found on this parent account.');
      }
      const data = await postSeqtaJson('/seqta/parent/load/timetable', {
        from,
        until,
        student: studentId,
      });
      if (!Array.isArray(data?.payload?.items)) throw new Error('SEQTA returned no timetable array.');
      return data.payload.items;
    }

    const studentId = await resolveStudentId();
    /** @type {Record<string, unknown>} */
    const body = { from, until };
    if (studentId != null) body.student = studentId;

    const data = await postSeqtaJson('/seqta/student/load/timetable?', body);
    if (!Array.isArray(data?.payload?.items)) throw new Error('SEQTA returned no timetable array.');
    return data.payload.items;
  }

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

  /**
   * @param {object} options
   * @param {string} options.method
   * @param {string} options.url
   * @param {Record<string, string>} [options.headers]
   * @param {string} [options.data]
   * @returns {Promise<{ status: number; responseText: string; responseHeaders: string }>}
   */
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method,
        url: options.url,
        headers: options.headers,
        data: options.data,
        onload(response) {
          resolve({
            status: response.status,
            responseText: response.responseText,
            responseHeaders: response.responseHeaders,
          });
        },
        onerror(error) {
          reject(new Error(error?.error || 'Network request failed'));
        },
        ontimeout() {
          reject(new Error('Request timed out'));
        },
        timeout: 120000,
      });
    });
  }

  /** @param {string} body @param {string} idempotencyKey @param {boolean} [allowEmptySnapshot] */
  async function postSyncPayload(body, idempotencyKey, allowEmptySnapshot = false, config = loadConfig()) {
    assertConfig(config);
    const token = config.deviceToken;
    if (!token) {
      throw new Error('No device token configured. Pair a device from the portal first.');
    }

    /** @type {Record<string, unknown>} */
    const payload = JSON.parse(body);
    if (allowEmptySnapshot) {
      payload.allowEmptySnapshot = true;
    }

    const response = await gmRequest({
      method: 'POST',
      url: `${config.backendUrl}/api/v2/sync`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: JSON.stringify(payload),
    });

    let parsed = null;
    try {
      parsed = response.responseText ? JSON.parse(response.responseText) : null;
    } catch {
      parsed = null;
    }

    if (response.status >= 200 && response.status < 300) {
      if (!parsed || typeof parsed !== 'object' || !Number.isInteger(parsed.revision) || !parsed.result) throw new Error('Unexpected sync response; sign in or check the server.');
      return parsed;
    }

    const code = parsed?.error?.code || `HTTP_${response.status}`;
    const message = parsed?.error?.message || response.responseText || `Sync failed (${response.status})`;
    const err = new Error(message);
    err.code = code;
    err.status = response.status;
    err.response = parsed;
    if (code === 'SOURCE_IDENTITY_MISMATCH') {
      err.message =
        'Sync blocked. SEQTA shows a different student than this profile is bound to. Switch profile or sign in to the correct SEQTA account.';
    }
    throw err;
  }

  /** @param {string} code @param {string} [deviceName] */
  async function pairDevice(code, deviceName = 'Browser') {
    const config = loadConfig();
    const response = await gmRequest({
      method: 'POST',
      url: `${config.backendUrl}/api/v2/device/pair`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ code, deviceName }),
    });
    const parsed = response.responseText ? JSON.parse(response.responseText) : null;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(parsed?.error?.message || `Pairing failed (${response.status})`);
    }
    upsertDeviceProfile({
      name: deviceName,
      deviceToken: parsed.deviceToken,
      deviceId: parsed.deviceId || '',
      calendarLabel: parsed.calendarLabel || deviceName,
    });
    return parsed;
  }

  /** @returns {Promise<object>} */
  async function fetchDeviceStatus(config = loadConfig()) {
    assertConfig(config);
    const token = config.deviceToken;
    if (!token) {
      return null;
    }
    const response = await gmRequest({
      method: 'GET',
      url: `${config.backendUrl}/api/v2/status`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = response.responseText ? JSON.parse(response.responseText) : null;
    if (response.status < 200 || response.status >= 300) {
      const code = parsed?.error?.code || `HTTP_${response.status}`;
      const message = parsed?.error?.message || `Device status failed (${response.status})`;
      const err = new Error(message);
      err.code = code;
      err.status = response.status;
      throw err;
    }
    if (!parsed || !parsed.feed || !Number.isInteger(parsed.feed.revision)) throw new Error('Unexpected device status response.');
    return parsed;
  }

  /** @param {{ lessons?: unknown[]; coverage?: CoverageWeek[] }} payload */
  function needsEmptySnapshotConfirmation(payload) {
    if ((payload.lessons?.length ?? 0) > 0) return false;
    let completeDays = 0;
    for (const week of payload.coverage ?? []) {
      if (!week.complete) continue;
      const from = parseLocalDate(week.from);
      const until = parseLocalDate(week.until);
      completeDays += Math.round((until.getTime() - from.getTime()) / 86400000) + 1;
    }
    return completeDays > 7;
  }

  async function reportAutoCheck(config,outcome,reason) {
    try {
      assertConfig(config);
      await gmRequest({method:'POST',url:config.backendUrl+'/api/v2/device/check',headers:{Authorization:'Bearer '+config.deviceToken,'Content-Type':'application/json'},data:JSON.stringify({outcome,reason})});
    } catch (_) { /* do not report arbitrary error text or credentials */ }
  }

  /** @typedef {{ from: string; until: string; complete: boolean }} CoverageWeek */
  function assertConfig(config) {
    const current=loadConfig();
    if(current.backendUrl!==config.backendUrl||current.profileId!==config.profileId||current.deviceToken!==config.deviceToken||current.studentRefOverride!==config.studentRefOverride||current.weeksAhead!==config.weeksAhead)throw new Error('Profile changed during sync; retry.');
  }
  function sourceMarkers(items,range) {
    const days=new Map();
    for(const item of items){
      if(!item||typeof item.date!=='string'||item.date<range.from||item.date>range.until||!/^\d{4}-\d{2}-\d{2}$/.test(item.date))continue;
      const type=String(item.type||'').toLowerCase(),title=String(item.description||'').trim();
      if(!['note','holiday','assembly-note'].includes(type))continue;
      const week=title.match(/^week\s*([AB])$/i),term=title.match(/^term\s+([1-4])$/i);
      if(!week&&!term&&type!=='holiday')continue;
      const entry=days.get(item.date)||{date:item.date};
      if(week){const label=week[1].toUpperCase();if(entry.week&&entry.week!==label)throw new Error('Conflicting source week labels.');entry.week=label;}
      if(term)entry.term='Term '+term[1];
      if(type==='holiday')entry.holiday=(title||'School holiday').slice(0,80);
      days.set(item.date,entry);
    }
    return [...days.values()];
  }
  async function freshStudentRef(config){
    assertConfig(config);cachedLogin=null;
    const student=await resolveStudentRef();assertConfig(config);return student;
  }
  async function buildSyncPayload(onProgress,config=loadConfig()) {
    const studentRef=await freshStudentRef(config);
    const weekRanges=buildWeekRanges(config.weeksAhead),coverage=[],allLessons=[],schoolDays=[];
    let weeksOk=0,weeksFailed=0,emptyWeeks=0;
    for(let i=0;i<weekRanges.length;i++){
      assertConfig(config);
      const range=weekRanges[i];onProgress('Fetching week '+(i+1)+'/'+weekRanges.length+'…');
      try{
        const items=await fetchTimetableWeek(range);
        if(!Array.isArray(items))throw new Error('Missing timetable array.');
        if(items.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new Error('Malformed timetable item.');
        const lessons=dedupeLessons(items);
        if(lessons.some(l=>l.date<range.from||l.date>range.until))throw new Error('Timetable response is outside requested week.');
        const markers=sourceMarkers(items,range);
        const weekdays=Array.from({length:5},(_,j)=>{const d=parseLocalDate(range.from);d.setDate(d.getDate()+j);return toISODate(d);});
        const holidayWeek=weekdays.every(day=>markers.some(m=>m.date===day&&m.holiday));
        const invalidItems=items.some(x=>!SKIP_LESSON_TYPES.has(String(x.type||'').toLowerCase())&&(!shouldIncludeLesson(x)||!mapLessonToPayload(x)));
        const complete=!invalidItems&&(lessons.length>0||holidayWeek);
        allLessons.push(...lessons);
        coverage.push({...range,complete});
        if(complete){schoolDays.push(...markers);weeksOk++;}else if(invalidItems){weeksFailed++;}else{emptyWeeks++;}
      }catch(_){coverage.push({...range,complete:false});weeksFailed++;}
    }
    if(!allLessons.length&&weeksFailed>0){
      onProgress('SEQTA API unavailable — reading visible page without deletion authority…');
      const visible=weekRangeContaining(new Date()),dom=dedupeLessons(extractLessonsFromDom());
      if(dom.length&&dom.every(l=>l.date>=visible.from&&l.date<=visible.until)){
        allLessons.push(...dom);
        if(!coverage.some(r=>r.from<=visible.from&&r.until>=visible.until))coverage.push({...visible,complete:false});
      }
    }
    const seen=new Set(),lessons=allLessons.filter(l=>!seen.has(l.sourceKey)&&seen.add(l.sourceKey));
    if(lessons.length>DEFAULTS.maxLessons)throw new Error('Snapshot exceeds lesson limit. Reduce weeks to sync.');
    if(await freshStudentRef(config)!==studentRef)throw new Error('SEQTA identity changed during sync; retry.');
    return {payload:{schemaVersion:1,schoolHost:location.hostname,studentRef,timezone:DEFAULTS.timezone,generatedAt:formatGeneratedAt(),coverage,lessons,schoolDays},stats:{weeksOk,weeksFailed,emptyWeeks,lessonCount:lessons.length}};
  }
  function snapshotJson(payload){
    const {generatedAt,...stable}=payload;
    return JSON.stringify({...stable,coverage:[...stable.coverage].sort((a,b)=>a.from.localeCompare(b.from)),lessons:[...stable.lessons].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)),schoolDays:[...(stable.schoolDays||[])].sort((a,b)=>a.date.localeCompare(b.date))});
  }
  async function snapshotDigest(payload){
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshotJson(payload))));
    return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function autoKey(config){return STORAGE.autoPrefix+JSON.stringify([config.profileId,location.hostname,config.backendUrl]);}
  function autoEnabled(config){return !!config.profileId&&getSetting(autoKey(config)+'.enabled')===true}
  function setAutoEnabled(config,value){if(config.profileId)setSetting(autoKey(config)+'.enabled',!!value)}
  let syncBusy=false;
  async function withSyncLock(auto,callback){
    if(syncBusy)throw new Error('Sync already running.');
    if(auto&&!navigator.locks?.request)throw new Error('Browser does not support safe multi-tab auto sync.');
    syncBusy=true;
    try{
      if(navigator.locks?.request)return await navigator.locks.request('seqta-link-timetable-sync',{ifAvailable:true},lock=>{if(!lock)throw new Error('Sync already running in another tab.');return callback();});
      return await callback();
    }finally{syncBusy=false;}
  }
  async function runSync(onProgress,options={}){
    const config=options.config||loadConfig(),auto=!!options.auto;
    return withSyncLock(auto,async()=>{
      assertConfig(config);
      const status=await fetchDeviceStatus(config);
      if(auto&&!status.sync?.sourceBound){await reportAutoCheck(config,'skipped','unbound');return {skipped:true,reason:'Complete one manual sync first.'};}
      onProgress('Building timetable snapshot…');
      const {payload,stats}=await buildSyncPayload(onProgress,config);
      if(options.expectedStudentRef&&payload.studentRef!==options.expectedStudentRef)throw new Error('SEQTA student changed after confirmation.');
      if(auto&&(stats.weeksFailed||!stats.weeksOk||!stats.lessonCount)){
        await reportAutoCheck(config,'skipped',stats.weeksFailed?'partial':'empty');
        return {skipped:true,reason:'Incomplete or empty source snapshot; existing timetable retained.'};
      }
      let allowEmptySnapshot=false;
      if(needsEmptySnapshotConfirmation(payload)){
        if(auto||!window.confirm('No lessons in the confirmed source ranges. Remove existing lessons in those verified ranges?'))return {skipped:true,reason:'Empty snapshot not confirmed.'};
        allowEmptySnapshot=true;
      }
      if(!payload.lessons.length&&!payload.coverage.some(r=>r.complete))return {skipped:true,reason:'No authoritative lessons or holiday coverage; nothing uploaded.'};
      const digest=await snapshotDigest(payload),key=autoKey(config)+'.snapshot',previous=getSetting(key);
      if(auto&&previous?.digest===digest&&previous?.revision===status.feed.revision){
        await reportAutoCheck(config,'unchanged','ok');return {skipped:true,reason:'Timetable unchanged.'};
      }
      assertConfig(config);
      const idempotencyKey=crypto.randomUUID();
      onProgress('Uploading '+stats.lessonCount+' lessons…');
      const result=await postSyncPayload(JSON.stringify(payload),idempotencyKey,allowEmptySnapshot,config);
      if(stats.weeksFailed===0&&stats.weeksOk>0)setSetting(key,{digest,revision:result.revision});
      if(auto)await reportAutoCheck(config,'uploaded','ok');
      return {result,stats,idempotencyKey,emptySnapshotConfirmed:allowEmptySnapshot};
    });
  }
  function startAutoSync(onStatus){
    let running=false;
    const tick=async()=>{
      if(running||syncBusy||document.visibilityState!=='visible'||!navigator.locks?.request)return;
      const config=loadConfig();
      if(!autoEnabled(config)||!config.deviceToken.startsWith('sl_dvc_')||config.studentRefOverride||isParentContext())return;
      try{if(new URL(config.backendUrl).protocol!=='https:')return;}catch(_){return;}
      const key=autoKey(config)+'.attempt',previous=Number(getSetting(key)||0);
      if(Date.now()-previous<15*60000)return;
      running=true;setSetting(key,Date.now());
      try{
        const outcome=await runSync(()=>{}, {auto:true,config});
        onStatus(outcome.skipped?'Auto sync: '+outcome.reason:'Auto sync: '+outcome.stats.lessonCount+' lessons checked.','success');
      }catch(error){
        const reason=error?.code==='SOURCE_IDENTITY_MISMATCH'||/identity|student|profile changed/i.test(String(error?.message))?'identity':/already running/i.test(String(error?.message))?'busy':error?.status?'backend':'network';
        await reportAutoCheck(config,'failed',reason);
        onStatus('Auto sync paused until next check ('+reason+').','error');
        setSetting(key,Date.now()+15*60000);
      }finally{running=false;}
    };
    window.setTimeout(tick,8000);
    window.setInterval(tick,60000);
    document.addEventListener('visibilitychange',tick);
  }

const UI_ID = "seqta-calendar-sync-root";

function injectStyles() {
  if (document.getElementById(`${UI_ID}-styles`)) return;
  const style = document.createElement("style");
  style.id = `${UI_ID}-styles`;
  style.textContent = `
      #${UI_ID} { font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 13px; }
      #${UI_ID} .scs-wrap { display: inline-flex; align-items: center; gap: 8px; margin-left: 8px; }
      #${UI_ID} .scs-btn {
        border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 6px;
        padding: 6px 12px; cursor: pointer; font-size: 13px; line-height: 1.2;
      }
      #${UI_ID} .scs-btn:hover { background: #1d4ed8; }
      #${UI_ID} .scs-btn.secondary { background: #fff; color: #1e293b; border-color: #cbd5e1; }
      #${UI_ID} .scs-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      #${UI_ID} .scs-status { max-width: 360px; color: #334155; white-space: normal; }
      #${UI_ID} .scs-status.error { color: #b91c1c; }
      #${UI_ID} .scs-status.success { color: #166534; }
      #${UI_ID} .scs-backdrop {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 999998;
        display: flex; align-items: center; justify-content: center;
      }
      #${UI_ID} .scs-modal {
        background: #fff; border-radius: 10px; width: min(480px, calc(100vw - 32px));
        box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25); padding: 20px; z-index: 999999;
      }
      #${UI_ID} .scs-modal h2 { margin: 0 0 12px; font-size: 18px; }
      #${UI_ID} .scs-field { margin-bottom: 12px; }
      #${UI_ID} .scs-field label { display: block; font-weight: 600; margin-bottom: 4px; }
      #${UI_ID} .scs-field input {
        width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px;
        padding: 8px 10px; font-size: 13px; color: #0f172a;
      }
      #${UI_ID} .scs-field input::placeholder {
        color: #94a3b8; opacity: 1;
      }
      #${UI_ID} .scs-field input::-webkit-input-placeholder { color: #94a3b8; }
      #${UI_ID} .scs-field input::-moz-placeholder { color: #94a3b8; opacity: 1; }
      #${UI_ID} .scs-field small { display: block; margin-top: 4px; color: #64748b; }
      #${UI_ID} .scs-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      #${UI_ID} .scs-link { color: #2563eb; text-decoration: none; }
      #${UI_ID} .scs-link:hover { text-decoration: underline; }
    `;
  document.head.appendChild(style);
}

function mountUi() {
  if (document.getElementById(UI_ID)) return;

  injectStyles();

  const root = document.createElement("div");
  root.id = UI_ID;

  const wrap = document.createElement("div");
  wrap.className = "scs-wrap";

  const syncBtn = document.createElement("button");
  syncBtn.type = "button";
  syncBtn.className = "scs-btn";
  syncBtn.textContent = "Sync Timetable";

  const pairBtn = document.createElement("button");
  pairBtn.type = "button";
  pairBtn.className = "scs-btn secondary";
  pairBtn.textContent = "Pair device";

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "scs-btn secondary";
  settingsBtn.textContent = "Calendar Settings";

  const status = document.createElement("div");
  status.className = "scs-status";

  wrap.appendChild(syncBtn);
  wrap.appendChild(pairBtn);
  wrap.appendChild(settingsBtn);
  wrap.appendChild(status);
  root.appendChild(wrap);

  const toolbar = document.getElementById("toolbar");
  if (toolbar) {
    toolbar.appendChild(root);
  } else {
    root.style.position = "fixed";
    root.style.top = "12px";
    root.style.right = "12px";
    root.style.zIndex = "999997";
    root.style.background = "#fff";
    root.style.padding = "8px";
    root.style.borderRadius = "8px";
    root.style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)";
    document.body.appendChild(root);
  }

  /** @param {string} message @param {'info'|'success'|'error'} [kind] */
  function setStatus(message, kind = "info") {
    status.textContent = message;
    status.className = `scs-status${kind === "error" ? " error" : kind === "success" ? " success" : ""}`;
  }

  function openSettingsModal() {
    const existing = document.querySelector(`#${UI_ID} .scs-backdrop`);
    if (existing) existing.remove();

    const config = loadConfig();
    const backdrop = document.createElement("div");
    backdrop.className = "scs-backdrop";

    const modal = document.createElement("div");
    modal.className = "scs-modal";
    modal.innerHTML = `
        <h2>Seqta Link</h2>
        <div class="scs-field">
          <label for="scs-backend">Backend URL</label>
          <input id="scs-backend" type="url" placeholder="https://timetable.yanze.me" />
          <small>Base URL of your Seqta Link server (no trailing slash).</small>
        </div>
        <div class="scs-field">
          <label for="scs-profile">Active profile</label>
          <select id="scs-profile"></select>
          <small>Switch between paired accounts on this browser.</small>
        </div>
        <div class="scs-field">
          <label for="scs-token">Legacy upload token (optional)</label>
          <input id="scs-token" type="password" autocomplete="off" placeholder="scu_…" />
          <small>Only for admin-provisioned legacy feeds.</small>
        </div>
        <div class="scs-field">
          <label for="scs-calendar">Calendar URL (optional)</label>
          <input id="scs-calendar" type="url" placeholder="https://timetable.example/calendar/sl_cal_….ics" />
          <small>Apple Calendar subscription link — shown after successful sync.</small>
        </div>
        <div class="scs-field">
          <label for="scs-weeks">Weeks to sync</label>
          <input id="scs-weeks" type="number" min="1" max="${DEFAULTS.maxWeeks}" />
          <small>Week-by-week fetch (max ${DEFAULTS.maxWeeks} weeks ≈ 119 days).</small>
        </div>
        <div class="scs-field">
          <label><input id="scs-auto" type="checkbox" /> Smart Auto Sync</label>
          <small>Check every 15 minutes while SEQTA is visible and signed in. Only the selected profile; complete one manual sync first.</small>
        </div>
        <div class="scs-field">
          <label for="scs-student">Student ref override (optional)</label>
          <input id="scs-student" type="text" placeholder="4284" />
          <small>Must match the feed's studentRef. Auto-detected when possible.</small>
        </div>
        <div class="scs-actions">
          <button type="button" class="scs-btn secondary" data-action="cancel">Cancel</button>
          <button type="button" class="scs-btn" data-action="save">Save</button>
        </div>
      `;

    /** @type {HTMLInputElement | null} */
    const backendInput = modal.querySelector("#scs-backend");
    /** @type {HTMLSelectElement | null} */
    const profileSelect = modal.querySelector("#scs-profile");
    /** @type {HTMLInputElement | null} */
    const tokenInput = modal.querySelector("#scs-token");
    /** @type {HTMLInputElement | null} */
    const calendarInput = modal.querySelector("#scs-calendar");
    /** @type {HTMLInputElement | null} */
    const weeksInput = modal.querySelector("#scs-weeks");
    /** @type {HTMLInputElement | null} */
    const studentInput = modal.querySelector("#scs-student");
    const autoInput = modal.querySelector("#scs-auto");

    const profiles = loadProfiles();
    if (profileSelect) {
      profileSelect.innerHTML = profiles.length
        ? profiles.map((p) => `<option value="${p.id}">${p.name} (${p.calendarLabel || p.name})</option>`).join('')
        : '<option value="">No profiles — pair a device</option>';
      const active = getActiveProfile();
      if (active) profileSelect.value = active.id;
    }
    if (backendInput) backendInput.value = config.backendUrl;
    if (tokenInput) tokenInput.value = config.uploadToken;
    if (calendarInput) calendarInput.value = config.calendarUrl;
    if (weeksInput) weeksInput.value = String(config.weeksAhead);
    if (studentInput) studentInput.value = config.studentRefOverride;
    if (autoInput) autoInput.checked = autoEnabled(config);
    profileSelect?.addEventListener("change",()=>{if(autoInput)autoInput.checked=false;});
    backendInput?.addEventListener("input",()=>{if(autoInput)autoInput.checked=false;});

    backdrop.appendChild(modal);
    root.appendChild(backdrop);

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) backdrop.remove();
    });

    modal
      .querySelector('[data-action="cancel"]')
      ?.addEventListener("click", () => backdrop.remove());
    modal
      .querySelector('[data-action="save"]')
      ?.addEventListener("click", async () => {
        setSetting(
          STORAGE.backendUrl,
          backendInput?.value.trim() || DEFAULTS.backendUrl,
        );
        if (profileSelect?.value) {
          setActiveProfileId(profileSelect.value);
        }
        setSetting(STORAGE.uploadToken, tokenInput?.value.trim() || "");
        setSetting(STORAGE.calendarUrl, calendarInput?.value.trim() || "");
        setSetting(
          STORAGE.weeksAhead,
          clampWeeks(Number(weeksInput?.value) || DEFAULTS.weeksAhead),
        );
        setSetting(
          STORAGE.studentRefOverride,
          studentInput?.value.trim() || "",
        );
        setAutoEnabled(loadConfig(),!!autoInput?.checked);
        backdrop.remove();
        setStatus("Settings saved.", "success");
      });
  }

  function openPairModal() {
    const existing = document.querySelector(`#${UI_ID} .scs-backdrop`);
    if (existing) existing.remove();

    const config = loadConfig();
    const backdrop = document.createElement("div");
    backdrop.className = "scs-backdrop";
    const modal = document.createElement("div");
    modal.className = "scs-modal";
    modal.innerHTML = `
        <h2>Pair this browser</h2>
        <div class="scs-field">
          <label for="scs-backend-pair">Backend URL</label>
          <input id="scs-backend-pair" type="url" placeholder="https://timetable.yanze.me" />
        </div>
        <div class="scs-field">
          <label for="scs-pair-code">Pairing code</label>
          <input id="scs-pair-code" type="text" placeholder="7K4P-92MX" autocomplete="off" />
          <small>Portal → Devices → Generate pairing code (valid 10 minutes).</small>
        </div>
        <div class="scs-field">
          <label for="scs-device-name">Device name</label>
          <input id="scs-device-name" type="text" placeholder="Chrome on MacBook" />
        </div>
        <div class="scs-actions">
          <button type="button" class="scs-btn secondary" data-action="cancel">Cancel</button>
          <button type="button" class="scs-btn" data-action="pair">Pair</button>
        </div>
      `;
    /** @type {HTMLInputElement | null} */
    const backendInput = modal.querySelector("#scs-backend-pair");
    /** @type {HTMLInputElement | null} */
    const pairCodeInput = modal.querySelector("#scs-pair-code");
    /** @type {HTMLInputElement | null} */
    const deviceNameInput = modal.querySelector("#scs-device-name");
    if (backendInput) backendInput.value = config.backendUrl;
    if (deviceNameInput) {
      deviceNameInput.value = `${navigator.userAgentData?.brands?.[0]?.brand || "Browser"} on ${navigator.platform || "device"}`;
    }
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) backdrop.remove();
    });
    modal.querySelector('[data-action="cancel"]')?.addEventListener("click", () => backdrop.remove());
    modal.querySelector('[data-action="pair"]')?.addEventListener("click", async () => {
      const backendUrl = backendInput?.value.trim() || DEFAULTS.backendUrl;
      const code = pairCodeInput?.value.trim() || "";
      const deviceName = deviceNameInput?.value.trim() || "Browser";
      if (!code) {
        setStatus("Enter a pairing code.", "error");
        return;
      }
      setSetting(STORAGE.backendUrl, backendUrl);
      try {
        const paired = await pairDevice(code, deviceName);
        backdrop.remove();
        setStatus(
          `Paired as ${paired.calendarLabel}. Get the Apple Calendar URL in Portal → Calendar.`,
          "success",
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    });
  }

  settingsBtn.addEventListener("click", openSettingsModal);
  pairBtn.addEventListener("click", openPairModal);

  syncBtn.addEventListener("click", async () => {
    const config = loadConfig();
    if (!config.deviceToken) {
      setStatus("Pair a device first.", "error");
      openPairModal();
      return;
    }

    let studentRef;try{studentRef=await freshStudentRef(config);}catch(_){setStatus("Could not verify the current SEQTA student.","error");return;}
    const confirmed = window.confirm(
      `Current SEQTA student: ${studentRef}\nDestination account: ${config.calendarLabel}\n\nSync now?`,
    );
    if (!confirmed) return;

    syncBtn.disabled = true;
    pairBtn.disabled = true;
    settingsBtn.disabled = true;
    setStatus("Starting sync…");

    try {
      const outcome = await runSync(setStatus,{config,expectedStudentRef:studentRef});
      if(outcome.skipped){setStatus(outcome.reason,"success");return;}
      const { result, stats, emptySnapshotConfirmed }=outcome;
      const r = result?.result || {};
      const changed = result?.changed ? " (calendar updated)" : "";
      const replayed = result?.replayed ? " [replay]" : "";
      const emptyNote = emptySnapshotConfirmed
        ? " Empty holiday snapshot confirmed."
        : "";
      let message =
        `Sync OK${changed}${replayed}: ${stats.lessonCount} lessons, ` +
        `${r.inserted ?? 0} new, ${r.updated ?? 0} updated, ${r.removed ?? 0} removed.` +
        emptyNote;
      if (stats.weeksFailed > 0) {
        message += ` Warning: ${stats.weeksFailed} week(s) incomplete — deletions skipped for those ranges.`;
      }
      setStatus(message, "success");

      const calendarUrl = loadConfig().calendarUrl;
      if (calendarUrl) {
        const link = document.createElement("a");
        link.href = calendarUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "scs-link";
        link.textContent = " Open calendar feed";
        status.appendChild(link);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, "error");
      console.error("[seqta-calendar-sync]", error);
    } finally {
      syncBtn.disabled = false;
      pairBtn.disabled = false;
      settingsBtn.disabled = false;
    }
  });

  const config = loadConfig();
  if (!config.deviceToken) {
    setStatus("Click Pair device to connect this browser.");
  } else {
    setStatus(`Profile: ${config.calendarLabel}`);
  }
  startAutoSync(setStatus);
}

function waitForTimetablePage() {
  const selectors = [".timetablepage", ".timetable", "#toolbar"];
  const found = selectors.some((sel) => document.querySelector(sel));
  if (found) {
    mountUi();
    return;
  }

  const observer = new MutationObserver(() => {
    if (selectors.some((sel) => document.querySelector(sel))) {
      observer.disconnect();
      mountUi();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Also mount a floating panel after timeout so settings remain reachable on non-timetable pages.
  window.setTimeout(() => {
    if (!document.getElementById(UI_ID)) mountUi();
  }, 5000);
}

waitForTimetablePage();
})();
