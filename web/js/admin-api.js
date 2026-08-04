async function adminApi(path, options = {}) {
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

async function requireAdmin() {
  try {
    await adminApi('/api/admin/dashboard');
    return true;
  } catch {
    window.location.href = '/admin/login.html';
    return false;
  }
}
