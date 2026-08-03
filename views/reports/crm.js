import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

function money(n) {
  const cur = getOrg()?.currency || 'INR';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n) || 0); }
  catch { return `${cur} ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`; }
}

export default async function crmReport(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org || !['owner', 'admin', 'manager'].includes(membership?.role)) {
    container.innerHTML = '<div class="empty-state"><h3 class="empty-state-title">Access Denied</h3></div>';
    return;
  }

  container.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading sales report...</div>';

  const [{ data: stages }, { data: opps }, { data: users }] = await Promise.all([
    sb.from('crm_pipeline_stages').select('*').eq('org_id', org.id).order('sort_order'),
    sb.from('crm_opportunities').select('id, name, amount, probability, status, stage_id, owner_id, updated_at'),
    sb.from('users').select('id, full_name, email'),
  ]);

  const allStages = stages || [];
  const allOpps = opps || [];
  const nameById = Object.fromEntries((users || []).map(u => [u.id, u.full_name || u.email]));

  const open = allOpps.filter(o => o.status === 'open');
  const won = allOpps.filter(o => o.status === 'won');
  const lost = allOpps.filter(o => o.status === 'lost');

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const wonThisMonth = won.filter(o => o.updated_at && new Date(o.updated_at) >= monthStart);

  const pipelineValue = open.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const weighted = open.reduce((s, o) => {
    const stage = allStages.find(st => st.id === o.stage_id);
    const p = (o.probability ?? stage?.probability ?? 0) / 100;
    return s + (Number(o.amount) || 0) * p;
  }, 0);
  const closedCount = won.length + lost.length;
  const winRate = closedCount ? Math.round((won.length / closedCount) * 100) : null;

  // by stage (open only)
  const openStages = allStages.filter(s => !s.is_won && !s.is_lost);
  const stageRows = openStages.map(st => {
    const cards = open.filter(o => o.stage_id === st.id);
    return { name: st.name, count: cards.length, value: cards.reduce((s, o) => s + (Number(o.amount) || 0), 0) };
  });
  const maxStageValue = Math.max(...stageRows.map(r => r.value), 1);

  // by owner
  const ownerMap = {};
  allOpps.forEach(o => {
    const key = o.owner_id || 'unassigned';
    if (!ownerMap[key]) ownerMap[key] = { openValue: 0, openCount: 0, won: 0, wonValue: 0 };
    if (o.status === 'open') { ownerMap[key].openValue += Number(o.amount) || 0; ownerMap[key].openCount++; }
    if (o.status === 'won') { ownerMap[key].won++; ownerMap[key].wonValue += Number(o.amount) || 0; }
  });
  const ownerRows = Object.entries(ownerMap)
    .map(([id, v]) => ({ name: id === 'unassigned' ? 'Unassigned' : (nameById[id] || 'Unknown'), ...v }))
    .sort((a, b) => b.openValue - a.openValue);

  const statCard = (label, value, color) => `<div class="card"><div class="card-body" style="text-align:center">
    <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${color ? `color:${color}` : ''}">${value}</div>
    <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-1)">${esc(label)}</div>
  </div>`;

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Sales Report</h1>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Pipeline, forecast, and performance across your visible deals</p>
    </div>

    <div class="stat-grid" style="margin-bottom:var(--space-6)">
      ${statCard('Open deals', String(open.length))}
      ${statCard('Pipeline value', money(pipelineValue), 'var(--color-accent)')}
      ${statCard('Weighted forecast', money(weighted), 'var(--color-info)')}
      ${statCard('Won this month', money(wonThisMonth.reduce((s, o) => s + (Number(o.amount) || 0), 0)), 'var(--color-success)')}
      ${statCard('Win rate', winRate === null ? '—' : winRate + '%', 'var(--color-success)')}
    </div>

    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header"><span class="card-title">Open pipeline by stage</span></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3)">
        ${stageRows.length ? stageRows.map(r => `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:var(--text-sm);margin-bottom:2px">
              <span>${esc(r.name)} <span style="color:var(--color-text-tertiary)">· ${r.count}</span></span>
              <span style="font-weight:var(--font-weight-medium)">${money(r.value)}</span>
            </div>
            <div style="height:8px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
              <div style="height:100%;width:${Math.max((r.value / maxStageValue) * 100, r.count ? 3 : 0)}%;background:var(--color-accent);border-radius:var(--radius-full)"></div>
            </div>
          </div>`).join('') : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No open deals.</div>'}
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">By owner</span></div>
      ${ownerRows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Owner</th><th>Open deals</th><th>Open value</th><th>Won</th><th>Won value</th></tr></thead>
        <tbody>${ownerRows.map(r => `<tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(r.name)}</td>
          <td>${r.openCount}</td>
          <td>${money(r.openValue)}</td>
          <td>${r.won}</td>
          <td>${money(r.wonValue)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="card-body" style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No deals yet.</div>'}
    </div>
  `;
}
