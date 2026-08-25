// Candidate outreach — the missing link between the pipeline and the person.
//
// The scheduling backend (schedule_token, /api/schedule, schedule.html) was
// fully built but had no way to reach a candidate: nothing in the app ever
// produced the link. This is that missing step, on both channels HR actually
// uses — email via Resend, and WhatsApp via a wa.me prefill the recruiter
// sends by hand (no paid BSP needed).
//
// Message text is composed server-side so the email and the WhatsApp message
// are always the same words, and so the preview is honest about what will be
// sent.

import { esc, toast, openModal, closeModal, getAuthToken } from '../../js/ui.js';

const KIND_LABELS = {
  schedule_invite: 'Invite to pick an interview time',
  shortlisted: 'Tell them they are shortlisted',
  interview_confirmed: 'Confirm the interview details',
  rejected: 'Send a considered rejection',
};

async function composeOutreach(applicationId, kind, send = false) {
  const token = await getAuthToken();
  const resp = await fetch('/api/send-notification?action=candidate-outreach', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ application_id: applicationId, kind, send }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Could not prepare the message');
  return data;
}

function waLink(phone, text) {
  return `https://wa.me/${String(phone || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`;
}

/**
 * Open the outreach composer for one application.
 * @param {object} o
 * @param {string} o.applicationId
 * @param {string} o.kind          one of KIND_LABELS
 * @param {string} [o.candidateName]
 * @param {Function} [o.onSent]    called after a successful email send
 */
export function openCandidateOutreach({ applicationId, kind, candidateName, onSent }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div style="display:grid;gap:var(--space-3);padding:var(--space-2)">
    <div class="skeleton skeleton-text"></div>
    <div class="skeleton skeleton-text" style="width:75%"></div>
    <div class="skeleton skeleton-text" style="width:50%"></div>
  </div>`;

  openModal(KIND_LABELS[kind] || 'Message candidate', wrap);

  function paintError(message, retry) {
    wrap.innerHTML = `<div style="display:grid;gap:var(--space-3)">
      <div style="color:var(--color-error);font-size:var(--text-sm)">${esc(message)}</div>
      <div><button class="btn btn-secondary btn-sm" id="co-retry">Try again</button></div>
    </div>`;
    wrap.querySelector('#co-retry').addEventListener('click', retry);
  }

  function paint(msg) {
    const { candidate, schedule_url } = msg;
    const hasEmail = !!candidate.email;
    const hasPhone = !!candidate.phone;

    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          To <strong style="color:var(--color-text-primary)">${esc(candidate.name || candidateName || 'candidate')}</strong>
          ${hasEmail ? ` · ${esc(candidate.email)}` : ''}${hasPhone ? ` · ${esc(candidate.phone)}` : ''}
        </div>

        ${!hasEmail && !hasPhone ? `
          <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--color-warning-light);color:var(--color-warning);font-size:var(--text-sm)">
            This candidate has no email or phone on file, so there is no way to reach them yet. Add contact details on their profile first.
          </div>` : ''}

        <div style="border:1px solid var(--color-border);border-radius:var(--radius-lg);overflow:hidden">
          <div style="padding:var(--space-3);background:var(--color-bg-secondary);border-bottom:1px solid var(--color-border);font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(msg.subject)}</div>
          <pre style="margin:0;padding:var(--space-4);white-space:pre-wrap;font-family:inherit;font-size:var(--text-sm);line-height:var(--line-height-relaxed);color:var(--color-text-secondary);max-height:320px;overflow-y:auto">${esc(msg.body)}</pre>
        </div>

        ${schedule_url ? `
          <div style="display:flex;gap:var(--space-2);align-items:center;font-size:var(--text-xs);color:var(--color-text-tertiary)">
            <code style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono)">${esc(schedule_url)}</code>
            <button class="btn btn-ghost btn-sm" id="co-copy-link">Copy link</button>
          </div>` : ''}

        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
          ${hasEmail ? `<button class="btn btn-primary" id="co-email">Send email</button>` : ''}
          ${hasPhone ? `<a class="btn btn-secondary" id="co-wa" href="${esc(waLink(candidate.phone, msg.whatsapp_text))}" target="_blank" rel="noopener">Open in WhatsApp</a>` : ''}
          <button class="btn btn-ghost btn-sm" id="co-copy-msg">Copy message</button>
          <span id="co-status" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:auto"></span>
        </div>
      </div>`;

    wrap.querySelector('#co-copy-link')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(schedule_url); toast('Scheduling link copied'); }
      catch { toast('Could not copy — select the link manually'); }
    });

    wrap.querySelector('#co-copy-msg')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(msg.body); toast('Message copied'); }
      catch { toast('Could not copy — select the text manually'); }
    });

    // WhatsApp is a hand-send: opening the link is as far as we can take it,
    // so say so rather than implying it went out.
    wrap.querySelector('#co-wa')?.addEventListener('click', () => {
      wrap.querySelector('#co-status').textContent = 'Opened in WhatsApp — press send there';
    });

    wrap.querySelector('#co-email')?.addEventListener('click', async () => {
      const btn = wrap.querySelector('#co-email');
      const status = wrap.querySelector('#co-status');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      status.textContent = '';
      try {
        const sent = await composeOutreach(applicationId, kind, true);
        btn.textContent = 'Sent';
        toast(`Email sent to ${sent.candidate.name || 'candidate'}`);
        onSent?.(sent);
        setTimeout(closeModal, 900);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Retry send';
        status.style.color = 'var(--color-error)';
        status.textContent = err.message;
      }
    });
  }

  function load() {
    composeOutreach(applicationId, kind, false)
      .then(paint)
      .catch((err) => paintError(err.message, load));
  }

  load();
}
