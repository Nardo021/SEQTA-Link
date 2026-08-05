function apiError(message, status, body) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.status = status;
  error.body = body;
  return error;
}

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
    throw apiError(message, response.status, body);
  }
  return body;
}

const adminApi = api;

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

function renderAdminNav(active) {
  const links = [
    ['dashboard.html', 'Dashboard'],
    ['users.html', 'Users'],
    ['invitations.html', 'Invitations'],
    ['audit.html', 'Audit logs'],
  ];
  return `<nav class="nav">${links
    .map(
      ([href, label]) =>
        `<a href="/admin/${href}" class="${active === href ? 'active' : ''}">${label}</a>`,
    )
    .join('')}<a href="/app/dashboard.html" style="margin-left:auto">User Portal</a></nav>`;
}

function showPageError(targetId, error) {
  const el = document.getElementById(targetId);
  if (!el) throw error;
  el.replaceChildren();
  const p = document.createElement('p');
  p.className = 'error';
  const status = error?.status ? ` (${error.status})` : '';
  p.textContent = `${error?.message || 'Request failed.'}${status}`;
  el.appendChild(p);
}

async function requireAuth() {
  try {
    return await api('/api/me');
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/app/login.html';
      return null;
    }
    throw error;
  }
}

async function requireAdmin() {
  try {
    const me = await api('/api/me');
    const role = me?.user?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw apiError('This account is not an administrator.', 403, me);
    }
    return me;
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/admin/login.html';
      return null;
    }
    throw error;
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
