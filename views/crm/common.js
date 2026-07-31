// Shared helpers for the CRM module.
import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

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
  return `<option value="">— Unassigned —</option>` + users.map(u =>
    `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${esc(u.full_name || u.email)}</option>`
  ).join('');
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
