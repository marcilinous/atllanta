import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, scoreBar, stagePill, formatDate, initials, avColor } from '../../js/ui.js';
import { routeParams, navigate } from '../../js/router.js';

export default async function candidateProfile(container) {
  const org = getOrg();
  const params = routeParams();
  const candidateId = params.id;

  if (!candidateId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No candidate selected</div></div>`;
    return;
  }

  container.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading candidate...</div>`;

  const { data: candidate, error } = await sb
    .from('candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();

  if (error || !candidate) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Candidate not found</div></div>`;
    return;
  }

  const [{ data: applications }, { data: interviews }] = await Promise.all([
    sb.from('job_applications')
      .select('*, job:job_id(title, status)')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    sb.from('interviews')
      .select('*, application:job_application_id(job:job_id(title))')
      .eq('job_application_id', candidateId)
      .order('scheduled_at', { ascending: false }),
  ]);

  const apps = applications || [];
  const intvs = interviews || [];
  const skills = candidate.parsed_skills?.skills || [];

  container.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap">
      <button class="btn btn-ghost" id="back-btn" style="padding:var(--space-2)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div style="display:flex;align-items:center;gap:var(--space-4);flex:1">
        <div style="width:56px;height:56px;border-radius:var(--radius-full);background:${avColor(candidate.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-xl);flex-shrink:0">${initials(candidate.full_name)}</div>
        <div>
          <h1 class="page-title" style="margin:0">${esc(candidate.full_name)}</h1>
          <p class="page-subtitle" style="margin:0;margin-top:var(--space-1)">${esc(candidate.email || '')} ${candidate.phone ? ' · ' + esc(candidate.phone) : ''}</p>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <span class="badge badge-neutral">${esc(candidate.source || 'manual')}</span>
        ${candidate.resume_url ? `<a href="${esc(candidate.resume_url)}" target="_blank" class="btn btn-secondary btn-sm">View Resume</a>` : ''}
      </div>
    </div>

    <div class="grid-2col" style="margin-bottom:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Skills</span></div>
        <div class="card-body">
          ${skills.length ? `<div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">${skills.map(s => `<span class="badge badge-info">${esc(s)}</span>`).join('')}</div>` : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No parsed skills</div>'}
          ${candidate.parsed_skills?.experience_years ? `<div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">Experience: ${candidate.parsed_skills.experience_years} years</div>` : ''}
          ${candidate.parsed_skills?.education?.length ? `<div style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--color-text-secondary)">Education: ${candidate.parsed_skills.education.map(e => esc(e)).join(', ')}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Resume Text</span></div>
        <div class="card-body" style="max-height:300px;overflow-y:auto">
          ${candidate.resume_text ? `<pre style="white-space:pre-wrap;font-size:var(--text-xs);color:var(--color-text-secondary);font-family:var(--font-mono);line-height:1.6">${esc(candidate.resume_text.slice(0, 2000))}${candidate.resume_text.length > 2000 ? '...' : ''}</pre>` : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No resume text extracted</div>'}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header"><span class="card-title">Job Applications</span><span style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-left:var(--space-2)">${apps.length}</span></div>
      ${apps.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Job</th><th>Match Score</th><th>Method</th><th>Stage</th><th>Applied</th></tr></thead>
        <tbody>${apps.map(a => `<tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(a.job?.title || '—')}</td>
          <td>${scoreBar(a.match_score)}</td>
          <td><span class="badge badge-neutral">${esc(a.match_method || '—')}</span></td>
          <td>${stagePill(a.status)}</td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${formatDate(a.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="card-body" style="text-align:center;color:var(--color-text-tertiary)">No applications</div>'}
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Interview History</span></div>
      ${intvs.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Job</th><th>Round</th><th>Date</th><th>Status</th><th>Rating</th><th>Decision</th></tr></thead>
        <tbody>${intvs.map(i => `<tr>
          <td>${esc(i.application?.job?.title || '—')}</td>
          <td>${esc(i.round_name || 'Round ' + i.round_number)}</td>
          <td>${i.scheduled_at ? formatDate(i.scheduled_at) : '—'}</td>
          <td>${stagePill(i.status)}</td>
          <td>${i.rating ? '⭐'.repeat(i.rating) : '—'}</td>
          <td>${i.decision ? stagePill(i.decision) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="card-body" style="text-align:center;color:var(--color-text-tertiary)">No interviews recorded</div>'}
    </div>
  `;

  document.getElementById('back-btn').addEventListener('click', () => navigate('recruitment'));
}
