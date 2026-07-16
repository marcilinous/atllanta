// ATLLANTA frontend — vanilla JS, Supabase (RLS-enforced), Vercel APIs.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.ATLLANTA_CONFIG;
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---------- state ----------
const S = {
  session: null,
  org: null,          // current organization row
  membership: null,
  clients: [],        // clients visible to this user
  clientId: null,     // active client
  view: "jobs",
  cache: { jobs: [], candidates: [], applications: [] },
};

// ---------- tiny helpers ----------
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), ms);
}
function ringColor(score) {
  if (score >= 70) return "var(--teal)";
  if (score >= 45) return "var(--amber)";
  return "var(--brick)";
}
function scoreRing(score, small = false) {
  if (score === null || score === undefined)
    return `<span class="stage-badge">unscored</span>`;
  const s = Math.round(score);
  return `<div class="score-ring${small ? " small" : ""}" style="--pct:${s};--ring:${ringColor(s)}">${s}</div>`;
}
function openModal(title, bodyNode) {
  $("#modal-title").textContent = title;
  const body = $("#modal-body");
  body.innerHTML = "";
  body.appendChild(bodyNode);
  $("#modal-backdrop").classList.remove("hidden");
}
function closeModal() { $("#modal-backdrop").classList.add("hidden"); }
$("#modal-close").addEventListener("click", closeModal);
$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

// ---------- auth ----------
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn");
  const err = $("#login-error");
  err.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
  });
  btn.disabled = false;
  btn.textContent = "Sign in";
  if (error) {
    err.textContent = error.message;
    err.classList.remove("hidden");
    return;
  }
  boot();
});

$("#logout-btn").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

$("#user-avatar").addEventListener("click", () =>
  $("#rail-profile").classList.toggle("open")
);
document.addEventListener("click", (e) => {
  if (!$("#rail-profile").contains(e.target))
    $("#rail-profile").classList.remove("open");
});

// ---------- boot ----------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) {
    $("#auth-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
    return;
  }
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-avatar").textContent = (session.user.email || "?")[0];
  $("#menu-email").textContent = session.user.email;

  // membership + org + clients (all RLS-scoped)
  const { data: memberships } = await sb
    .from("memberships")
    .select("*")
    .order("created_at");
  S.membership = memberships?.[0] || null;

  if (!S.membership) {
    $("#menu-org").textContent = "No organization yet";
    $("#view-root").innerHTML =
      `<div class="empty"><strong>No organization linked to this account</strong>
       Ask your admin to add you to an organization, then sign in again.</div>`;
    return;
  }

  const [{ data: org }, { data: clients }] = await Promise.all([
    sb.from("organizations").select("*").eq("id", S.membership.organization_id).single(),
    sb.from("clients").select("*").order("created_at"),
  ]);
  S.org = org;
  S.clients = clients || [];
  S.clientId = S.membership.client_id || S.clients[0]?.id || null;
  $("#menu-org").textContent = org?.name || "—";
  $("#credits-count").textContent = org?.credits_balance ?? "—";

  const sw = $("#client-switcher");
  sw.innerHTML = S.clients
    .map((c) => `<option value="${c.id}">${esc(c.name)}${c.is_self ? " (self)" : ""}</option>`)
    .join("");
  sw.value = S.clientId || "";
  sw.onchange = () => { S.clientId = sw.value; render(); };
  sw.classList.toggle("hidden", S.clients.length <= 1);

  render();
}

// ---------- data loads ----------
async function loadData() {
  if (!S.clientId) return;
  const [{ data: jobs }, { data: candidates }] = await Promise.all([
    sb.from("jobs").select("*").eq("client_id", S.clientId).order("created_at", { ascending: false }),
    sb.from("candidates").select("*").eq("client_id", S.clientId).order("created_at", { ascending: false }),
  ]);
  S.cache.jobs = jobs || [];
  S.cache.candidates = candidates || [];
  const jobIds = S.cache.jobs.map((j) => j.id);
  if (jobIds.length) {
    const { data: apps } = await sb
      .from("applications")
      .select("*")
      .in("job_id", jobIds)
      .order("updated_at", { ascending: false });
    S.cache.applications = apps || [];
  } else {
    S.cache.applications = [];
  }
}

