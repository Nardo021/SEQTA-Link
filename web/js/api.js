async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body?.error?.message || text || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function renderNav(active) {
  const links = [
    ['dashboard.html', 'Dashboard'],
    ['timetable.html', 'Timetable'],
    ['calendar.html', 'Calendar'],
    ['devices.html', 'Devices'],
    ['sync-history.html', 'Sync history'],
    ['account.html', 'Account'],
  ];
  return `<nav class="nav">${links
    .map(
      ([href, label]) =>
        `<a href="/app/${href}" class="${active === href ? 'active' : ''}">${label}</a>`,
    )
    .join('')}</nav>`;
}

async function requireAuth() {
  try {
    return await api('/api/me');
  } catch {
    window.location.href = '/app/login.html';
    return null;
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST', body: '{}' });
  window.location.href = '/app/login.html';
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' });
}
