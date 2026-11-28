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
      const error = new Error(`SEQTA request failed (${res.status}) for ${path}`);
      error.status = res.status;
      throw error;
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
