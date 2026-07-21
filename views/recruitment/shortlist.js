import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, scoreBar, stagePill, openModal, closeModal } from '../../js/ui.js';
import { routeParams, navigate } from '../../js/router.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function shortlistView(container) {
  const org = getOrg();
  const params = routeParams();
  const jobId = params.job;

  if (!jobId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No job selected</div><div class="empty-state-desc">Select a job to view shortlisted candidates.</div></div>`;
    return;
  }

  container.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>`;

  const [{ data: job }, { data: applications }] = await Promise.all([
    sb.from('jobs').select('*').eq('id', jobId).maybeSingle(),
    sb.from('job_applications')
      .select('*, candidate:candidate_id(full_name, email, phone)')
      .eq('job_id', jobId)
      .order('match_score', { ascending: false }),
  ]);

  if (!job) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Job not found</div></div>`;
    return;
  }

  const apps = applications || [];
  const shortlisted = apps.filter(a => a.status === 'shortlisted');
  const all = apps;

  let minScore = 0;
  let showAll = false;

  function render() {
    const displayed = showAll ? all : all.filter(a => (a.match_score || 0) >= minScore);

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap">
        <button class="btn btn-ghost" id="back-btn" style="padding:var(--space-2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style="flex:1">
          <h1 class="page-title" style="margin:0">${esc(job.title)}</h1>
          <p class="page-subtitle" style="margin:0;margin-top:var(--space-1)">${shortlisted.length} shortlisted of ${all.length} candidates</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-body" style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
          <div class="form-group" style="margin:0;flex:1;min-width:200px">
            <label class="form-label" style="font-size:var(--text-xs)">Min Match Score: <strong id="score-display">${minScore}</strong></label>
            <input type="range" id="score-slider" min="0" max="100" value="${minScore}" style="width:100%">
          </div>
          <label style="font-size:var(--text-sm);display:flex;align-items:center;gap:var(--space-2)">
            <input type="checkbox" id="show-all" ${showAll ? 'checked' : ''}> Show all statuses
          </label>
          <button class="btn btn-primary btn-sm" id="shortlist-top">Shortlist Top 5</button>
        </div>
      </div>

      <div class="card">
        ${displayed.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th><input type="checkbox" id="select-all"></th><th>Candidate</th><th>Score</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${displayed.map(a => `<tr>
            <td><input type="checkbox" class="app-check" value="${a.id}" ${a.status === 'shortlisted' ? 'checked disabled' : ''}></td>
            <td>
              <div style="font-weight:var(--font-weight-medium)">${esc(a.candidate?.full_name || '—')}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(a.candidate?.email || '')}</div>
            </td>
            <td>${scoreBar(a.match_score)}</td>
            <td><span class="badge badge-neutral">${esc(a.match_method || '—')}</span></td>
            <td>${stagePill(a.status)}</td>
            <td>
              <div style="display:flex;gap:var(--space-1)">
                ${a.status !== 'shortlisted' && a.status !== 'rejected' ? `<button class="btn btn-primary btn-sm" data-shortlist="${a.id}">Shortlist</button>` : ''}
                ${a.status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" data-reject="${a.id}" style="color:var(--color-error)">Reject</button>` : ''}
                <button class="btn btn-ghost btn-sm" data-view-candidate="${a.candidate_id}">Profile</button>
              </div>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No candidates match this filter</div></div>'}
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', () => navigate('recruitment'));

    document.getElementById('score-slider').addEventListener('input', (e) => {
      minScore = parseInt(e.target.value);
      document.getElementById('score-display').textContent = minScore;
    });
    document.getElementById('score-slider').addEventListener('change', render);

    document.getElementById('show-all').addEventListener('change', (e) => {
      showAll = e.target.checked;
      render();
    });

    document.getElementById('select-all')?.addEventListener('change', (e) => {
      container.querySelectorAll('.app-check:not(:disabled)').forEach(cb => { cb.checked = e.target.checked; });
    });

    document.getElementById('shortlist-top').addEventListener('click', async () => {
      const top5 = all
        .filter(a => a.status !== 'shortlisted' && a.status !== 'rejected')
        .sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
        .slice(0, 5);

      if (!top5.length) { toast('No candidates to shortlist'); return; }

      for (const a of top5) {
        const { error } = await sb.from('job_applications').update({
          status: 'shortlisted', shortlisted_at: new Date().toISOString(),
        }).eq('id', a.id);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('recruitment', 'job_application', a.id, 'shortlisted', { status: a.status }, { status: 'shortlisted' });
        await publishEvent('recruitment.candidate.shortlisted', { job_id: jobId, candidate_id: a.candidate_id, score: a.match_score });
      }
      toast(`${top5.length} candidates shortlisted`);
      shortlistView(container);
    });

    container.querySelectorAll('[data-shortlist]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('job_applications').update({
          status: 'shortlisted', shortlisted_at: new Date().toISOString(),
        }).eq('id', btn.dataset.shortlist);
        if (error) { toast('Failed: ' + error.message); return; }
        const app = apps.find(a => a.id === btn.dataset.shortlist);
        await logAction('recruitment', 'job_application', btn.dataset.shortlist, 'shortlisted', { status: app?.status }, { status: 'shortlisted' });
        await publishEvent('recruitment.candidate.shortlisted', { job_id: jobId, candidate_id: app?.candidate_id, score: app?.match_score });
        toast('Candidate shortlisted');
        shortlistView(container);
      });
    });

    container.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Reason (optional)</label><textarea class="form-input" id="rej-reason" rows="2"></textarea></div>
          <button class="btn btn-danger" id="rej-confirm">Reject</button>
        </div>`;
        openModal('Reject Candidate', f);
        f.querySelector('#rej-confirm').addEventListener('click', async () => {
          const reason = f.querySelector('#rej-reason').value || null;
          const { error } = await sb.from('job_applications').update({
            status: 'rejected', rejection_reason: reason,
          }).eq('id', btn.dataset.reject);
          if (error) { toast('Failed: ' + error.message); return; }
          await logAction('recruitment', 'job_application', btn.dataset.reject, 'rejected', { status: 'applied' }, { status: 'rejected', rejection_reason: reason });
          closeModal();
          toast('Candidate rejected');
          shortlistView(container);
        });
      });
    });

    container.querySelectorAll('[data-view-candidate]').forEach(btn => {
      btn.addEventListener('click', () => navigate('recruitment/candidate?id=' + btn.dataset.viewCandidate));
    });
  }

  render();
}
