import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, scoreBar, stagePill, clientId } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function matcherView(container) {
  const org = getOrg();
  const cid = org?.id || await clientId();
  const orgCol = org ? 'org_id' : 'client_id';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">CV-JD Matcher</h1>
        <p class="page-subtitle">Match candidates to jobs using AI scoring</p>
      </div>
      <button class="btn btn-secondary" id="back-to-jobs">Back to Jobs</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header"><span class="card-title">Run Matching</span></div>
      <div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:end">
          <div class="form-group" style="flex:1;min-width:180px">
            <label class="form-label">Select Job</label>
            <select class="form-input" id="match-job"><option value="">Loading jobs...</option></select>
          </div>
          <div class="form-group" style="flex:1;min-width:180px">
            <label class="form-label">Candidates</label>
            <select class="form-input" id="match-candidates">
              <option value="all">All unmatched candidates</option>
              <option value="recent">Recent uploads (last 30 days)</option>
            </select>
          </div>
          <button class="btn btn-primary" id="run-match" disabled>Run Match</button>
        </div>
        <div id="match-progress" class="hidden" style="margin-top:var(--space-4)">
          <div style="height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
            <div id="match-bar" style="width:0%;height:100%;background:var(--color-accent);border-radius:var(--radius-full);transition:width 0.3s ease"></div>
          </div>
          <div id="match-text" style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-2)"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">Match Results</span>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <select class="form-input" id="results-job" style="height:34px;width:auto"><option value="">Select job...</option></select>
          <select class="form-input" id="results-sort" style="height:34px;width:auto">
            <option value="score_desc">Score (High to Low)</option>
            <option value="score_asc">Score (Low to High)</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </div>
      </div>
      <div id="results-table"></div>
    </div>
  `;

  document.getElementById('back-to-jobs').addEventListener('click', () => {
    window.location.hash = '#/recruitment';
  });

  if (!cid) return;

  const { data: jobs } = await sb.from('jobs').select('id, title, status').eq(orgCol, cid).order('created_at', { ascending: false });
  const allJobs = jobs || [];

  const jobSelect = document.getElementById('match-job');
  const resultsJobSelect = document.getElementById('results-job');
  jobSelect.innerHTML = '<option value="">Select a job...</option>' + allJobs.map(j => `<option value="${j.id}">${esc(j.title)} (${j.status})</option>`).join('');
  resultsJobSelect.innerHTML = '<option value="">Select job...</option>' + allJobs.map(j => `<option value="${j.id}">${esc(j.title)}</option>`).join('');

  jobSelect.addEventListener('change', () => {
    document.getElementById('run-match').disabled = !jobSelect.value;
  });

  document.getElementById('run-match').addEventListener('click', async () => {
    const jobId = jobSelect.value;
    if (!jobId) return;

    const runBtn = document.getElementById('run-match');
    runBtn.disabled = true;
    runBtn.textContent = 'Matching...';
    document.getElementById('match-progress').classList.remove('hidden');

    const candidateScope = document.getElementById('match-candidates').value;
    let query = sb.from('candidates').select('id, full_name, resume_text, parsed_skills').eq(orgCol, cid);
    if (candidateScope === 'recent') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      query = query.gte('created_at', thirtyDaysAgo);
    }
    const { data: candidates } = await query;
    const cands = (candidates || []).filter(c => c.resume_text || c.parsed_skills);

    if (!cands.length) {
      toast('No candidates with resume data to match');
      runBtn.disabled = false;
      runBtn.textContent = 'Run Match';
      document.getElementById('match-progress').classList.add('hidden');
      return;
    }

    const { data: jobData } = await sb.from('jobs').select('parsed_skills, description').eq('id', jobId).single();
    const jobSkills = jobData?.parsed_skills?.must_have || [];
    const jobNiceToHave = jobData?.parsed_skills?.nice_to_have || [];
    const allJobSkills = [...jobSkills, ...jobNiceToHave].map(s => s.toLowerCase());

    let matched = 0;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      const pct = Math.round(((i + 1) / cands.length) * 100);
      document.getElementById('match-bar').style.width = pct + '%';
      document.getElementById('match-text').textContent = `Matching ${i + 1} of ${cands.length}: ${c.full_name}`;

      const candSkills = (c.parsed_skills?.skills || []).map(s => s.toLowerCase());
      const candText = (c.resume_text || '').toLowerCase();

      let mustHaveMatch = 0;
      jobSkills.forEach(s => {
        if (candSkills.includes(s.toLowerCase()) || candText.includes(s.toLowerCase())) mustHaveMatch++;
      });

      let niceMatch = 0;
      jobNiceToHave.forEach(s => {
        if (candSkills.includes(s.toLowerCase()) || candText.includes(s.toLowerCase())) niceMatch++;
      });

      const skillsScore = jobSkills.length ? (mustHaveMatch / jobSkills.length) * 70 : 50;
      const niceScore = jobNiceToHave.length ? (niceMatch / jobNiceToHave.length) * 30 : 15;
      const totalScore = Math.round(skillsScore + niceScore);

      const { data: existing } = await sb.from('job_applications')
        .select('id').eq('job_id', jobId).eq('candidate_id', c.id).maybeSingle();

      if (existing) {
        await sb.from('job_applications').update({
          match_score: totalScore,
          match_breakdown: { skills_match: Math.round(skillsScore / 0.7), nice_to_have_match: Math.round(niceScore / 0.3), overall: totalScore },
          match_method: 'tfidf',
        }).eq('id', existing.id);
      } else {
        await sb.from('job_applications').insert({
          [orgCol]: cid, job_id: jobId, candidate_id: c.id,
          match_score: totalScore,
          match_breakdown: { skills_match: Math.round(skillsScore / 0.7), nice_to_have_match: Math.round(niceScore / 0.3), overall: totalScore },
          match_method: 'tfidf', status: 'applied',
        });
      }
      matched++;
    }

    toast(`${matched} candidates matched`);
    runBtn.disabled = false;
    runBtn.textContent = 'Run Match';
    resultsJobSelect.value = jobId;
    loadResults(jobId);
  });

  async function loadResults(jobId) {
    const el = document.getElementById('results-table');
    if (!jobId) {
      el.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">Select a job to view results</div>`;
      return;
    }

    const sortBy = document.getElementById('results-sort').value;
    let query = sb.from('job_applications')
      .select('*, candidate:candidate_id(full_name, email)')
      .eq('job_id', jobId);

    if (sortBy === 'score_desc') query = query.order('match_score', { ascending: false });
    else if (sortBy === 'score_asc') query = query.order('match_score', { ascending: true });
    else query = query.order('created_at', { ascending: false });

    const { data: results } = await query;
    const apps = results || [];

    if (!apps.length) {
      el.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No match results for this job</div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Candidate</th><th>Score</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${apps.map((a, i) => `<tr>
        <td style="color:var(--color-text-tertiary)">${i + 1}</td>
        <td>
          <div style="font-weight:var(--font-weight-medium)">${esc(a.candidate?.full_name || '—')}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(a.candidate?.email || '')}</div>
        </td>
        <td>${scoreBar(a.match_score)}</td>
        <td><span class="badge badge-neutral">${esc(a.match_method || '—')}</span></td>
        <td>${stagePill(a.status)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" data-view-cand="${a.candidate_id}">View</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-view-cand]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = '#/recruitment/candidate?id=' + btn.dataset.viewCand;
      });
    });
  }

  resultsJobSelect.addEventListener('change', () => loadResults(resultsJobSelect.value));
  document.getElementById('results-sort').addEventListener('change', () => loadResults(resultsJobSelect.value));

  if (allJobs.length) {
    resultsJobSelect.value = allJobs[0].id;
    loadResults(allJobs[0].id);
  }
}
