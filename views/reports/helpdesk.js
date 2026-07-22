import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, formatDate, initials, avColor } from '../../js/ui.js';

export default async function helpdeskReport(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org || !['owner', 'admin', 'manager'].includes(membership?.role)) {
    container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3></div>';
    return;
  }

  container.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading helpdesk report...</div>';

  const [{ data: tickets }, { data: categories }] = await Promise.all([
    sb.from('helpdesk_tickets').select('*, category:category_id(name, icon), creator:created_by(full_name), assignee:assigned_to(full_name)').eq('org_id', org.id).order('created_at', { ascending: false }),
    sb.from('helpdesk_categories').select('*').eq('org_id', org.id).order('sort_order'),
  ]);

  const all = tickets || [];
  const cats = categories || [];

  const open = all.filter(t => t.status === 'open').length;
  const inProgress = all.filter(t => t.status === 'in_progress').length;
  const resolved = all.filter(t => t.status === 'resolved' || t.status === 'closed').length;
  const urgent = all.filter(t => t.priority === 'Urgent' && ['open', 'in_progress'].includes(t.status)).length;

  const avgResolutionMs = all.filter(t => t.resolved_at).map(t => new Date(t.resolved_at) - new Date(t.created_at));
  const avgResolution = avgResolutionMs.length ? avgResolutionMs.reduce((a, b) => a + b, 0) / avgResolutionMs.length : 0;
  const avgHours = avgResolution ? Math.round(avgResolution / 3600000) : '—';

  const byCat = {};
  cats.forEach(c => byCat[c.id] = { name: c.name, icon: c.icon, open: 0, resolved: 0, total: 0 });
  byCat['uncategorized'] = { name: 'Uncategorized', icon: '❓', open: 0, resolved: 0, total: 0 };
  all.forEach(t => {
    const key = t.category_id || 'uncategorized';
    if (!byCat[key]) byCat[key] = { name: '—', icon: '📋', open: 0, resolved: 0, total: 0 };
    byCat[key].total++;
    if (['open', 'in_progress'].includes(t.status)) byCat[key].open++;
    else byCat[key].resolved++;
  });

  const byPriority = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
  all.forEach(t => { if (byPriority[t.priority] !== undefined) byPriority[t.priority]++; });
  const maxPri = Math.max(...Object.values(byPriority), 1);
  const priColors = { Low: 'var(--color-text-tertiary)', Medium: 'var(--color-info)', High: 'var(--color-warning)', Urgent: 'var(--color-error)' };

  const recent = all.slice(0, 10);

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Helpdesk Report</h1>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Ticket analytics and category breakdown</p>
    </div>

    <div class="stat-grid" style="margin-bottom:var(--space-6)">
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-warning)">${open}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Open</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-info)">${inProgress}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">In Progress</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-success)">${resolved}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Resolved / Closed</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:${urgent ? 'var(--color-error)' : 'var(--color-text-tertiary)'}">${urgent || '0'}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Urgent Pending</div>
      </div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-6)">
      <div class="card">
        <div class="card-body">
          <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">By Category</h3>
          ${Object.values(byCat).filter(c => c.total > 0).map(c => `
            <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3)">
              <span style="font-size:var(--text-md)">${c.icon || '📋'}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(c.name)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${c.open} open · ${c.resolved} resolved</div>
              </div>
              <span style="font-size:var(--text-lg);font-weight:var(--font-weight-bold);color:var(--color-text-primary)">${c.total}</span>
            </div>
          `).join('') || '<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No tickets yet</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">By Priority</h3>
          <div style="display:grid;gap:var(--space-3)">
            ${Object.entries(byPriority).map(([p, count]) => `
              <div style="display:flex;align-items:center;gap:var(--space-3)">
                <div style="width:60px;font-size:var(--text-sm);color:var(--color-text-secondary);text-align:right;flex-shrink:0">${p}</div>
                <div style="flex:1;height:24px;background:var(--color-bg-secondary);border-radius:var(--radius-md);overflow:hidden;position:relative">
                  <div style="height:100%;width:${(count / maxPri) * 100}%;background:${priColors[p]};border-radius:var(--radius-md);min-width:${count ? '2px' : '0'}"></div>
                  <span style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);font-size:var(--text-xs);font-weight:var(--font-weight-medium)">${count}</span>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border)">
            <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Avg Resolution Time</div>
            <div style="font-size:var(--text-xl);font-weight:var(--font-weight-bold);color:var(--color-text-primary)">${avgHours === '—' ? '—' : avgHours + 'h'}</div>
          </div>
        </div>
      </div>
    </div>

    ${recent.length ? `
    <div class="card">
      <div class="card-body">
        <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">Recent Tickets</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Raised By</th><th>Assigned</th><th>Created</th></tr></thead>
          <tbody>${recent.map(t => {
            const statusMap = { open: 'warning', in_progress: 'info', resolved: 'success', closed: 'neutral' };
            const statusLabel = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
            const priMap = { Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'error' };
            return `<tr>
              <td style="font-weight:var(--font-weight-medium);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.subject)}</td>
              <td>${t.category ? `<span class="badge badge-info">${esc(t.category.icon || '')} ${esc(t.category.name)}</span>` : '—'}</td>
              <td><span class="badge badge-${priMap[t.priority] || 'neutral'}">${esc(t.priority)}</span></td>
              <td><span class="badge badge-${statusMap[t.status] || 'neutral'}">${statusLabel[t.status] || esc(t.status)}</span></td>
              <td style="font-size:var(--text-sm)">${esc(t.creator?.full_name || '—')}</td>
              <td style="font-size:var(--text-sm)">${esc(t.assignee?.full_name || '—')}</td>
              <td style="font-size:var(--text-sm)">${formatDate(t.created_at)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </div>` : ''}`;
}
