import { getOrg, getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

export default async function integrationsView(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  const integrations = [
    { name: 'Google Calendar', desc: 'Sync interviews and leave with Google Calendar', icon: '\u{1F4C5}', status: 'coming_soon' },
    { name: 'Google Meet', desc: 'Auto-generate meeting links for interviews', icon: '\u{1F4F9}', status: 'coming_soon' },
    { name: 'Slack', desc: 'Send notifications and approvals via Slack', icon: '\u{1F4AC}', status: 'coming_soon' },
    { name: 'WhatsApp (Interakt)', desc: 'Send interview invites and reminders via WhatsApp', icon: '\u{1F4F1}', status: 'coming_soon' },
    { name: 'Resend Email', desc: 'Transactional emails for invites, approvals, and alerts', icon: '\u{2709}\u{FE0F}', status: 'coming_soon' },
    { name: 'Google Maps', desc: 'Geofenced attendance check-in/out', icon: '\u{1F4CD}', status: 'coming_soon' },
  ];

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Integrations</h1>
      <p class="page-subtitle">Connect external services to your workspace</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:var(--space-4)">
      ${integrations.map(i => `
        <div class="card">
          <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
            <div style="font-size:var(--text-2xl);width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--color-bg-secondary);border-radius:var(--radius-lg);flex-shrink:0">${i.icon}</div>
            <div style="flex:1">
              <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">${esc(i.name)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-3)">${esc(i.desc)}</div>
              <span class="badge badge-neutral">Coming Soon</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
