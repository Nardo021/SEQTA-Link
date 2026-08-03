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
    if (!config.uploadToken) {
      throw new Error('Upload token is not configured. Open settings and paste your scu_… token.');
    }
    if (!config.uploadToken.startsWith('scu_')) {
      throw new Error('Upload token should start with scu_. Check your feed provisioning output.');
    }

    /** @type {Record<string, unknown>} */
    const payload = JSON.parse(body);
    if (allowEmptySnapshot) {
      payload.allowEmptySnapshot = true;
    }

    const url = `${config.backendUrl}/api/v1/sync`;
    const response = await gmRequest({
      method: 'POST',
      url,
      headers: {
        Authorization: `Bearer ${config.uploadToken}`,
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
    throw err;
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
