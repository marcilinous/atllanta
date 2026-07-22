const routes = {};
let currentView = null;
let contentEl = null;

export function registerRoute(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = '#/' + path;
}

export function currentRoute() {
  const hash = window.location.hash.slice(2) || 'dashboard';
  return hash.split('?')[0];
}

export function routeParams() {
  const hash = window.location.hash.slice(2) || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(qIdx)));
}

async function handleRoute() {
  const path = currentRoute();
  const handler = routes[path];

  if (!contentEl) return;

  if (!handler) {
    contentEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>
      <div class="empty-state-title">Page not found</div>
      <div class="empty-state-desc">The page you're looking for doesn't exist.</div>
    </div>`;
    return;
  }

  currentView = path;
  contentEl.innerHTML = '';
  await handler(contentEl);
  updateActiveNav(path);
}

function updateActiveNav(path) {
  const base = path.split('/')[0];
  const navAliases = { employees: 'people', approvals: 'inbox', leave: 'me', attendance: 'me', lifecycle: 'people', assets: 'people', letters: 'people', announcements: 'admin', audit: 'admin' };
  const navKey = navAliases[base] || base;
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === path || btn.dataset.view === base || btn.dataset.view === navKey);
  });
}

export function initRouter(container) {
  contentEl = container;
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