// ---------- navigation ----------
const TITLES = {
  jobs: "Jobs", candidates: "Candidates", interviews: "Interviews",
  chat: "Chat", rescore: "Re-score", analytics: "Analytics",
};
document.querySelectorAll(".rail-btn").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".rail-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    S.view = b.dataset.view;
    render();
  })
);

async function render() {
  $("#view-title").textContent = TITLES[S.view];
  const root = $("#view-root");
  root.innerHTML = `<div class="empty">Loading…</div>`;
  await loadData();
  root.innerHTML = "";
  VIEWS[S.view](root);
}

// =====================================================================
// VIEWS
// =====================================================================
const VIEWS = { jobs, candidates, interviews, chat, rescore, analytics };

// ---------- Jobs ----------
function jobs(root) {
  const bar = el("div", "toolbar");
  const chips = el("div", "chips");
  const statuses = ["all", "open", "paused", "closed"];
  let filter = "all";
  statuses.forEach((s) => {
    const c = el("button", `chip${s === "all" ? " active" : ""}`, s);
    c.onclick = () => {
      filter = s;
      chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      draw();
    };
    chips.appendChild(c);
  });
  bar.appendChild(chips);
  bar.appendChild(el("div", "spacer"));
  const addBtn = el("button", "btn btn-primary", "+ New job");
  addBtn.onclick = jobForm;
  bar.appendChild(addBtn);
  root.appendChild(bar);

  const card = el("div", "card");
  root.appendChild(card);

  function draw() {
    const rows = S.cache.jobs.filter((j) => filter === "all" || j.status === filter);
    if (!rows.length) {
      card.innerHTML = `<div class="empty"><strong>No jobs yet</strong>Add your first job with its JD text to start matching resumes.</div>`;
      return;
    }
    card.innerHTML = `<table class="table">
      <thead><tr><th>Title</th><th>Status</th><th>Candidates</th><th>Created</th><th></th></tr></thead>
      <tbody>${rows.map((j) => {
        const count = S.cache.applications.filter((a) => a.job_id === j.id).length;
        return `<tr>
          <td><strong>${esc(j.title)}</strong></td>
          <td><span class="stage-badge ${j.status}">${j.status}</span></td>
          <td>${count}</td>
          <td>${new Date(j.created_at).toLocaleDateString()}</td>
          <td><button class="btn btn-ghost btn-sm" data-id="${j.id}" data-act="attach">+ Candidate</button></td>
        </tr>`;
      }).join("")}</tbody></table>`;
    card.querySelectorAll("[data-act=attach]").forEach((b) =>
      b.addEventListener("click", () => attachCandidateForm(b.dataset.id))
    );
  }
  draw();
}

