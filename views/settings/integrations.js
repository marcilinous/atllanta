import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';

export default async function integrationsView(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  const integrations = [
    {
      name: 'Resend Email',
      desc: 'Transactional emails for leave approvals, interview invites, and alerts',
      icon: '✉️',
      status: 'available',
      envVar: 'RESEND_API_KEY',
      setup: 'Add RESEND_API_KEY and RESEND_FROM environment variables in Vercel. Emails are sent automatically when events are processed.',
      docs: 'https://resend.com/docs',
    },
    {
      name: 'Groq AI',
      desc: 'LLM-powered resume parsing, JD analysis, and AI assistant',
      icon: '🧠',
      status: 'active',
      setup: 'Already integrated. Uses GROQ_API_KEY for resume parsing, JD analysis, CV-JD matching, and the AI assistant.',
    },
    {
      name: 'Supabase Storage',
      desc: 'File storage for resumes, documents, and employee files',
      icon: '📁',
      status: 'active',
      setup: 'Built into the platform. Files are stored securely with RLS policies.',
    },
    {
      name: 'Google Calendar',
      desc: 'Sync interviews and leave with Google Calendar',
      icon: '📅',
      status: 'coming_soon',
      setup: 'Will sync interview schedules and approved leave with team calendars.',
    },
    {
      name: 'Google Meet',
      desc: 'Auto-generate meeting links for interviews',
      icon: '📹',
      status: 'coming_soon',
      setup: 'Automatically create Google Meet links when scheduling interviews.',
    },
    {
      name: 'Slack',
      desc: 'Send notifications and approvals via Slack',
      icon: '💬',
      status: 'coming_soon',
      setup: 'Send leave approval requests and interview reminders to Slack channels.',
    },
    {
      name: 'WhatsApp (BSP)',
      desc: 'Send interview invites and reminders via WhatsApp',
      icon: '📱',
      status: 'coming_soon',
      setup: 'Connect via Interakt or AiSensy to send WhatsApp messages to candidates.',
    },
    {
      name: 'Google Maps',
      desc: 'Geofenced attendance check-in/out',
      icon: '📍',
      status: 'coming_soon',
      setup: 'Restrict attendance check-in to specific office locations using geofencing.',
    },
  ];

  const statusBadge = (s) => {
    if (s === 'active') return '<span class="badge badge-success"><span class="badge-dot"></span>Active</span>';
    if (s === 'available') return '<span class="badge badge-info"><span class="badge-dot"></span>Available</span>';
    return '<span class="badge badge-neutral">Coming Soon</span>';
  };

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Integrations</h1>
      <p class="page-subtitle">Connect external services to your workspace</p>
    </div>

    <div style="display:grid;gap:var(--space-3);margin-bottom:var(--space-6)">
      <h3 style="font-size:var(--text-base);font-weight:var(--font-weight-semibold);color:var(--color-text-secondary)">Active & Available</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:var(--space-4)">
        ${integrations.filter(i => i.status !== 'coming_soon').map(i => `
          <div class="card">
            <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
              <div style="font-size:var(--text-2xl);width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--color-bg-secondary);border-radius:var(--radius-lg);flex-shrink:0">${i.icon}</div>
              <div style="flex:1">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-1)">
                  <span style="font-weight:var(--font-weight-semibold)">${esc(i.name)}</span>
                  ${statusBadge(i.status)}
                </div>
                <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-3)">${esc(i.desc)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);padding:var(--space-2);background:var(--color-bg-secondary);border-radius:var(--radius-md)">${esc(i.setup)}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="display:grid;gap:var(--space-3)">
      <h3 style="font-size:var(--text-base);font-weight:var(--font-weight-semibold);color:var(--color-text-secondary)">Planned Integrations</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:var(--space-4)">
        ${integrations.filter(i => i.status === 'coming_soon').map(i => `
          <div class="card" style="opacity:0.7">
            <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
              <div style="font-size:var(--text-2xl);width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--color-bg-secondary);border-radius:var(--radius-lg);flex-shrink:0">${i.icon}</div>
              <div style="flex:1">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-1)">
                  <span style="font-weight:var(--font-weight-semibold)">${esc(i.name)}</span>
                  ${statusBadge(i.status)}
                </div>
                <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(i.desc)}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
