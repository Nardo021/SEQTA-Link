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
        <h2>Seqta Link Sync</h2>
        <div class="scs-field">
          <label for="scs-backend">Backend URL</label>
          <input id="scs-backend" type="url" placeholder="https://timetable.leoze.top" />
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
          <input id="scs-calendar" type="url" placeholder="https://timetable.leoze.top/calendar/scc_….ics" />
          <small>Apple Calendar subscription link — shown after successful sync.</small>
        </div>
        <div class="scs-field">
          <label for="scs-weeks">Weeks to sync</label>
          <input id="scs-weeks" type="number" min="1" max="${DEFAULTS.maxWeeks}" />
          <small>Week-by-week fetch (max ${DEFAULTS.maxWeeks} weeks ≈ 119 days).</small>
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
          <input id="scs-backend-pair" type="url" placeholder="https://timetable.leoze.top" />
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
    if (!config.deviceToken && !config.uploadToken) {
      setStatus("Pair a device first.", "error");
      openPairModal();
      return;
    }

    const studentRef = await resolveStudentRef();
    const confirmed = window.confirm(
      `Current SEQTA student: ${studentRef}\nDestination account: ${config.calendarLabel}\n\nSync now?`,
    );
    if (!confirmed) return;

    syncBtn.disabled = true;
    pairBtn.disabled = true;
    settingsBtn.disabled = true;
    setStatus("Starting sync…");

    try {
      if (config.deviceToken?.startsWith("dvc_")) {
        setStatus("Checking device…");
        await fetchDeviceStatus();
      }
      const { result, stats, emptySnapshotConfirmed } =
        await runSync(setStatus);
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
  if (!config.deviceToken && !config.uploadToken) {
    setStatus("Click Pair device to connect this browser.");
  } else {
    setStatus(`Profile: ${config.calendarLabel}`);
  }
}