function jobForm() {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Job title <input id="jf-title" placeholder="e.g. Senior Backend Engineer" /></label>
    <label>Short description <input id="jf-desc" placeholder="One line for the list view" /></label>
    <label>Job description (paste full JD text) <textarea id="jf-jd" placeholder="Paste the complete JD here — this is what resumes get scored against."></textarea></label>
    <button class="btn btn-primary" id="jf-save">Create job</button>`;
  openModal("New job", f);
  f.querySelector("#jf-save").onclick = async () => {
    const title = f.querySelector("#jf-title").value.trim();
    if (!title) return toast("Job title is required");
    const { error } = await sb.from("jobs").insert({
      client_id: S.clientId,
      title,
      description: f.querySelector("#jf-desc").value.trim(),
      jd_raw_text: f.querySelector("#jf-jd").value.trim(),
    });
    if (error) return toast(error.message);
    closeModal();
    toast("Job created");
    render();
  };
}

// ---------- Candidates ----------
function candidates(root) {
  const bar = el("div", "toolbar");
  const jobSel = el("select", "select");
  jobSel.innerHTML =
    `<option value="all">All jobs</option>` +
    S.cache.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("");
  bar.appendChild(jobSel);

  const chips = el("div", "chips");
  const stages = ["all", "new", "screened", "shortlisted", "interview_scheduled", "hired", "rejected"];
  let stageFilter = "all";
  stages.forEach((s) => {
    const c = el("button", `chip${s === "all" ? " active" : ""}`, s.replaceAll("_", " "));
    c.onclick = () => {
      stageFilter = s;
      chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      draw();
    };
    chips.appendChild(c);
  });
  bar.appendChild(chips);
  bar.appendChild(el("div", "spacer"));
  const addBtn = el("button", "btn btn-primary", "+ Add candidate");
  addBtn.onclick = () => candidateForm();
  bar.appendChild(addBtn);
  root.appendChild(bar);

  const card = el("div", "card");
  root.appendChild(card);
  jobSel.onchange = draw;

  function draw() {
    const jobFilter = jobSel.value;
    let rows = S.cache.applications
      .filter((a) => jobFilter === "all" || a.job_id === jobFilter)
      .filter((a) => stageFilter === "all" || a.stage === stageFilter)
      .map((a) => ({
        app: a,
        cand: S.cache.candidates.find((c) => c.id === a.candidate_id),
        job: S.cache.jobs.find((j) => j.id === a.job_id),
      }))
      .filter((r) => r.cand && r.job);

    // also show candidates with no application yet when unfiltered
    const appliedIds = new Set(S.cache.applications.map((a) => a.candidate_id));
    const unattached =
      jobFilter === "all" && stageFilter === "all"
        ? S.cache.candidates.filter((c) => !appliedIds.has(c.id))
        : [];

    if (!rows.length && !unattached.length) {
      card.innerHTML = `<div class="empty"><strong>No candidates yet</strong>Add a candidate and paste their resume text to score them against a job.</div>`;
      return;
    }

    card.innerHTML = `<table class="table">
      <thead><tr><th>Score</th><th>Candidate</th><th>Job</th><th>Stage</th><th></th></tr></thead>
      <tbody>
      ${rows.map((r) => `<tr>
        <td>${scoreRing(r.app.match_score, true)}</td>
        <td><strong>${esc(r.cand.name)}</strong><br><span style="color:var(--ink-soft);font-size:12px">${esc(r.cand.email || r.cand.phone || "")}</span></td>
        <td>${esc(r.job.title)}</td>
        <td><span class="stage-badge ${r.app.stage}">${r.app.stage.replaceAll("_", " ")}</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-app="${r.app.id}" data-act="score">${r.app.match_score == null ? "Score" : "View"}</button>
          <button class="btn btn-ghost btn-sm" data-app="${r.app.id}" data-act="stage">Stage</button>
        </td>
      </tr>`).join("")}
      ${unattached.map((c) => `<tr>
        <td><span class="stage-badge">no job</span></td>
        <td><strong>${esc(c.name)}</strong><br><span style="color:var(--ink-soft);font-size:12px">${esc(c.email || c.phone || "")}</span></td>
        <td>—</td><td>—</td>
        <td><button class="btn btn-ghost btn-sm" data-cand="${c.id}" data-act="attach">Attach to job</button></td>
      </tr>`).join("")}
      </tbody></table>`;

    card.querySelectorAll("[data-act=score]").forEach((b) =>
      b.addEventListener("click", () => scoreDetail(b.dataset.app))
    );
    card.querySelectorAll("[data-act=stage]").forEach((b) =>
      b.addEventListener("click", () => stageForm(b.dataset.app))
    );
    card.querySelectorAll("[data-act=attach]").forEach((b) =>
      b.addEventListener("click", () => attachJobForm(b.dataset.cand))
    );
  }
  draw();
}

function candidateForm() {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Full name <input id="cf-name" /></label>
    <label>Email <input id="cf-email" type="email" /></label>
    <label>Phone (with country code, for WhatsApp) <input id="cf-phone" placeholder="91XXXXXXXXXX" /></label>
    <label>Resume text (paste) <textarea id="cf-resume" placeholder="Paste the resume text here — this is what gets scored."></textarea></label>
    <label>Attach to job (optional)
      <select id="cf-job"><option value="">— none —</option>
      ${S.cache.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("")}</select>
    </label>
    <button class="btn btn-primary" id="cf-save">Add candidate</button>`;
  openModal("Add candidate", f);
  f.querySelector("#cf-save").onclick = async () => {
    const name = f.querySelector("#cf-name").value.trim();
    if (!name) return toast("Name is required");
    const { data: cand, error } = await sb
      .from("candidates")
      .insert({
        client_id: S.clientId,
        name,
        email: f.querySelector("#cf-email").value.trim() || null,
        phone: f.querySelector("#cf-phone").value.trim() || null,
        resume_raw_text: f.querySelector("#cf-resume").value.trim() || null,
      })
      .select()
      .single();
    if (error) return toast(error.message);
    const jobId = f.querySelector("#cf-job").value;
    if (jobId) await sb.from("applications").insert({ job_id: jobId, candidate_id: cand.id });
    closeModal();
    toast("Candidate added");
    render();
  };
}

