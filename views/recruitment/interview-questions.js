// Interview guide — AI-generated, candidate-specific interview questions.
//
// Shared by the shortlist view (prep before scheduling) and the candidate
// profile (prep before walking into the room). The guide lives on the
// application row, so it is generated once and read back free afterwards.

import { esc, toast, openModal, getAuthToken } from '../../js/ui.js';

const CATEGORY_TONE = {
  'Experience deep-dive': 'badge-info',
  'Skill verification': 'badge-success',
  'Gap probe': 'badge-warning',
  'Role fit': 'badge-neutral',
  'Motivation': 'badge-neutral',
};

function questionsToText(guide, { candidateName, jobTitle }) {
  const lines = [`Interview guide — ${candidateName} · ${jobTitle}`, ''];
  if (guide.focus_areas?.length) {
    lines.push('Focus areas: ' + guide.focus_areas.join(', '), '');
  }
  (guide.questions || []).forEach((q, i) => {
    lines.push(`${i + 1}. [${q.category}] ${q.question}`);
    if (q.why) lines.push(`   Why: ${q.why}`);
    if (q.strong_answer) lines.push(`   Strong answer: ${q.strong_answer}`);
    if (q.follow_up) lines.push(`   Follow-up: ${q.follow_up}`);
    lines.push('');
  });
  return lines.join('\n');
}

function renderGuide(guide, meta) {
  const questions = guide.questions || [];
  if (!questions.length) {
    return `<div class="empty-state" style="padding:var(--space-6)">
      <div class="empty-state-title">No questions yet</div>
    </div>`;
  }

  return `
    ${guide.focus_areas?.length ? `
      <div style="margin-bottom:var(--space-4)">
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:var(--space-2)">What this interview must establish</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
          ${guide.focus_areas.map(f => `<span class="badge badge-info">${esc(f)}</span>`).join('')}
        </div>
      </div>` : ''}

    <ol style="list-style:none;counter-reset:q;padding:0;margin:0;display:grid;gap:var(--space-3)">
      ${questions.map((q, i) => `
        <li style="counter-increment:q;border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-4);background:var(--color-surface)">
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);flex-wrap:wrap">
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-weight:var(--font-weight-semibold)">${i + 1}</span>
            <span class="badge ${CATEGORY_TONE[q.category] || 'badge-neutral'}">${esc(q.category)}</span>
          </div>
          <div style="font-weight:var(--font-weight-medium);line-height:var(--line-height-normal);margin-bottom:var(--space-3)">${esc(q.question)}</div>
          <div style="display:grid;gap:var(--space-2);font-size:var(--text-sm);color:var(--color-text-secondary)">
            ${q.why ? `<div><strong style="color:var(--color-text-primary);font-weight:var(--font-weight-medium)">Why ask:</strong> ${esc(q.why)}</div>` : ''}
            ${q.strong_answer ? `<div><strong style="color:var(--color-text-primary);font-weight:var(--font-weight-medium)">Strong answer:</strong> ${esc(q.strong_answer)}</div>` : ''}
            ${q.follow_up ? `<div><strong style="color:var(--color-text-primary);font-weight:var(--font-weight-medium)">If thin, follow up:</strong> ${esc(q.follow_up)}</div>` : ''}
          </div>
        </li>`).join('')}
    </ol>

    <div style="display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-4);flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" id="iq-copy">Copy guide</button>
      <button class="btn btn-ghost btn-sm" id="iq-regen">Regenerate (1 credit)</button>
      ${meta.generatedAt ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:auto">Generated ${new Date(meta.generatedAt).toLocaleString()}</span>` : ''}
    </div>
  `;
}

/**
 * Open the interview guide for one application.
 * @param {object} o
 * @param {string} o.applicationId
 * @param {string} o.candidateName
 * @param {string} o.jobTitle
 * @param {object} [o.existing]    already-loaded interview_questions JSONB, if the caller has it
 * @param {string} [o.existingAt]  interview_questions_at, if the caller has it
 * @param {Function} [o.onGenerated] called after a fresh generation, so the caller can refresh its row
 */
export function openInterviewQuestions({ applicationId, candidateName, jobTitle, existing, existingAt, onGenerated }) {
  const wrap = document.createElement('div');
  const meta = { candidateName, jobTitle, generatedAt: existingAt };

  function paintIntro() {
    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <p style="margin:0;color:var(--color-text-secondary);font-size:var(--text-sm);line-height:var(--line-height-relaxed)">
          Generates questions written for <strong style="color:var(--color-text-primary)">${esc(candidateName)}</strong> specifically —
          anchored in their resume, the ${esc(jobTitle)} JD, and the gaps screening already found.
          Not a generic question bank.
        </p>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <button class="btn btn-primary" id="iq-generate">Generate interview guide</button>
          <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Uses 1 credit</span>
        </div>
        <div id="iq-status" style="font-size:var(--text-sm);color:var(--color-error)"></div>
      </div>`;
    wrap.querySelector('#iq-generate').addEventListener('click', () => generate(false));
  }

  function paintGuide(guide) {
    wrap.innerHTML = renderGuide(guide, meta);
    wrap.querySelector('#iq-copy')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(questionsToText(guide, meta));
        toast('Interview guide copied');
      } catch {
        toast('Could not copy — select the text manually');
      }
    });
    wrap.querySelector('#iq-regen')?.addEventListener('click', () => generate(true));
  }

  function paintLoading(message) {
    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-3);padding:var(--space-2)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(message)}</div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text" style="width:80%"></div>
        <div class="skeleton skeleton-text" style="width:55%"></div>
      </div>`;
  }

  async function generate(regenerate) {
    paintLoading(regenerate ? 'Writing a fresh set of questions…' : 'Reading the resume against the JD…');
    try {
      const token = await getAuthToken();
      const resp = await fetch('/api/screen-job?action=interview-questions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId, regenerate: !!regenerate }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not generate questions');

      meta.generatedAt = data.generated_at;
      paintGuide(data);
      if (!data.cached) {
        toast(`Interview guide ready · ${data.credits_used} credit used`);
        onGenerated?.(data);
      }
    } catch (err) {
      wrap.innerHTML = `
        <div style="display:grid;gap:var(--space-3)">
          <div style="color:var(--color-error);font-size:var(--text-sm)">${esc(err.message)}</div>
          <div><button class="btn btn-secondary btn-sm" id="iq-retry">Try again</button></div>
        </div>`;
      wrap.querySelector('#iq-retry').addEventListener('click', () => generate(regenerate));
    }
  }

  openModal(`Interview guide — ${candidateName}`, wrap);

  if (existing?.questions?.length) paintGuide(existing);
  else paintIntro();
}
