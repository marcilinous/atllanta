// Shared helpers for the CRM module.
import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

export function currentUserId() {
  return getUser()?.id || null;
}

// Owner display. CRM ownership keys off the auth identity (auth.users), so a
// name is only available when the owner also has an employee profile. Falls
// back to "Me" for the current user and "—" otherwise.
export function ownerName(users, id) {
  if (!id) return '—';
  const me = getUser();
  const u = (users || []).find(x => x.id === id);
  if (u) return u.full_name || u.email || (id === me?.id ? 'Me' : '—');
  return id === me?.id ? 'Me' : '—';
}

// Level-based scope. Reps only ever see their own (enforced by RLS); managers
// and admins can also see their team / the whole org, so they get a switch.
export function canSeeOthers() {
  return ['owner', 'admin', 'manager'].includes(getMembership()?.role);
}

// Fetch every row of a set-returning RPC, paging past the API's 1000-row cap.
export async function fetchAllRpc(name, params = {}) {
  const size = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await sb.rpc(name, params).range(from, from + size - 1);
    if (error) return { data: out.length ? out : null, error };
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return { data: out, error: null };
}

// Import / export of data is a TL-and-above action (TL and CM map to the
// 'manager' membership role; BDE and Telecaller are 'member').
export function canManageData() {
  return ['owner', 'admin', 'manager'].includes(getMembership()?.role);
}

export function defaultScope() {
  const r = getMembership()?.role;
  return (r === 'owner' || r === 'admin') ? 'all' : 'mine';
}

// Client-side filter within the RLS-visible set.
export function scopeFilter(rows, scope) {
  if (scope === 'all') return rows;
  const me = getUser();
  return rows.filter(x => x.owner_id === me?.id || x.created_by === me?.id);
}

// Tabs markup for the scope switch (rendered only when canSeeOthers()).
export function scopeTabs(scope, allLabel = 'Everyone I can see') {
  return `<div class="tabs crm-scope" style="border-bottom:none;margin-bottom:0">
    <button class="tab ${scope === 'mine' ? 'active' : ''}" data-scope="mine">My records</button>
    <button class="tab ${scope === 'all' ? 'active' : ''}" data-scope="all">${esc(allLabel)}</button>
  </div>`;
}

export function money(n, currency) {
  if (n === null || n === undefined || n === '') return '—';
  const cur = currency || getOrg()?.currency || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: cur, maximumFractionDigits: 0,
    }).format(Number(n));
  } catch {
    return `${cur} ${Number(n).toLocaleString('en-IN')}`;
  }
}

export function contactName(c) {
  if (!c) return '';
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || 'Unnamed';
}

export function leadName(l) {
  if (!l) return '';
  return [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || l.company || l.email || 'Unnamed lead';
}

// Active org users, for owner dropdowns.
export async function fetchOrgUsers() {
  const { data } = await sb
    .from('users')
    .select('id, full_name, email')
    .eq('status', 'active')
    .order('full_name');
  return data || [];
}

export function userOptions(users, selectedId) {
  const me = getUser();
  const list = users || [];
  const meListed = me && list.some(u => u.id === me.id);
  let html = `<option value="">— Unassigned —</option>`;
  if (me && !meListed) {
    html += `<option value="${me.id}" ${selectedId === me.id ? 'selected' : ''}>Me (${esc(me.email || 'me')})</option>`;
  }
  html += list.map(u =>
    `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${esc(u.full_name || u.email)}</option>`
  ).join('');
  return html;
}

export async function fetchAccountsLite() {
  const { data } = await sb.from('crm_accounts').select('id, name').order('name');
  return data || [];
}

export function accountOptions(accounts, selectedId, placeholder = '— No account —') {
  return `<option value="">${esc(placeholder)}</option>` + accounts.map(a =>
    `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');
}

// A labelled form field wrapper matching the platform's form styling.
export function field(label, inputHtml, hint) {
  return `<div class="form-group">
    <label class="form-label">${esc(label)}</label>
    ${inputHtml}
    ${hint ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">${esc(hint)}</div>` : ''}
  </div>`;
}

export const RATING_BADGE = { hot: 'error', warm: 'warning', cold: 'info' };
export const LEAD_STATUS_BADGE = { new: 'info', working: 'warning', qualified: 'success', unqualified: 'neutral', converted: 'success' };
