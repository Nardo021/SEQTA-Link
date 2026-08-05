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
  async function postSyncPayload(body, idempotencyKey, allowEmptySnapshot = false) {
    const config = loadConfig();
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
  async function fetchDeviceStatus() {
    const config = loadConfig();
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
