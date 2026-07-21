import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, clientId } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function uploadResumes(container) {
  const org = getOrg();
  const cid = org?.id || await clientId();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Upload Resumes</h1>
        <p class="page-subtitle">Upload and parse candidate resumes in bulk</p>
      </div>
      <button class="btn btn-secondary" id="back-to-jobs">Back to Jobs</button>
    </div>

    <div class="grid-2col">
      <div class="card">
        <div class="card-header"><span class="card-title">Upload Files</span></div>
        <div class="card-body">
          <div style="border:2px dashed var(--color-border);border-radius:var(--radius-lg);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color var(--transition-fast)" id="resume-drop">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2" width="40" height="40" style="margin:0 auto var(--space-3)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div style="font-weight:var(--font-weight-medium);margin-bottom:var(--space-1)">Drop resumes here or click to browse</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">PDF, DOCX, or TXT files</div>
            <input type="file" accept=".pdf,.docx,.doc,.txt" multiple id="resume-input" style="display:none">
          </div>
          <div id="file-list" style="margin-top:var(--space-3)"></div>
          <div id="upload-actions" class="hidden" style="margin-top:var(--space-4);display:flex;gap:var(--space-3)">
            <button class="btn btn-primary" id="upload-btn">Upload & Parse</button>
            <button class="btn btn-secondary" id="clear-files">Clear</button>
          </div>
          <div id="upload-progress" class="hidden" style="margin-top:var(--space-4)">
            <div style="height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
              <div id="upload-bar" style="width:0%;height:100%;background:var(--color-accent);border-radius:var(--radius-full);transition:width 0.3s ease"></div>
            </div>
            <div id="upload-text" style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-2)"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Manual Entry</span></div>
        <div class="card-body">
          <form id="manual-form">
            <div class="form-group"><label class="form-label">Full Name *</label><input type="text" class="form-input" id="cand-name" required></div>
            <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" id="cand-email"></div>
            <div class="form-group"><label class="form-label">Phone</label><input type="text" class="form-input" id="cand-phone"></div>
            <div class="form-group"><label class="form-label">Resume Text</label><textarea class="form-input" id="cand-resume" rows="5" placeholder="Paste resume text..."></textarea></div>
            <button type="submit" class="btn btn-primary">Add Candidate</button>
          </form>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-6)">
      <div class="card-header"><span class="card-title">Recent Uploads</span></div>
      <div id="recent-uploads"></div>
    </div>
  `;

  document.getElementById('back-to-jobs').addEventListener('click', () => {
    window.location.hash = '#/recruitment';
  });

  const dropZone = document.getElementById('resume-drop');
  const fileInput = document.getElementById('resume-input');
  let selectedFiles = [];

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-accent)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--color-border)'; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--color-border)';
    addFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener('change', () => addFiles(Array.from(fileInput.files)));

  function addFiles(files) {
    const valid = files.filter(f => /\.(pdf|docx?|txt)$/i.test(f.name));
    if (valid.length < files.length) toast('Some files were skipped (unsupported format)');
    selectedFiles = [...selectedFiles, ...valid];
    renderFileList();
  }

  function renderFileList() {
    const el = document.getElementById('file-list');
    if (!selectedFiles.length) {
      el.innerHTML = '';
      document.getElementById('upload-actions').classList.add('hidden');
      return;
    }
    document.getElementById('upload-actions').classList.remove('hidden');
    el.innerHTML = selectedFiles.map((f, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light);font-size:var(--text-sm)">
        <span>${esc(f.name)} <span style="color:var(--color-text-tertiary)">(${(f.size / 1024).toFixed(1)} KB)</span></span>
        <button class="btn btn-ghost btn-sm" data-remove-file="${i}" style="padding:2px">&times;</button>
      </div>
    `).join('');

    el.querySelectorAll('[data-remove-file]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(parseInt(btn.dataset.removeFile), 1);
        renderFileList();
      });
    });
  }

  document.getElementById('clear-files').addEventListener('click', () => {
    selectedFiles = [];
    fileInput.value = '';
    renderFileList();
    document.getElementById('upload-progress').classList.add('hidden');
  });

  document.getElementById('upload-btn').addEventListener('click', async () => {
    if (!selectedFiles.length) return;
    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    document.getElementById('upload-progress').classList.remove('hidden');

    let uploaded = 0;
    const orgCol = org ? 'org_id' : 'client_id';

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const pct = Math.round(((i + 1) / selectedFiles.length) * 100);
      document.getElementById('upload-bar').style.width = pct + '%';
      document.getElementById('upload-text').textContent = `Processing ${i + 1} of ${selectedFiles.length}: ${file.name}`;

      const nameFromFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

      let resumeText = '';
      if (file.name.endsWith('.txt')) {
        resumeText = await file.text();
      }

      const storagePath = `resumes/${cid}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await sb.storage.from('resumes').upload(storagePath, file);

      const { data: candidateData, error: insertError } = await sb.from('candidates').insert({
        [orgCol]: cid,
        full_name: nameFromFile,
        resume_url: uploadError ? null : storagePath,
        resume_text: resumeText || null,
        source: 'bulk_upload',
      }).select().single();

      if (!insertError) uploaded++;
    }

    await publishEvent('recruitment.candidates.bulk_uploaded', { count: uploaded });
    toast(`${uploaded} of ${selectedFiles.length} candidates uploaded`);
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Parse';
    selectedFiles = [];
    fileInput.value = '';
    renderFileList();
    loadRecent();
  });

  document.getElementById('manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cand-name').value.trim();
    if (!name) return toast('Name is required');

    const orgCol = org ? 'org_id' : 'client_id';
    const { error } = await sb.from('candidates').insert({
      [orgCol]: cid,
      full_name: name,
      email: document.getElementById('cand-email').value.trim() || null,
      phone: document.getElementById('cand-phone').value.trim() || null,
      resume_text: document.getElementById('cand-resume').value.trim() || null,
      source: 'manual',
    });

    if (error) return toast(error.message);
    toast('Candidate added');
    e.target.reset();
    loadRecent();
  });

  async function loadRecent() {
    const orgCol = org ? 'org_id' : 'client_id';
    const { data: recent } = await sb.from('candidates')
      .select('*')
      .eq(orgCol, cid)
      .order('created_at', { ascending: false })
      .limit(10);

    const el = document.getElementById('recent-uploads');
    if (!recent?.length) {
      el.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No candidates yet</div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Email</th><th>Source</th><th>Added</th></tr></thead>
      <tbody>${recent.map(c => `<tr style="cursor:pointer" data-cand-id="${c.id}">
        <td style="font-weight:var(--font-weight-medium)">${esc(c.full_name)}</td>
        <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(c.email || '—')}</td>
        <td><span class="badge badge-neutral">${esc(c.source || 'manual')}</span></td>
        <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${new Date(c.created_at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-cand-id]').forEach(row => {
      row.addEventListener('click', () => {
        window.location.hash = '#/recruitment/candidate?id=' + row.dataset.candId;
      });
    });
  }

  loadRecent();
}
