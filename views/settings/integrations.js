import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';

export default async function integrationsView(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  let googleStatus = null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const resp = await fetch('/api/google-auth?action=status', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (resp.ok) googleStatus = await resp.json();
    }
  } catch (_) {}

  const googleConnected = googleStatus?.connected;

  const integrations = [
    {
      name: 'Resend Email',
      desc: 'Transactional emails for leave approvals, interview invites, and alerts',
      icon: '✉️',
      status: 'available',
      setup: 'Add RESEND_API_KEY and RESEND_FROM environment variables in Vercel.',
    },
    {
      name: 'Groq AI',
      desc: 'LLM-powered resume parsing, JD analysis, and AI assistant',
      icon: '🧠',
      status: 'active',
      setup: 'Already integrated. Uses GROQ_API_KEY for resume matching and AI assistant.',
    },
    {
      name: 'Supabase Storage',
      desc: 'File storage for resumes, documents, and employee files',
      icon: '📁',
      status: 'active',
      setup: 'Built into the platform. Files are stored securely with RLS policies.',
    },
    {
      name: 'Google Calendar & Meet',
      desc: 'Sync interviews with Google Calendar and auto-generate Meet links',
      icon: '📅',
      status: googleConnected ? 'active' : 'available',
      isGoogle: true,
      setup: googleConnected
        ? `Connected${googleStatus.connected_at ? ' since ' + new Date(googleStatus.connected_at).toLocaleDateString() : ''}.`
        : 'Connect your Google account to create calendar events with Meet links for interviews.',
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
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);padding:var(--space-2);background:var(--color-bg-secondary);border-radius:var(--radius-md);margin-bottom:var(--space-3)">${esc(i.setup)}</div>
                ${i.isGoogle ? `<div style="display:flex;gap:var(--space-2)">
                  ${googleConnected
                    ? '<button class="btn btn-sm" style="background:var(--color-error-light);color:var(--color-error);border:none" id="google-disconnect">Disconnect</button>'
                    : '<button class="btn btn-primary btn-sm" id="google-connect">Connect Google Account</button>'}
                </div>` : ''}
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

  document.getElementById('google-connect')?.addEventListener('click', async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch('/api/google-auth?action=url', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const { url, error } = await resp.json();
      if (error) return toast(error);
      window.location.href = url;
    } catch (err) {
      toast('Failed to start Google auth: ' + err.message);
    }
  });

  document.getElementById('google-disconnect')?.addEventListener('click', async () => {
    if (!confirm('Disconnect Google Calendar? This will remove your stored tokens.')) return;
    try {
      const { data: { session } } = await sb.auth.getSession();
      await fetch('/api/google-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      toast('Google Calendar disconnected');
      integrationsView(container);
    } catch (err) {
      toast('Failed to disconnect: ' + err.message);
    }
  });

  if (window.location.hash.includes('google=connected')) {
    toast('Google Calendar connected successfully!');
    window.location.hash = window.location.hash.replace(/[?&]google=connected/, '');
  }
}
