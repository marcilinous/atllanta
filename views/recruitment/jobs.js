import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';

export default async function recruitmentJobs(container) {
  const org = getOrg();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1 class="page-title">Recruitment</h1>
        <p class="page-subtitle">Manage job listings and candidates</p>
      </div>
      <button class="btn btn-primary" id="create-job-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Post Job
      </button>
    </div>
    <div class="tabs" id="job-tabs">
      <button class="tab active" data-filter="all">All</button>
      <button class="tab" data-filter="open">Open</button>
      <button class="tab" data-filter="on_hold">On Hold</button>
      <button class="tab" data-filter="closed">Closed</button>
    </div>
    <div id="jobs-list"></div>
  `;

  if (!org) {
    document.getElementById('jobs-list').innerHTML = `<div class="empty-state"><div class="empty-state-title">Set up your organization first</div></div>`;
    return;
  }

  let filter = 'all';
  const { data: jobs } = await sb.from('jobs').select('*').order('created_at', { ascending: false });
  const allJobs = jobs || [];

  function renderJobs() {
    const listEl = document.getElementById('jobs-list');
    const filtered = filter === 'all' ? allJobs : allJobs.filter(j => j.status === filter);

    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div>
        <div class="empty-state-title">No jobs yet</div>
        <div class="empty-state-desc">Create your first job posting to start matching candidates.</div>
      </div>`;
      return;
    }

    listEl.innerHTML = `<div style="display:grid;gap:var(--space-4)">
      ${filtered.map(j => `
        <div class="card" style="cursor:pointer" onclick="location.hash='#/recruitment/job-detail?id=${j.id}'">
          <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:var(--font-weight-semibold)">${esc(j.title)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:var(--space-1)">
                ${j.location || 'Remote'} &middot; ${j.employment_type || 'Full-time'} &middot; ${j.experience_min || 0}–${j.experience_max || '?'} yrs
              </div>
            </div>
            <span class="badge badge-${j.status === 'open' ? 'success' : j.status === 'closed' ? 'error' : 'warning'}">
              <span class="badge-dot"></span>${j.status}
            </span>
          </div>
        </div>
      `).join('')}
    </div>`;
  }

  renderJobs();

  document.getElementById('job-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#job-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filter = tab.dataset.filter;
    renderJobs();
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