function attachCandidateForm(jobId) {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Candidate
      <select id="af-cand">
        ${S.cache.candidates.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
      </select>
    </label>
    <button class="btn btn-primary" id="af-save">Attach</button>`;
  openModal("Attach candidate to job", f);
  f.querySelector("#af-save").onclick = async () => {
    const { error } = await sb
      .from("applications")
      .insert({ job_id: jobId, candidate_id: f.querySelector("#af-cand").value });
    if (error) return toast(error.message);
    closeModal();
    render();
  };
}

function attachJobForm(candId) {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Job
      <select id="aj-job">
        ${S.cache.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("")}
      </select>
    </label>
    <button class="btn btn-primary" id="aj-save">Attach</button>`;
  openModal("Attach to job", f);
  f.querySelector("#aj-save").onclick = async () => {
    const { error } = await sb
      .from("applications")
      .insert({ job_id: f.querySelector("#aj-job").value, candidate_id: candId });
    if (error) return toast(error.message);
    closeModal();
    render();
  };
}

function stageForm(appId) {
  const stages = ["new","screened","shortlisted","interview_scheduled","interviewed","offered","hired","rejected"];
  const app = S.cache.applications.find((a) => a.id === appId);
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Stage
      <select id="sf-stage">${stages.map((s) =>
        `<option value="${s}"${app?.stage === s ? " selected" : ""}>${s.replaceAll("_", " ")}</option>`).join("")}
      </select>
    </label>
    <button class="btn btn-primary" id="sf-save">Update</button>`;
  openModal("Update stage", f);
  f.querySelector("#sf-save").onclick = async () => {
    const { error } = await sb
      .from("applications")
      .update({ stage: f.querySelector("#sf-stage").value, updated_at: new Date().toISOString() })
      .eq("id", appId);
    if (error) return toast(error.message);
    closeModal();
    render();
  };
}

async function runMatch(appId) {
  const { data: { session } } = await sb.auth.getSession();
  const resp = await fetch("/api/match", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ application_id: appId }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Match failed");
  $("#credits-count").textContent = data.credits_remaining;
  return data;
}

function scoreDetail(appId) {
  const app = S.cache.applications.find((a) => a.id === appId);
  const cand = S.cache.candidates.find((c) => c.id === app.candidate_id);
  const job = S.cache.jobs.find((j) => j.id === app.job_id);
  const f = el("div");
  const raw = app.match_raw_response || {};
  f.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
      ${scoreRing(app.match_score)}
      <div><strong>${esc(cand?.name)}</strong><br>
      <span style="color:var(--ink-soft);font-size:12.5px">${esc(job?.title)}</span></div>
    </div>
    ${app.match_summary ? `<p style="margin-bottom:12px">${esc(app.match_summary)}</p>` : ""}
    ${raw.strengths?.length ? `<p style="font-weight:700;font-size:12.5px;margin-bottom:4px">Strengths</p><ul style="margin:0 0 12px 18px">${raw.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    ${raw.gaps?.length ? `<p style="font-weight:700;font-size:12.5px;margin-bottom:4px">Gaps</p><ul style="margin:0 0 12px 18px">${raw.gaps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <button class="btn btn-primary" id="sd-run">${app.match_score == null ? "Run AI match (1 credit)" : "Re-run match (1 credit)"}</button>
    <p id="sd-status" style="margin-top:8px;color:var(--ink-soft);font-size:12.5px"></p>`;
  openModal("Match detail", f);
  f.querySelector("#sd-run").onclick = async (e) => {
    e.target.disabled = true;
    f.querySelector("#sd-status").textContent = "Scoring resume against JD…";
    try {
      await runMatch(appId);
      closeModal();
      toast("Scored ✓");
      render();
    } catch (err) {
      f.querySelector("#sd-status").textContent = err.message;
      e.target.disabled = false;
    }
  };
}

// ---------- Interviews ----------
function interviews(root) {
  const rows = S.cache.applications
    .filter((a) => ["interview_scheduled", "interviewed"].includes(a.stage))
    .map((a) => ({
      app: a,
      cand: S.cache.candidates.find((c) => c.id === a.candidate_id),
      job: S.cache.jobs.find((j) => j.id === a.job_id),
    }))
    .filter((r) => r.cand && r.job);

  const card = el("div", "card");
  if (!rows.length) {
    card.innerHTML = `<div class="empty"><strong>No interviews scheduled</strong>Move a candidate's stage to "interview scheduled" and they'll appear here. Slot booking via WhatsApp links lands in Phase 1.</div>`;
  } else {
    card.innerHTML = `<table class="table">
      <thead><tr><th>Candidate</th><th>Job</th><th>Stage</th><th>Last update</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><strong>${esc(r.cand.name)}</strong></td>
        <td>${esc(r.job.title)}</td>
        <td><span class="stage-badge ${r.app.stage}">${r.app.stage.replaceAll("_", " ")}</span></td>
        <td>${new Date(r.app.updated_at).toLocaleString()}</td>
      </tr>`).join("")}</tbody></table>`;
  }
  root.appendChild(card);
}

// ---------- Chat ----------
function chat(root) {
  const card = el("div", "card");
  card.innerHTML = `
    <div class="card-title">WhatsApp composer</div>
    <p style="color:var(--ink-soft);font-size:13px;margin-bottom:12px">
      Zero-cost outreach via <strong>wa.me</strong> deep links — opens WhatsApp Web with the message pre-filled.
      Built-in threading arrives with the paid Business API in Phase 3.
    </p>
    <div class="form-grid">
      <label>Candidate
        <select id="wa-cand">
          ${S.cache.candidates.filter((c) => c.phone).map((c) =>
            `<option value="${esc(c.phone)}" data-name="${esc(c.name)}">${esc(c.name)} — ${esc(c.phone)}</option>`).join("")}
        </select>
      </label>
      <label>Message
        <textarea id="wa-msg">Hi {name}, thanks for applying! We'd like to move forward with your application. Could you confirm your availability this week for a quick call?</textarea>
      </label>
      <button class="btn btn-primary" id="wa-open">Open in WhatsApp</button>
    </div>`;
  root.appendChild(card);

  const sel = card.querySelector("#wa-cand");
  if (!sel.options.length) {
    card.innerHTML = `<div class="empty"><strong>No candidates with phone numbers</strong>Add a candidate with a phone number (incl. country code) to compose WhatsApp messages.</div>`;
    return;
  }
  card.querySelector("#wa-open").onclick = () => {
    const opt = sel.selectedOptions[0];
    const phone = opt.value.replace(/[^\d]/g, "");
    const msg = card.querySelector("#wa-msg").value.replaceAll("{name}", opt.dataset.name.split(" ")[0]);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };
}

// ---------- Re-score ----------
function rescore(root) {
  const rows = S.cache.applications
    .map((a) => ({
      app: a,
      cand: S.cache.candidates.find((c) => c.id === a.candidate_id),
      job: S.cache.jobs.find((j) => j.id === a.job_id),
    }))
    .filter((r) => r.cand && r.job && r.cand.resume_raw_text && (r.job.jd_raw_text || r.job.description));

  const card = el("div", "card");
  card.innerHTML = `<div class="card-title">Re-run AI matching on stored resumes</div>`;
  if (!rows.length) {
    card.innerHTML += `<div class="empty"><strong>Nothing to re-score</strong>Applications need both resume text and JD text stored.</div>`;
    root.appendChild(card);
    return;
  }
  const table = el("table", "table");
  table.innerHTML = `
    <thead><tr><th>Score</th><th>Candidate</th><th>Job</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${scoreRing(r.app.match_score, true)}</td>
      <td><strong>${esc(r.cand.name)}</strong></td>
      <td>${esc(r.job.title)}</td>
      <td><button class="btn btn-ghost btn-sm" data-app="${r.app.id}">Re-score (1 credit)</button></td>
    </tr>`).join("")}</tbody>`;
  card.appendChild(table);
  root.appendChild(card);
  table.querySelectorAll("button[data-app]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "Scoring…";
      try {
        await runMatch(b.dataset.app);
        toast("Re-scored ✓");
        render();
      } catch (e) {
        toast(e.message);
        b.disabled = false;
        b.textContent = "Re-score (1 credit)";
      }
    })
  );
}

