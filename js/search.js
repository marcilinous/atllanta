import sb from './supabase.js';
import { getOrg } from './auth.js';
import { esc } from './ui.js';
import { navigate } from './router.js';

let searchEl = null;
let resultsEl = null;
let debounceTimer = null;

export function initGlobalSearch() {
  searchEl = document.getElementById('global-search');
  if (!searchEl) return;

  resultsEl = document.createElement('div');
  resultsEl.className = 'search-results hidden';
  searchEl.parentElement.style.position = 'relative';
  searchEl.parentElement.appendChild(resultsEl);

  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchEl.value.trim();
    if (q.length < 2) { resultsEl.classList.add('hidden'); return; }
    debounceTimer = setTimeout(() => runSearch(q), 300);
  });

  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { resultsEl.classList.add('hidden'); searchEl.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = resultsEl.querySelectorAll('.search-item');
      if (!items.length) return;
      const active = resultsEl.querySelector('.search-item.active');
      let idx = active ? Array.from(items).indexOf(active) : -1;
      if (active) active.classList.remove('active');
      idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      const active = resultsEl.querySelector('.search-item.active');
      if (active) { e.preventDefault(); active.click(); }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) resultsEl.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchEl.focus();
    }
  });
}

async function runSearch(query) {
  const org = getOrg();
  if (!org) return;

  const q = `%${query}%`;

  const [{ data: users }, { data: candidates }, { data: jobs }] = await Promise.all([
    sb.from('users').select('id, full_name, email, designation, department:department_id(name)')
      .or(`full_name.ilike.${q},email.ilike.${q},designation.ilike.${q}`)
      .limit(5),
    sb.from('candidates').select('id, full_name, email, source')
      .or(`full_name.ilike.${q},email.ilike.${q}`)
      .limit(5),
    sb.from('jobs').select('id, title, status, department:department_id(name)')
      .or(`title.ilike.${q}`)
      .limit(5),
  ]);

  const sections = [];

  if (users?.length) {
    sections.push(`<div class="search-section"><div class="search-section-title">Employees</div>
      ${users.map(u => `<div class="search-item" data-nav="employees/profile?id=${u.id}" data-id="${u.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <div><div class="search-item-title">${esc(u.full_name)}</div><div class="search-item-sub">${esc(u.email || '')} ${u.department?.name ? '· ' + esc(u.department.name) : ''}</div></div>
      </div>`).join('')}</div>`);
  }

  if (candidates?.length) {
    sections.push(`<div class="search-section"><div class="search-section-title">Candidates</div>
      ${candidates.map(c => `<div class="search-item" data-nav="recruitment/candidate?id=${c.id}" data-id="${c.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        <div><div class="search-item-title">${esc(c.full_name)}</div><div class="search-item-sub">${esc(c.email || '')} · ${esc(c.source || 'manual')}</div></div>
      </div>`).join('')}</div>`);
  }

  if (jobs?.length) {
    sections.push(`<div class="search-section"><div class="search-section-title">Jobs</div>
      ${jobs.map(j => `<div class="search-item" data-nav="recruitment/job?id=${j.id}" data-id="${j.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <div><div class="search-item-title">${esc(j.title)}</div><div class="search-item-sub">${esc(j.status)} ${j.department?.name ? '· ' + esc(j.department.name) : ''}</div></div>
      </div>`).join('')}</div>`);
  }

  if (!sections.length) {
    resultsEl.innerHTML = `<div class="search-empty">No results for "${esc(query)}"</div>`;
  } else {
    resultsEl.innerHTML = sections.join('');
  }

  resultsEl.classList.remove('hidden');

  resultsEl.querySelectorAll('.search-item').forEach(item => {
    item.addEventListener('click', () => {
      navigate(item.dataset.nav);
      resultsEl.classList.add('hidden');
      searchEl.value = '';
    });
  });
}
