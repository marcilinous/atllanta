// Reusable activity timeline + logger, usable against any CRM record.
import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, timeAgo, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { field, ownerName, fetchOrgUsers } from './common.js';

const TYPE_ICON = { task: '✓', call: '\u{1F4DE}', meeting: '\u{1F4C5}', email: '✉', note: '\u{1F4DD}' };
const TYPE_LABEL = { task: 'Task', call: 'Call', meeting: 'Meeting', email: 'Email', note: 'Note' };

export async function renderTimeline(el, relatedType, relatedId) {
  el.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;
  const [{ data }, users] = await Promise.all([
    sb.from('crm_activities')
      .select('*')
      .eq('related_type', relatedType)
      .eq('related_id', relatedId)
      .order('created_at', { ascending: false }),
    fetchOrgUsers(),
  ]);

  const acts = data || [];
  if (!acts.length) {
    el.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No activity logged yet.</div>`;
    return;
  }

  el.innerHTML = `<div style="display:flex;flex-direction:column">${acts.map(a => `
    <div style="display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light)">
      <div style="width:28px;height:28px;border-radius:var(--radius-full);background:var(--color-bg-tertiary);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:var(--text-sm)">${TYPE_ICON[a.type] || '•'}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;gap:var(--space-2)">
          <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(a.subject)}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);white-space:nowrap">${timeAgo(a.created_at)}</span>
        </div>
        ${a.body ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:2px">${esc(a.body)}</div>` : ''}
        <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">
          ${esc(TYPE_LABEL[a.type] || a.type)}${(() => { const o = ownerName(users, a.owner_id); return o && o !== '—' ? ' · ' + esc(o) : ''; })()}${a.due_date ? ' · due ' + new Date(a.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}
        </div>
      </div>
    </div>`).join('')}</div>`;
}

export function openActivityModal(relatedType, relatedId, onSaved) {
  const org = getOrg();
  const user = getUser();
  const form = document.createElement('form');
  form.innerHTML = `
    ${field('Type', `<select class="form-input" name="type">
      <option value="note">Note</option>
      <option value="task">Task</option>
      <option value="call">Call</option>
      <option value="meeting">Meeting</option>
      <option value="email">Email</option>
    </select>`)}
    ${field('Subject *', `<input class="form-input" name="subject" required placeholder="e.g. Intro call with buyer">`)}
    ${field('Details', `<textarea class="form-input" name="body"></textarea>`)}
    ${field('Due date', `<input class="form-input" type="date" name="due_date">`)}
    <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
      <button type="button" class="btn btn-secondary" id="cancel-act">Cancel</button>
      <button type="submit" class="btn btn-primary">Log activity</button>
    </div>
  `;
  form.querySelector('#cancel-act').addEventListener('click', closeModal);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const subject = fd.get('subject').trim();
    if (!subject) return;
    const due = fd.get('due_date');
    const { data, error } = await sb.from('crm_activities').insert({
      org_id: org.id,
      type: fd.get('type'),
      subject,
      body: fd.get('body').trim() || null,
      due_date: due ? new Date(due).toISOString() : null,
      related_type: relatedType,
      related_id: relatedId,
      owner_id: user?.id,
      created_by: user?.id,
    }).select('id').single();
    if (error) return toast('Could not log activity');
    await logAction('crm', 'activity', data.id, 'created', null, { subject, related_type: relatedType });
    toast('Activity logged');
    closeModal();
    if (onSaved) onSaved();
  });
  openModal('Log activity', form);
}
