import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, formatDate } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

const BUCKET = 'documents';

function formatSize(bytes) {
  if (!bytes) return '--';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function mimeIcon(mime) {
  if (!mime) return '📄';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('word') || mime.includes('document')) return '📘';
  if (mime.includes('sheet') || mime.includes('excel')) return '📗';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📙';
  return '📄';
}

function renderTable(files, canDelete) {
  if (!files.length) {
    return `<div class="empty-state">
      <div class="empty-state-icon">📂</div>
      <h3 class="empty-state-title">No documents yet</h3>
      <p class="empty-state-desc">Upload a document to get started.</p>
    </div>`;
  }
  return `<div class="table-wrap"><table class="table">
    <thead><tr>
      <th>Name</th><th>Size</th><th>Uploaded</th><th>Actions</th>
    </tr></thead>
    <tbody>${files.map(f => `<tr>
      <td>${mimeIcon(f.mime_type)} ${esc(f.file_name)}</td>
      <td>${formatSize(f.file_size)}</td>
      <td>${formatDate(f.created_at)}</td>
      <td>
        <button class="btn btn-ghost btn-sm doc-download" data-path="${esc(f.file_path)}">Download</button>
        ${canDelete ? `<button class="btn btn-ghost btn-sm doc-delete" data-id="${f.id}" data-path="${esc(f.file_path)}">Delete</button>` : ''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export default async function documentsView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const role = membership?.role || 'member';
  const isAdmin = ['owner', 'admin'].includes(role);
  let activeTab = 'policies';

  async function loadFiles(entityType, entityId) {
    let query = sb.from('files').select('*').eq('org_id', org.id).eq('entity_type', entityType).order('created_at', { ascending: false });
    if (entityId) query = query.eq('entity_id', entityId);
    const { data, error } = await query;
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  async function render() {
    const policies = await loadFiles('policy');
    const myDocs = await loadFiles('employee', user.id);

    container.innerHTML = `
      <div style="margin-bottom:var(--space-6);">
        <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1);">Documents</h1>
        <p style="font-size:var(--text-base);color:var(--color-text-secondary);margin:0;">Company policies and shared documents</p>
      </div>
      <div class="tabs" style="margin-bottom:var(--space-6);">
        <button class="tab${activeTab === 'policies' ? ' active' : ''}" data-tab="policies">Company Policies</button>
        <button class="tab${activeTab === 'mine' ? ' active' : ''}" data-tab="mine">My Documents</button>
      </div>
      <div id="doc-tab-content"></div>`;

    const tabContent = container.querySelector('#doc-tab-content');

    function renderTab() {
      if (activeTab === 'policies') {
        tabContent.innerHTML = `
          ${isAdmin ? `<div style="margin-bottom:var(--space-4);display:flex;justify-content:flex-end;">
            <label class="btn btn-primary btn-sm" style="cursor:pointer;">
              Upload Policy <input type="file" id="policy-upload" hidden>
            </label>
          </div>` : ''}
          ${renderTable(policies, isAdmin)}`;
      } else {
        tabContent.innerHTML = `
          <div style="margin-bottom:var(--space-4);display:flex;justify-content:flex-end;">
            <label class="btn btn-primary btn-sm" style="cursor:pointer;">
              Upload Document <input type="file" id="my-upload" hidden>
            </label>
          </div>
          ${renderTable(myDocs, true)}`;
      }
      bindActions();
    }

    container.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => {
        activeTab = t.dataset.tab;
        container.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        renderTab();
      });
    });

    renderTab();
  }

  function bindActions() {
    container.querySelectorAll('.doc-download').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { data, error } = await sb.storage.from(BUCKET).download(btn.dataset.path);
        if (error) { toast(error.message, 'error'); return; }
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url; a.download = btn.dataset.path.split('/').pop();
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
    });

    container.querySelectorAll('.doc-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this document?')) return;
        const { error: storageErr } = await sb.storage.from(BUCKET).remove([btn.dataset.path]);
        if (storageErr) { toast(storageErr.message, 'error'); return; }
        const fileId = btn.dataset.id;
        const { error: dbErr } = await sb.from('files').delete().eq('id', fileId);
        if (dbErr) { toast(dbErr.message, 'error'); return; }
        publishEvent('documents.file.deleted', { file_id: fileId, org_id: org.id });
        toast('Document deleted');
        await render();
      });
    });

    const uploadInput = container.querySelector('#policy-upload') || container.querySelector('#my-upload');
    if (uploadInput) {
      uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const entityType = activeTab === 'policies' ? 'policy' : 'employee';
        const entityId = activeTab === 'policies' ? null : user.id;
        const path = `${org.id}/${entityType}/${Date.now()}_${file.name}`;

        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file);
        if (upErr) { toast(upErr.message, 'error'); return; }

        const row = {
          org_id: org.id,
          uploaded_by: user.id,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || null,
          entity_type: entityType,
          entity_id: entityId,
        };
        const { data, error: dbErr } = await sb.from('files').insert(row).select().single();
        if (dbErr) { toast(dbErr.message, 'error'); return; }
        publishEvent('documents.file.uploaded', { file_id: data.id, org_id: org.id, file_name: file.name });
        toast('Document uploaded');
        await render();
      });
    }
  }

  await render();
}
