import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, formatDate, initials, avColor } from '../../js/ui.js';

export default async function recruitmentReport(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org || !['owner', 'admin', 'manager'].includes(membership?.role)) {
    container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3></div>';
    return;
  }

  container.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading recruitment report...</div>';

  const [{ data: jobs }, { data: applications }, { data: interviews }] = await Promise.all([
    sb.from('jobs').select('id, title, status, department:department_id(name), created_at').eq('org_id', org.id).order('created_at', { ascending: false }),
    sb.from('job_applications').select('id, job_id, status, match_score, created_at').eq('org_id', org.id),
    sb.from('interviews').select('id, job_application_id, status, decision, scheduled_at').eq('org_id', org.id),
  ]);

  const allJobs = jobs || [];
  const allApps = applications || [];
  const allInterviews = interviews || [];

  const stages = ['applied', 'screening', 'shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired', 'rejected'];
  const stageLabels = { applied: 'Applied', screening: 'Screening', shortlisted: 'Shortlisted', interview_scheduled: 'Interview', interviewed: 'Interviewed', offered: 'Offered', hired: 'Hired', rejected: 'Rejected' };
  const stageColors = { applied: 'neutral', screening: 'info', shortlisted: 'warning', interview_scheduled: 'info', interviewed: 'info', offered: 'success', hired: 'success', rejected: 'error' };

  const totalApps = allApps.length;
  const totalHired = allApps.filter(a => a.status === 'hired').length;
  const totalOpen = allJobs.filter(j => j.status === 'open').length;
  const avgScore = totalApps ? (allApps.reduce((s, a) => s + (a.match_score || 0), 0) / totalApps).toFixed(1) : '—';

  const stageCounts = {};
  stages.forEach(s => stageCounts[s] = 0);
  allApps.forEach(a => { if (stageCounts[a.status] !== undefined) stageCounts[a.status]++; });

  const maxStageCount = Math.max(...Object.values(stageCounts), 1);

  const jobStats = allJobs.map(j => {
    const apps = allApps.filter(a => a.job_id === j.id);
    const byStage = {};
    stages.forEach(s => byStage[s] = 0);
    apps.forEach(a => { if (byStage[a.status] !== undefined) byStage[a.status]++; });
    const scores = apps.filter(a => a.match_score).map(a => a.match_score);
    const avg = scores.length ? (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1) : '—';
    return { ...j, total: apps.length, byStage, avgScore: avg };
  });

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Recruitment Report</h1>
        <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Pipeline analytics across all jobs</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="recruit-export">Export CSV</button>
    </div>

    <div class="stat-grid" style="margin-bottom:var(--space-6)">
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-accent)">${totalOpen}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Open Positions</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-text-primary)">${totalApps}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Total Applications</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-success)">${totalHired}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Total Hired</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-warning)">${avgScore}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Avg Match Score</div>
      </div></div>
    </div>

    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-body">
        <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">Pipeline Funnel</h3>
        <div style="display:grid;gap:var(--space-3)">
          ${stages.filter(s => s !== 'rejected').map(s => `
            <div style="display:flex;align-items:center;gap:var(--space-3)">
              <div style="width:120px;font-size:var(--text-sm);color:var(--color-text-secondary);text-align:right;flex-shrink:0">${stageLabels[s]}</div>
              <div style="flex:1;height:28px;background:var(--color-bg-secondary);border-radius:var(--radius-md);overflow:hidden;position:relative">
                <div style="height:100%;width:${(stageCounts[s] / maxStageCount) * 100}%;background:var(--color-accent);border-radius:var(--radius-md);transition:width 0.3s ease;min-width:${stageCounts[s] ? '2px' : '0'}"></div>
                <span style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);font-size:var(--text-sm);font-weight:var(--font-weight-medium);color:var(--color-text-primary)">${stageCounts[s]}</span>
              </div>
            </div>
          `).join('')}
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <div style="width:120px;font-size:var(--text-sm);color:var(--color-error);text-align:right;flex-shrink:0">Rejected</div>
            <div style="flex:1;height:28px;background:var(--color-bg-secondary);border-radius:var(--radius-md);overflow:hidden;position:relative">
              <div style="height:100%;width:${(stageCounts.rejected / maxStageCount) * 100}%;background:var(--color-error);border-radius:var(--radius-md);min-width:${stageCounts.rejected ? '2px' : '0'}"></div>
              <span style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${stageCounts.rejected}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">Jobs Breakdown</h3>
        ${!jobStats.length ? '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No jobs created yet.</div>' : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Job Title</th>
            <th>Department</th>
            <th>Status</th>
            <th>Applications</th>
            <th>Shortlisted</th>
            <th>Interviewed</th>
            <th>Hired</th>
            <th>Avg Score</th>
          </tr></thead>
          <tbody>${jobStats.map(j => `<tr>
            <td style="font-weight:var(--font-weight-medium)">${esc(j.title)}</td>
            <td>${esc(j.department?.name || '—')}</td>
            <td><span class="badge badge-${j.status === 'open' ? 'success' : j.status === 'closed' ? 'neutral' : 'warning'}">${esc(j.status)}</span></td>
            <td>${j.total}</td>
            <td>${j.byStage.shortlisted}</td>
            <td>${j.byStage.interviewed + j.byStage.interview_scheduled}</td>
            <td>${j.byStage.hired}</td>
            <td>${j.avgScore}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    </div>`;

  document.getElementById('recruit-export')?.addEventListener('click', () => {
    if (!jobStats.length) return;
    const headers = 'Job Title,Department,Status,Applications,Shortlisted,Interviewed,Hired,Avg Score\n';
    const rows = jobStats.map(j =>
      `"${j.title}","${j.department?.name || '—'}",${j.status},${j.total},${j.byStage.shortlisted},${j.byStage.interviewed + j.byStage.interview_scheduled},${j.byStage.hired},${j.avgScore}`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `recruitment_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
