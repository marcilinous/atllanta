import sb from './supabase.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  const m = document.getElementById('toast-msg');
  if (!t || !m) return;
  m.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.classList.remove('show'); t.classList.add('hidden'); }, ms);
}

export function scoreBar(score) {
  if (score === null || score === undefined) return '<span class="badge badge-neutral"><span class="badge-dot"></span>unscored</span>';
  const s = Math.round(score);
  const color = s >= 70 ? 'var(--color-success)' : s >= 40 ? 'var(--color-warning)' : 'var(--color-error)';
  return `<div style="display:flex;align-items:center;gap:var(--space-2)">
    <div style="width:60px;height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
      <div style="width:${s}%;height:100%;background:${color};border-radius:var(--radius-full)"></div>
    </div>
    <span style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">${s}</span>
  </div>`;
}

export function stagePill(stage) {
  const label = (stage || 'new').replaceAll('_', ' ');
  const colors = {
    new: 'neutral', applied: 'neutral', screening: 'info', screened: 'info',
    shortlisted: 'success', interview_scheduled: 'warning', interviewed: 'warning',
    offered: 'success', hired: 'success', rejected: 'error',
    open: 'success', draft: 'neutral', on_hold: 'warning', closed: 'error', paused: 'warning',
  };
  const c = colors[stage] || 'neutral';
  return `<span class="badge badge-${c}"><span class="badge-dot"></span>${label}</span>`;
}

export function initials(name) {
  const parts = (name || '?').split(' ');
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || '?').slice(0, 2).toUpperCase();
}

const avColors = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2'];
export function avColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return avColors[Math.abs(h) % avColors.length];
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;
  const backdrop = document.createElement('div');
  backdrop.id = 'modal-backdrop';
  backdrop.className = 'modal-overlay hidden';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title" id="modal-title"></h2>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body" id="modal-body"></div>
    </div>`;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  modalEl = backdrop;
  return modalEl;
}

export function openModal(title, bodyNode) {
  const backdrop = ensureModal();
  backdrop.querySelector('#modal-title').textContent = title;
  const body = backdrop.querySelector('#modal-body');
  body.innerHTML = '';
  if (typeof bodyNode === 'string') {
    body.innerHTML = bodyNode;
  } else {
    body.appendChild(bodyNode);
  }
  backdrop.classList.remove('hidden');
}

export function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
}

export async function getAuthToken() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || '';
}

export async function getClientId() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data: membership } = await sb
    .from('memberships')
    .select('client_id')
    .eq('user_id', session.user.id)
    .order('created_at')
    .limit(1)
    .single();
  if (membership?.client_id) return membership.client_id;
  const { data: clients } = await sb
    .from('clients')
    .select('id')
    .order('created_at')
    .limit(1);
  return clients?.[0]?.id || null;
}

let cachedClientId = null;
export async function clientId() {
  if (cachedClientId) return cachedClientId;
  cachedClientId = await getClientId();
  return cachedClientId;
}