// ---------- Analytics ----------
function analytics(root) {
  const apps = S.cache.applications;
  const scored = apps.filter((a) => a.match_score != null);
  const avg = scored.length
    ? Math.round(scored.reduce((s, a) => s + Number(a.match_score), 0) / scored.length)
    : 0;

  const metrics = el("div", "metric-row");
  const cards = [
    [S.cache.jobs.length, "Open jobs", S.cache.jobs.filter((j) => j.status === "open").length + " open"],
    [S.cache.candidates.length, "Candidates"],
    [scored.length, "Resumes scored"],
    [avg || "—", "Avg match score"],
    [S.org?.credits_balance ?? "—", "Credits left"],
  ];
  cards.forEach(([num, lbl]) => {
    metrics.appendChild(el("div", "metric", `<div class="num">${num}</div><div class="lbl">${lbl}</div>`));
  });
  root.appendChild(metrics);

  const grid = el("div", "two-col");

  // funnel
  const stages = ["new","screened","shortlisted","interview_scheduled","interviewed","offered","hired"];
  const funnel = el("div", "card", `<div class="card-title">Hiring funnel</div>`);
  const maxStage = Math.max(1, ...stages.map((s) => apps.filter((a) => a.stage === s).length));
  stages.forEach((s) => {
    const n = apps.filter((a) => a.stage === s).length;
    funnel.innerHTML += `<div class="bar-row">
      <span class="bar-label">${s.replaceAll("_", " ")}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / maxStage) * 100}%"></div></div>
      <span class="bar-num">${n}</span></div>`;
  });
  grid.appendChild(funnel);

  // score distribution
  const dist = el("div", "card", `<div class="card-title">Score distribution</div>`);
  const buckets = [[0,20],[20,40],[40,60],[60,80],[80,101]];
  const maxB = Math.max(1, ...buckets.map(([lo, hi]) =>
    scored.filter((a) => a.match_score >= lo && a.match_score < hi).length));
  buckets.forEach(([lo, hi]) => {
    const n = scored.filter((a) => a.match_score >= lo && a.match_score < hi).length;
    dist.innerHTML += `<div class="bar-row">
      <span class="bar-label">${lo}–${hi > 100 ? 100 : hi}</span>
      <div class="bar-track"><div class="bar-fill teal" style="width:${(n / maxB) * 100}%"></div></div>
      <span class="bar-num">${n}</span></div>`;
  });
  grid.appendChild(dist);
  root.appendChild(grid);

  // per-job table
  const perJob = el("div", "card", `<div class="card-title">Per-job breakdown</div>`);
  if (!S.cache.jobs.length) {
    perJob.innerHTML += `<div class="empty">No jobs yet.</div>`;
  } else {
    perJob.innerHTML += `<table class="table">
      <thead><tr><th>Job</th><th>Candidates</th><th>Scored</th><th>Avg score</th><th>Shortlisted+</th></tr></thead>
      <tbody>${S.cache.jobs.map((j) => {
        const ja = apps.filter((a) => a.job_id === j.id);
        const js = ja.filter((a) => a.match_score != null);
        const javg = js.length ? Math.round(js.reduce((s, a) => s + Number(a.match_score), 0) / js.length) : "—";
        const adv = ja.filter((a) => ["shortlisted","interview_scheduled","interviewed","offered","hired"].includes(a.stage)).length;
        return `<tr><td><strong>${esc(j.title)}</strong></td><td>${ja.length}</td><td>${js.length}</td><td>${javg}</td><td>${adv}</td></tr>`;
      }).join("")}</tbody></table>`;
  }
  perJob.style.marginTop = "14px";
  root.appendChild(perJob);
}

// go
boot();
