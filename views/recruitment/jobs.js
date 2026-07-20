import sb from '../../js/supabase.js';
import { esc, toast, scoreBar, stagePill, openModal, closeModal, getAuthToken, clientId, initials, avColor } from '../../js/ui.js';
import { getOrg } from '../../js/auth.js';
import { navigate } from '../../js/router.js';
import { publishEvent } from '../../js/events.js';

export default async function recruitmentJobs(container) {
  const org = getOrg();
  const cid = org?.id || await clientId();
  if (!cid) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div><div class="empty-state-desc">Ask your admin to add you to an organization.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Recruitment</h1>
        <p class="page-subtitle">Manage job listings, screen candidates, and schedule interviews</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="view-interviews-btn">Interviews</button>
        <button class="btn btn-primary" id="create-job-btn">+ New Job</button>
      </div>
    </div>
    <div class="tabs" id="job-tabs">
      <button class="tab active" data-filter="all">All</button>
      <button class="tab" data-filter="open">Open</button>
      <button class="tab" data-filter="paused">Paused</button>
      <button class="tab" data-filter="closed">Closed</button>
    </div>
    <div id="jobs-grid" style="display:grid;gap:var(--space-4);margin-top:var(--space-4)"></div>
  `;

  let filter = 'all';
  let expandedId = null;
  let jobs = [];
  let candidates = [];
  let applications = [];

  const orgCol = org ? 'org_id' : 'client_id';

  async function loadData() {
    const [{ data: j }, { data: c }] = await Promise.all([
      sb.from('jobs').select('*').eq(orgCol, cid).order('created_at', { ascending: false }),
      sb.from('candidates').select('*').eq(orgCol, cid).order('created_at', { ascending: false }),
    ]);
    jobs = j || [];
    candidates = c || [];
    const jobIds = jobs.map(j => j.id);
    if (jobIds.length) {
      const { data: apps } = await sb.from('applications').select('*').in('job_id', jobIds).order('updated_at', { ascending: false });
      applications = apps || [];
    } else {
      applications = [];
    }
  }

  await loadData();

  function renderJobs() {
    const grid = document.getElementById('jobs-grid');
    const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);

    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div>
        <div class="empty-state-title">No ${filter === 'all' ? '' : filter + ' '}jobs</div>
        <div class="empty-state-desc">Create your first job posting to start matching candidates.</div>
      </div>`;
      return;
    }

    grid.innerHTML = filtered.map(j => {
      const jobApps = applications.filter(a => a.job_id === j.id);
      const appCount = jobApps.length;
      const shortlisted = jobApps.filter(a => ['shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired'].includes(a.stage)).length;
      const hired = jobApps.filter(a => a.stage === 'hired').length;
      const isExpanded = expandedId === j.id;

      let detailHTML = '';
      if (isExpanded) {
        const scored = jobApps.filter(a => a.match_score != null).sort((a, b) => b.match_score - a.match_score);
        const unscored = jobApps.filter(a => a.match_score == null);
        const sorted = [...scored, ...unscored];

        const candRows = sorted.map(a => {
          const c = candidates.find(x => x.id === a.candidate_id);
          return `<div class="table-row" style="display:grid;grid-template-columns:1fr 120px 120px 80px;align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light);cursor:pointer" data-act="candidate-detail" data-cand-id="${a.candidate_id}" data-app-id="${a.id}">
            <div style="display:flex;align-items:center;gap:var(--space-3)">
              <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(c?.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(c?.name)}</div>
              <div>
                <div style="font-weight:var(--font-weight-medium)">${esc(c?.name || 'Unknown')}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(c?.email || c?.phone || '')}</div>
              </div>
            </div>
            <div>${scoreBar(a.match_score)}</div>
            <div>${stagePill(a.stage)}</div>
            <div style="text-align:right">
              <button class="btn btn-ghost btn-sm" data-act="stage-update" data-app-id="${a.id}" title="Update stage">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </button>
            </div>
          </div>`;
        }).join('');

        detailHTML = `
          <div style="border-top:1px solid var(--color-border-light);padding:var(--space-4)">
            ${j.jd_raw_text || j.description ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4);max-height:80px;overflow:hidden">${esc((j.jd_raw_text || j.description || '').slice(0, 300))}${(j.jd_raw_text || j.description || '').length > 300 ? '...' : ''}</div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
              <span style="font-weight:var(--font-weight-semibold)">Candidates (${appCount})</span>
              <div style="display:flex;gap:var(--space-2)">
                <button class="btn btn-secondary btn-sm" data-act="upload" data-job-id="${j.id}">Upload Resumes</button>
                <button class="btn btn-primary btn-sm" data-act="screen" data-job-id="${j.id}">Screen All</button>
              </div>
            </div>
            ${sorted.length ? `
              <div style="border:1px solid var(--color-border);border-radius:var(--radius-lg);overflow:hidden">
                <div style="display:grid;grid-template-columns:1fr 120px 120px 80px;padding:var(--space-2) var(--space-4);background:var(--color-bg-secondary);font-size:var(--text-xs);color:var(--color-text-secondary);font-weight:var(--font-weight-medium);text-transform:uppercase;letter-spacing:0.05em">
                  <div>Name</div><div>Score</div><div>Stage</div><div></div>
                </div>
                ${candRows}
              </div>
            ` : `<div style="text-align:center;padding:var(--space-6);color:var(--color-text-tertiary)">No candidates yet. Upload resumes to get started.</div>`}
          </div>`;
      }

      return `
        <div class="card" style="overflow:hidden">
          <div style="padding:var(--space-4);cursor:pointer" data-act="toggle" data-id="${j.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3)">
              <div style="flex:1;min-width:0">
                <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-md)">${esc(j.title)}</div>
                <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:var(--space-1)">${esc(j.description || '')}</div>
              </div>
              ${stagePill(j.status)}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="flex-shrink:0;transition:transform .2s;${isExpanded ? 'transform:rotate(180deg)' : ''}"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div style="display:flex;gap:var(--space-6);margin-top:var(--space-3)">
              <div style="text-align:center"><div style="font-weight:var(--font-weight-semibold)">${appCount}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Pipeline</div></div>
              <div style="text-align:center"><div style="font-weight:var(--font-weight-semibold)">${shortlisted}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Shortlisted</div></div>
              <div style="text-align:center"><div style="font-weight:var(--font-weight-semibold)">${hired}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Hired</div></div>
            </div>
          </div>
          ${detailHTML}
        </div>`;
    }).join('');

    // Bind events
    grid.querySelectorAll('[data-act=toggle]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        expandedId = expandedId === el.dataset.id ? null : el.dataset.id;
        renderJobs();
      });
    });

    grid.querySelectorAll('[data-act=upload]').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); showUploadModal(el.dataset.jobId); });
    });

    grid.querySelectorAll('[data-act=screen]').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); screenJob(el.dataset.jobId); });
    });

    grid.querySelectorAll('[data-act=stage-update]').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); showStageModal(el.dataset.appId); });
    });

    grid.querySelectorAll('[data-act=candidate-detail]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        showCandidateDetail(el.dataset.appId);
      });
    });
  }

  renderJobs();

  // Tab switching
  document.getElementById('job-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#job-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filter = tab.dataset.filter;
    renderJobs();
  });

  // Create job
  document.getElementById('create-job-btn').addEventListener('click', showJobForm);

  // Interviews link
  document.getElementById('view-interviews-btn').addEventListener('click', () => {
    navigate('recruitment/interviews');
  });

  // ── Create Job Modal ──
  function showJobForm() {
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Job Title</label>
          <input type="text" class="form-input" id="jf-title" placeholder="e.g. Senior Backend Engineer">
        </div>
        <div class="form-group">
          <label class="form-label">Short Description</label>
          <input type="text" class="form-input" id="jf-desc" placeholder="One-line summary for the listing">
        </div>
        <div class="form-group">
          <label class="form-label">Job Description (full JD text)</label>
          <textarea class="form-input" id="jf-jd" rows="6" placeholder="Paste the complete JD here — this is what resumes get scored against."></textarea>
        </div>
        <button class="btn btn-primary" id="jf-save" style="justify-self:end">Create Job</button>
      </div>`;
    openModal('New Job', f);

    f.querySelector('#jf-save').addEventListener('click', async () => {
      const title = f.querySelector('#jf-title').value.trim();
      if (!title) return toast('Job title is required');
      const btn = f.querySelector('#jf-save');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      const { error } = await sb.from('jobs').insert({
        [orgCol]: cid,
        title,
        description: f.querySelector('#jf-desc').value.trim(),
        jd_raw_text: f.querySelector('#jf-jd').value.trim(),
      });
      if (error) { toast(error.message); btn.disabled = false; btn.textContent = 'Create Job'; return; }
      closeModal();
      toast('Job created');
      await loadData();
      renderJobs();
    });
  }

  // ── Upload Resumes Modal ──
  async function showUploadModal(jobId) {
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div id="drop-zone" style="border:2px dashed var(--color-border);border-radius:var(--radius-lg);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color var(--transition-fast)">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2" width="32" height="32" style="margin:0 auto var(--space-3)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="font-weight:var(--font-weight-medium)">Drop resume files here</div>
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:var(--space-1)">PDF or DOCX, up to 3 MB each</div>
          <input type="file" id="file-input" multiple accept=".pdf,.docx,.doc" style="display:none">
        </div>
        <div id="upload-list" style="display:grid;gap:var(--space-2)"></div>
        <button class="btn btn-primary hidden" id="upload-start">Upload & Parse</button>
      </div>`;
    openModal('Upload Resumes', f);

    const dropZone = f.querySelector('#drop-zone');
    const fileInput = f.querySelector('#file-input');
    const uploadList = f.querySelector('#upload-list');
    const startBtn = f.querySelector('#upload-start');
    let selectedFiles = [];

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-accent)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--color-border)'; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--color-border)';
      addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => addFiles(fileInput.files));

    function addFiles(fileList) {
      for (const file of fileList) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'docx', 'doc'].includes(ext)) continue;
        if (selectedFiles.some(f => f.name === file.name)) continue;
        selectedFiles.push(file);
      }
      renderFileList();
    }

    function renderFileList() {
      if (!selectedFiles.length) {
        uploadList.innerHTML = '';
        startBtn.classList.add('hidden');
        return;
      }
      startBtn.classList.remove('hidden');
      uploadList.innerHTML = selectedFiles.map((f, i) => `
        <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span style="flex:1;font-size:var(--text-sm)">${esc(f.name)}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${(f.size / 1024).toFixed(0)} KB</span>
          <span class="file-status" data-idx="${i}"></span>
          <button class="btn btn-ghost btn-sm" data-remove="${i}" style="padding:2px">&times;</button>
        </div>
      `).join('');

      uploadList.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedFiles.splice(+btn.dataset.remove, 1);
          renderFileList();
        });
      });
    }

    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Processing...';
      const token = await getAuthToken();
      let successCount = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const statusEl = uploadList.querySelector(`[data-idx="${i}"]`);
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--color-warning);font-size:var(--text-xs)">Parsing...</span>';

        try {
          const base64 = await fileToBase64(file);
          const parseResp = await fetch('/api/parse-resume', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const parseData = await parseResp.json();
          if (!parseResp.ok) throw new Error(parseData.error);

          const extractResp = await fetch('/api/extract-candidate', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ resume_text: parseData.text }),
          });
          const extractData = await extractResp.json();
          if (!extractResp.ok) throw new Error(extractData.error);

          const name = extractData.name || file.name.replace(/\.[^.]+$/, '');
          const email = extractData.email || null;
          const phone = extractData.phone || null;

          let candId;
          if (email || phone) {
            let q = sb.from('candidates').select('id').eq(orgCol, cid);
            if (email) q = q.eq('email', email);
            else q = q.eq('phone', phone);
            const { data: existing } = await q.maybeSingle();
            if (existing) {
              candId = existing.id;
              await sb.from('candidates').update({ resume_raw_text: parseData.text, name }).eq('id', candId);
            }
          }

          if (!candId) {
            const { data: newCand, error: candErr } = await sb.from('candidates').insert({
              [orgCol]: cid,
              name,
              email,
              phone,
              resume_raw_text: parseData.text,
            }).select('id').single();
            if (candErr) throw candErr;
            candId = newCand.id;
          }

          if (jobId) {
            const { data: existingApp } = await sb.from('applications')
              .select('id').eq('job_id', jobId).eq('candidate_id', candId).maybeSingle();
            if (!existingApp) {
              await sb.from('applications').insert({ job_id: jobId, candidate_id: candId });
            }
          }

          if (statusEl) statusEl.innerHTML = '<span style="color:var(--color-success);font-size:var(--text-xs)">Done</span>';
          successCount++;
        } catch (err) {
          if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-error);font-size:var(--text-xs)">${esc(err.message || 'Error')}</span>`;
        }
      }

      toast(`${successCount}/${selectedFiles.length} resumes processed`);
      startBtn.textContent = 'Done';
      if (successCount > 0) {
        await loadData();
        renderJobs();
      }
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Screen Job ──
  async function screenJob(jobId) {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const jobApps = applications.filter(a => a.job_id === jobId);
    const unscored = jobApps.filter(a => a.match_score == null);
    const hasJD = !!(job.jd_raw_text || job.description);

    if (!hasJD) return toast('Add a JD to this job before screening');
    if (!jobApps.length) return toast('Upload resumes first');

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <p style="color:var(--color-text-secondary)">${esc(job.title)} — ${jobApps.length} candidate${jobApps.length !== 1 ? 's' : ''}, ${unscored.length} unscored</p>
        <div class="form-group">
          <label class="form-label">Scoring Method</label>
          <div style="display:flex;gap:var(--space-2)">
            <label style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);cursor:pointer;flex:1">
              <input type="radio" name="method" value="python" checked> <div><strong>Keyword</strong><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Free, instant</div></div>
            </label>
            <label style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);cursor:pointer;flex:1">
              <input type="radio" name="method" value="ai"> <div><strong>AI (Groq)</strong><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">1 credit/resume</div></div>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Scope</label>
          <select class="form-input" id="screen-mode">
            <option value="unscored">Unscored only (${unscored.length})</option>
            <option value="all">All candidates (${jobApps.length})</option>
          </select>
        </div>
        <div id="screen-progress" class="hidden" style="padding:var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md)">
          <div style="font-size:var(--text-sm);margin-bottom:var(--space-2)" id="screen-status">Screening...</div>
          <div style="height:4px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
            <div id="screen-bar" style="width:0%;height:100%;background:var(--color-accent);transition:width .3s"></div>
          </div>
        </div>
        <button class="btn btn-primary" id="screen-go">Start Screening</button>
      </div>`;
    openModal('Screen Candidates', f);

    f.querySelector('#screen-go').addEventListener('click', async () => {
      const method = f.querySelector('input[name=method]:checked').value;
      const mode = f.querySelector('#screen-mode').value;
      const btn = f.querySelector('#screen-go');
      const progress = f.querySelector('#screen-progress');
      const statusEl = f.querySelector('#screen-status');
      const barEl = f.querySelector('#screen-bar');

      btn.disabled = true;
      btn.textContent = 'Screening...';
      progress.classList.remove('hidden');

      const token = await getAuthToken();
      try {
        const resp = await fetch('/api/screen-job', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, method, mode }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);

        barEl.style.width = '100%';
        const scored = (data.results || []).filter(r => r.score != null).length;
        const failed = (data.results || []).filter(r => r.error).length;
        statusEl.textContent = `Done: ${scored} scored${failed ? `, ${failed} failed` : ''}${data.credits_used ? ` · ${data.credits_used} credits used` : ''}`;
        btn.textContent = 'Done';
        toast(`Screening complete: ${scored} scored`);
        await loadData();
        renderJobs();
      } catch (err) {
        statusEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Retry';
      }
    });
  }

  // ── Update Stage Modal ──
  async function showStageModal(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;
    const stages = ['new', 'screened', 'shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired', 'rejected'];

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div class="form-group">
          <label class="form-label">Current: ${stagePill(app.stage)}</label>
          <select class="form-input" id="stage-select">
            ${stages.map(s => `<option value="${s}" ${s === app.stage ? 'selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="stage-save">Update Stage</button>
      </div>`;
    openModal('Update Stage', f);

    f.querySelector('#stage-save').addEventListener('click', async () => {
      const newStage = f.querySelector('#stage-select').value;
      const { error } = await sb.from('applications').update({
        stage: newStage,
        updated_at: new Date().toISOString(),
      }).eq('id', appId);
      if (error) return toast(error.message);
      closeModal();
      toast('Stage updated');
      await loadData();
      renderJobs();
    });
  }

  // ── Candidate Detail Modal ──
  async function showCandidateDetail(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;
    const cand = candidates.find(c => c.id === app.candidate_id);
    const job = jobs.find(j => j.id === app.job_id);
    const matchData = app.match_raw_response || {};

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div style="display:flex;align-items:center;gap:var(--space-4)">
          <div style="width:48px;height:48px;border-radius:var(--radius-full);background:${avColor(cand?.name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-lg)">${initials(cand?.name)}</div>
          <div>
            <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-lg)">${esc(cand?.name || 'Unknown')}</div>
            <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(cand?.email || '')} ${cand?.phone ? '· ' + esc(cand.phone) : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-4)">
          <div class="card" style="flex:1;padding:var(--space-3);text-align:center">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${app.match_score != null ? Math.round(app.match_score) : '—'}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Match Score</div>
          </div>
          <div class="card" style="flex:1;padding:var(--space-3);text-align:center">
            ${stagePill(app.stage)}
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-1)">Stage</div>
          </div>
        </div>
        ${app.match_summary ? `<div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);margin-bottom:var(--space-2)">AI Assessment</div><div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(app.match_summary)}</div></div>` : ''}
        ${matchData.strengths?.length ? `<div><div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);margin-bottom:var(--space-2)">Strengths</div><div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${matchData.strengths.map(s => `<span class="badge badge-success">${esc(s)}</span>`).join('')}</div></div>` : ''}
        ${matchData.gaps?.length ? `<div><div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);margin-bottom:var(--space-2)">Gaps</div><div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${matchData.gaps.map(g => `<span class="badge badge-error">${esc(g)}</span>`).join('')}</div></div>` : ''}
        ${cand?.resume_raw_text ? `<details><summary style="cursor:pointer;font-size:var(--text-sm);font-weight:var(--font-weight-medium)">Resume Text</summary><pre style="white-space:pre-wrap;font-size:var(--text-xs);color:var(--color-text-secondary);max-height:300px;overflow:auto;margin-top:var(--space-2);padding:var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md)">${esc(cand.resume_raw_text)}</pre></details>` : ''}
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
          ${cand?.phone ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/${(cand.phone || '').replace(/[^\d]/g, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn btn-primary btn-sm" id="cd-stage">Update Stage</button>
        </div>
      </div>`;
    openModal(`${esc(cand?.name)} — ${esc(job?.title || '')}`, f);

    f.querySelector('#cd-stage').addEventListener('click', () => {
      closeModal();
      showStageModal(appId);
    });
  }
}
