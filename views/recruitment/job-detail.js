import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { routeParams } from '../../js/router.js';
import { esc, toast } from '../../js/ui.js';

export default async function jobDetail(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = '<p>Please select an organization.</p>'; return; }

  const params = routeParams();
  const jobId = params.id;
  if (!jobId) { container.innerHTML = '<p>No job ID specified.</p>'; return; }

  container.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <a href="#/recruitment" class="btn btn-ghost btn-sm">&larr; Jobs</a>
        <h1 class="page-title" id="job-title">Loading...</h1>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <a href="#/recruitment/shortlist?id=${jobId}" class="btn btn-secondary btn-sm">Shortlist</a>
        <a href="#/recruitment/matcher?job=${jobId}" class="btn btn-secondary btn-sm">Run Matcher</a>
      </div>
    </div>
    <div id="job-content"><div class="skeleton skeleton-text"></div></div>
  `;

  const orgCol = 'org_id';
  const { data: job, error } = await sb
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error || !job) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Job not found</div></div>`;
    return;
  }

  const titleEl = document.getElementById('job-title');
  if (titleEl) titleEl.textContent = job.title;

  const { data: applications } = await sb
    .from('job_applications')
    .select('*, candidate:candidate_id(full_name, email)')
    .eq('job_id', jobId)
    .order('match_score', { ascending: false });

  const { data: interviews } = await sb
    .from('interviews')
    .select('*, application:job_application_id(candidate:candidate_id(full_name))')
    .eq('status', 'scheduled')
    .order('scheduled_at');

  const appInterviews = (interviews || []).filter(i =>
    (applications || []).some(a => a.id === i.job_application_id)
  );

  const skills = job.parsed_skills;
  const stages = {};
  (applications || []).forEach(a => { stages[a.status] = (stages[a.status] || 0) + 1; });

  const content = document.getElementById('job-content');
  if (!content) return;

  content.innerHTML = `
    <div class="grid-2col" style="grid-template-columns:2fr 1fr">
      <div>
        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card-header"><span class="card-title">Job Details</span><span class="badge badge-${job.status === 'open' ? 'success' : job.status === 'closed' ? 'error' : 'warning'}">${job.status}</span></div>
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);font-size:var(--text-sm);margin-bottom:var(--space-4)">
              <div><span style="color:var(--color-text-secondary)">Type:</span> ${esc(job.employment_type || '—')}</div>
              <div><span style="color:var(--color-text-secondary)">Location:</span> ${esc(job.location || '—')}</div>
              <div><span style="color:var(--color-text-secondary)">Experience:</span> ${job.experience_min || '—'} – ${job.experience_max || '—'} years</div>
              <div><span style="color:var(--color-text-secondary)">Salary:</span> ${job.salary_min && job.salary_max ? `${job.salary_min.toLocaleString()} – ${job.salary_max.toLocaleString()}` : '—'}</div>
            </div>
            ${job.description ? `<div style="font-size:var(--text-sm);white-space:pre-wrap;color:var(--color-text-secondary)">${esc(job.description)}</div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Candidates (${(applications || []).length})</span></div>
          <div class="card-body" style="padding:0">
            ${(applications || []).length ? `
              <table class="table">
                <thead><tr><th>Candidate</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  ${(applications || []).map(a => `
                    <tr>
                      <td>
                        <a href="#/recruitment/candidate?id=${a.candidate_id}" style="color:var(--color-accent);text-decoration:none">${esc(a.candidate?.full_name || '—')}</a>
                        <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(a.candidate?.email || '')}</div>
                      </td>
                      <td>
                        <div style="display:flex;align-items:center;gap:var(--space-2)">
                          <div style="width:60px;height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full)">
                            <div style="width:${a.match_score || 0}%;height:100%;background:${(a.match_score || 0) >= 70 ? 'var(--color-success)' : (a.match_score || 0) >= 40 ? 'var(--color-warning)' : 'var(--color-error)'};border-radius:var(--radius-full)"></div>
                          </div>
                          <span style="font-size:var(--text-xs)">${a.match_score ? a.match_score.toFixed(1) + '%' : '—'}</span>
                        </div>
                      </td>
                      <td><span class="badge badge-${a.status === 'shortlisted' || a.status === 'hired' ? 'success' : a.status === 'rejected' ? 'error' : 'info'}">${a.status}</span></td>
                      <td><a href="#/recruitment/candidate?id=${a.candidate_id}" class="btn btn-ghost btn-sm">View</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `<div style="text-align:center;padding:var(--space-6);color:var(--color-text-tertiary)">No candidates yet. <a href="#/recruitment/matcher?job=${jobId}">Run the matcher</a> to find candidates.</div>`}
          </div>
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card-header"><span class="card-title">Pipeline</span></div>
          <div class="card-body">
            ${Object.entries(stages).length ? Object.entries(stages).map(([stage, count]) => `
              <div style="display:flex;justify-content:space-between;padding:var(--space-2) 0;font-size:var(--text-sm)">
                <span style="text-transform:capitalize">${esc(stage.replace('_', ' '))}</span>
                <strong>${count}</strong>
              </div>
            `).join('') : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No applicants yet</div>'}
          </div>
        </div>

        ${skills ? `
        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card-header"><span class="card-title">Required Skills</span></div>
          <div class="card-body">
            ${skills.must_have?.length ? `
              <div style="margin-bottom:var(--space-3)">
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Must Have</div>
                <div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">
                  ${skills.must_have.map(s => `<span class="badge badge-info">${esc(s)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
            ${skills.nice_to_have?.length ? `
              <div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Nice to Have</div>
                <div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">
                  ${skills.nice_to_have.map(s => `<span class="badge">${esc(s)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <div class="card">
          <div class="card-header"><span class="card-title">Upcoming Interviews</span></div>
          <div class="card-body">
            ${appInterviews.length ? appInterviews.map(i => `
              <div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light);font-size:var(--text-sm)">
                <div style="font-weight:var(--font-weight-medium)">${esc(i.application?.candidate?.full_name || '—')}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">
                  ${i.round_name || 'Round ' + i.round_number} · ${new Date(i.scheduled_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })} at ${new Date(i.scheduled_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            `).join('') : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No scheduled interviews</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
}
