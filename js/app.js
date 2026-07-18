// ATLLANTA frontend — vanilla JS, Supabase (RLS-enforced), Vercel APIs.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.ATLLANTA_CONFIG;
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---------- state ----------
const S = {
  session: null,
  org: null,
  membership: null,
  clients: [],
  clientId: null,
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
  const m = $("#toast-msg");
  m.textContent = msg;
  t.classList.remove("hidden");
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.classList.remove("show"); t.classList.add("hidden"); }, ms);
}

function scoreBar(score) {
  if (score === null || score === undefined) return `<span class="pill pill-new"><span class="dot"></span>unscored</span>`;
  const s = Math.round(score);
  return `<div class="score-col"><div class="sbar"><div class="sbar-fill" style="width:${s}%"></div></div><div class="snum">${s}</div></div>`;
}

function stagePill(stage) {
  const label = (stage || "new").replaceAll("_", " ");
  return `<span class="pill pill-${stage}"><span class="dot"></span>${label}</span>`;
}

function initials(name) {
  const parts = (name || "?").split(" ");
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

const avColors = ["#5C8A72", "#E8963C", "#4A5578", "#D6604A", "#7B6CB5", "#3B7DD8"];
function avColor(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return avColors[Math.abs(h) % avColors.length];
}

function openModal(title, bodyNode, opts) {
  $("#modal-title").textContent = title;
  const body = $("#modal-body");
  body.innerHTML = "";
  body.className = "modal-body" + (opts?.scrollList ? " sc-body" : "");
  body.appendChild(bodyNode);
  $("#modal-backdrop").classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  document.body.classList.remove("modal-open");
}
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
  $("#user-avatar").textContent = (session.user.email || "?")[0].toUpperCase();
  $("#menu-email").textContent = session.user.email;

  const { data: memberships } = await sb
    .from("memberships")
    .select("*")
    .order("created_at");
  S.membership = memberships?.[0] || null;

  if (!S.membership) {
    $("#menu-org").textContent = "No organization";
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
  $("#menu-org").textContent = (S.membership.role || "member").replaceAll("_", " ") + " · " + (org?.name || "—");
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
const SUBS = {
  jobs: "Manage your open roles and upload resumes for each one",
  candidates: "Everyone in your pipeline — filter by job or stage",
  interviews: "Upcoming interviews — all confirmed slots in one place",
  chat: "Candidates who replied — continue the conversation here or on WhatsApp",
  rescore: "Run the AI scoring algorithm again on stored resumes",
  analytics: "Performance metrics across your hiring pipeline",
};
document.querySelectorAll(".nav-item").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    S.view = b.dataset.view;
    render();
  })
);

async function render() {
  $("#view-title").textContent = TITLES[S.view];
  $("#view-sub").textContent = SUBS[S.view] || "";
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
  const tabs = el("div", "cat-tabs");
  const statuses = ["all", "open", "paused", "closed"];
  let filter = "all";
  let expandedId = null;

  function counts(s) {
    return s === "all" ? S.cache.jobs.length : S.cache.jobs.filter((j) => j.status === s).length;
  }

  statuses.forEach((s) => {
    const t = el("button", `cat-tab${s === "all" ? " active" : ""}`,
      `${s.charAt(0).toUpperCase() + s.slice(1)} · ${counts(s)}`);
    t.onclick = () => {
      filter = s;
      tabs.querySelectorAll(".cat-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      draw();
    };
    tabs.appendChild(t);
  });
  bar.appendChild(tabs);
  root.appendChild(bar);

  const grid = el("div", "job-grid");
  root.appendChild(grid);

  function draw() {
    const rows = S.cache.jobs.filter((j) => filter === "all" || j.status === filter);
    const cards = rows.map((j) => {
      const jobApps = S.cache.applications.filter((a) => a.job_id === j.id);
      const appCount = jobApps.length;
      const shortlisted = jobApps.filter((a) =>
        ["shortlisted", "interview_scheduled", "interviewed", "offered", "hired"].includes(a.stage)).length;
      const hired = jobApps.filter((a) => a.stage === "hired").length;
      const isExpanded = expandedId === j.id;
      const jdPreview = (j.jd_raw_text || j.description || "").slice(0, 200);

      let detailHTML = "";
      if (isExpanded) {
        const scored = jobApps.filter((a) => a.match_score != null).sort((a, b) => b.match_score - a.match_score);
        const unscored = jobApps.filter((a) => a.match_score == null);
        const sorted = [...scored, ...unscored];

        const candRows = sorted.map((a) => {
          const c = S.cache.candidates.find((x) => x.id === a.candidate_id);
          const contact = c?.email || c?.phone || "";
          const phone = (c?.phone || "").replace(/[^\d]/g, "");
          const summary = a.match_summary ? `<div class="jc-summary">${esc(a.match_summary)}</div>` : "";
          return `<div class="jc-row">
            <div class="av" style="background:${avColor(c?.name)}">${initials(c?.name)}</div>
            <div class="jc-info jc-info-link" data-act="match-detail" data-app-id="${a.id}">
              <div class="jc-name">${esc(c?.name || "Unknown")}</div>
              <div class="jc-contact">${esc(contact)}</div>
              ${summary}
            </div>
            <div class="jc-score">${scoreBar(a.match_score)}</div>
            <div class="jc-stage">${stagePill(a.stage)}</div>
            <div class="jc-actions">
              ${phone ? `<button class="btn-icon" title="WhatsApp ${esc(c?.name)}" data-act="wa-cand" data-phone="${phone}" data-name="${esc(c?.name)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              </button>` : ""}
              <button class="btn-icon" title="Update stage" data-act="stage-cand" data-app-id="${a.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </button>
            </div>
          </div>`;
        }).join("");

        detailHTML = `
          <div class="job-detail" data-id="${j.id}">
            ${jdPreview ? `<div class="jd-preview">${esc(jdPreview)}${(j.jd_raw_text || "").length > 200 ? "…" : ""}</div>` : ""}
            <div class="jc-header">
              <span>Candidates (${appCount})</span>
              ${scored.length ? `<span class="jc-scored-tag">${scored.length} scored</span>` : ""}
            </div>
            <div class="jc-list">
              ${candRows || `<div class="jc-empty">No candidates yet</div>`}
            </div>
          </div>`;
      }

      return `
        <div class="job-card${isExpanded ? " expanded" : ""}">
          <div class="job-card-head" data-id="${j.id}" data-act="toggle" style="cursor:pointer">
            <div style="flex:1;min-width:0">
              <div class="job-title">${esc(j.title)}</div>
              <div class="job-dept">${esc(j.description || "")}</div>
            </div>
            ${stagePill(j.status)}
            <svg class="expand-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-left:6px;transition:transform .2s;${isExpanded ? "transform:rotate(180deg)" : ""}"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="job-stats">
            <div class="jstat"><div class="n">${appCount}</div><div class="l">In pipeline</div></div>
            <div class="jstat"><div class="n">${shortlisted}</div><div class="l">Shortlisted</div></div>
            <div class="jstat"><div class="n">${hired}</div><div class="l">Hired</div></div>
          </div>
          ${detailHTML}
          <div class="job-actions">
            <button class="btn btn-outline btn-sm" style="flex:1" data-id="${j.id}" data-act="upload">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload resumes
            </button>
            <button class="btn btn-amber btn-sm" style="flex:1" data-id="${j.id}" data-act="screen">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Screen
            </button>
          </div>
        </div>`;
    }).join("");

    grid.innerHTML = cards +
      `<div class="new-job-card" id="new-job-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New role
      </div>`;

    grid.querySelector("#new-job-btn").onclick = jobForm;
    grid.querySelectorAll("[data-act=toggle]").forEach((b) =>
      b.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        expandedId = expandedId === b.dataset.id ? null : b.dataset.id;
        draw();
      })
    );
    grid.querySelectorAll("[data-act=upload]").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); bulkUploadForm(b.dataset.id); })
    );
    grid.querySelectorAll("[data-act=screen]").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); screenJob(b.dataset.id); })
    );
    grid.querySelectorAll("[data-act=wa-cand]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const phone = b.dataset.phone;
        window.open(`https://wa.me/${phone}`, "_blank", "noopener");
        toast("Opening WhatsApp with " + (b.dataset.name || "").split(" ")[0]);
      })
    );
    grid.querySelectorAll("[data-act=stage-cand]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        updateStageForm(b.dataset.appId);
      })
    );
    grid.querySelectorAll("[data-act=match-detail]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        scoreDetail(b.dataset.appId);
      })
    );
  }
  draw();
}

function jobForm() {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Job title <input id="jf-title" class="input" placeholder="e.g. Senior Backend Engineer" /></label>
    <label>Short description <input id="jf-desc" class="input" placeholder="One line for the list view" /></label>
    <label>Job description (paste full JD text) <textarea id="jf-jd" class="input" style="min-height:120px" placeholder="Paste the complete JD here — this is what resumes get scored against."></textarea></label>
    <button class="btn btn-amber" id="jf-save">Create job</button>`;
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

  const searchBox = el("div", "search-box");
  searchBox.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" placeholder="Search name or phone…" id="cand-search" />`;
  bar.appendChild(searchBox);

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
  const bulkBtn = el("button", "btn btn-outline", "Bulk upload");
  bulkBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Bulk upload`;
  bulkBtn.onclick = () => bulkUploadForm(null);
  bar.appendChild(bulkBtn);
  const addBtn = el("button", "btn btn-amber", "+ Add candidate");
  addBtn.onclick = () => candidateForm();
  bar.appendChild(addBtn);
  root.appendChild(bar);

  const tableWrap = el("div", "cand-table");
  tableWrap.innerHTML = `<div class="cand-table-head"><div>Candidate</div><div>Job</div><div>Match score</div><div>Stage</div><div>Actions</div></div>`;
  const listEl = el("div", "", "");
  listEl.id = "cand-list";
  tableWrap.appendChild(listEl);
  root.appendChild(tableWrap);

  const searchIn = bar.querySelector("#cand-search");
  searchIn.addEventListener("input", draw);

  function draw() {
    const q = searchIn.value.toLowerCase();
    let rows = S.cache.applications
      .filter((a) => stageFilter === "all" || a.stage === stageFilter)
      .map((a) => ({
        app: a,
        cand: S.cache.candidates.find((c) => c.id === a.candidate_id),
        job: S.cache.jobs.find((j) => j.id === a.job_id),
      }))
      .filter((r) => r.cand && r.job);

    const appliedIds = new Set(S.cache.applications.map((a) => a.candidate_id));
    const unattached = stageFilter === "all"
      ? S.cache.candidates.filter((c) => !appliedIds.has(c.id))
      : [];

    if (q) {
      rows = rows.filter((r) =>
        r.cand.name.toLowerCase().includes(q) ||
        (r.cand.phone || "").includes(q) ||
        (r.cand.email || "").toLowerCase().includes(q)
      );
    }

    if (!rows.length && !unattached.length) {
      listEl.innerHTML = `<div class="empty"><strong>No candidates yet</strong>Add a candidate with their resume to start scoring.</div>`;
      return;
    }

    listEl.innerHTML = rows.map((r) => `
      <div class="cand-row">
        <div class="who cand-link" data-cand="${r.cand.id}" data-act="detail">
          <div class="av" style="background:${avColor(r.cand.name)}">${initials(r.cand.name)}</div>
          <div><div class="cname">${esc(r.cand.name)}</div><div class="csub">${esc(r.cand.email || r.cand.phone || "")}</div></div>
        </div>
        <div style="font-size:12.5px;color:var(--ink2)">${esc(r.job.title)}</div>
        <div>${scoreBar(r.app.match_score)}</div>
        <div>${stagePill(r.app.stage)}</div>
        <div class="row-actions">
          <button class="icon-btn" title="${r.app.match_score == null ? 'Score' : 'View score'}" data-app="${r.app.id}" data-act="score">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </button>
          <button class="icon-btn" title="Update stage" data-app="${r.app.id}" data-act="stage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </button>
          ${r.cand.phone ? `<button class="icon-btn wa" title="WhatsApp" data-phone="${esc(r.cand.phone)}" data-name="${esc(r.cand.name)}" data-act="wa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </button>` : ""}
        </div>
      </div>`).join("") +
      unattached.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q)).map((c) => `
      <div class="cand-row">
        <div class="who cand-link" data-cand="${c.id}" data-act="detail">
          <div class="av" style="background:${avColor(c.name)}">${initials(c.name)}</div>
          <div><div class="cname">${esc(c.name)}</div><div class="csub">${esc(c.email || c.phone || "")}</div></div>
        </div>
        <div style="font-size:12.5px;color:var(--grey)">— no job —</div>
        <div><span class="pill pill-new"><span class="dot"></span>unscored</span></div>
        <div><span class="pill pill-new"><span class="dot"></span>unattached</span></div>
        <div class="row-actions">
          <button class="icon-btn" title="Attach to job" data-cand="${c.id}" data-act="attachjob">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>`).join("");

    listEl.querySelectorAll("[data-act=score]").forEach((b) =>
      b.addEventListener("click", () => scoreDetail(b.dataset.app))
    );
    listEl.querySelectorAll("[data-act=stage]").forEach((b) =>
      b.addEventListener("click", () => stageForm(b.dataset.app))
    );
    listEl.querySelectorAll("[data-act=wa]").forEach((b) =>
      b.addEventListener("click", () => {
        const phone = b.dataset.phone.replace(/[^\d]/g, "");
        window.open(`https://wa.me/${phone}`, "_blank", "noopener");
        toast("Opening WhatsApp with " + b.dataset.name.split(" ")[0]);
      })
    );
    listEl.querySelectorAll("[data-act=attachjob]").forEach((b) =>
      b.addEventListener("click", () => attachJobForm(b.dataset.cand))
    );
    listEl.querySelectorAll("[data-act=detail]").forEach((b) =>
      b.addEventListener("click", () => candidateDetail(b.dataset.cand))
    );
  }
  draw();
}

function candidateDetail(candId) {
  const cand = S.cache.candidates.find((c) => c.id === candId);
  if (!cand) return;

  const apps = S.cache.applications.filter((a) => a.candidate_id === candId);
  const f = el("div", "cd-modal");

  const contactParts = [];
  if (cand.email) contactParts.push(`<a href="mailto:${esc(cand.email)}" class="cd-contact-link">${esc(cand.email)}</a>`);
  if (cand.phone) contactParts.push(`<a href="https://wa.me/${cand.phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener" class="cd-contact-link">${esc(cand.phone)}</a>`);

  const jobRows = apps.map((a) => {
    const job = S.cache.jobs.find((j) => j.id === a.job_id);
    return `<div class="cd-job-row">
      <div class="cd-job-title">${esc(job?.title || "Unknown")}</div>
      <div>${scoreBar(a.match_score)}</div>
      <div>${stagePill(a.stage)}</div>
    </div>`;
  }).join("");

  const resumePreview = cand.resume_raw_text || "";

  f.innerHTML = `
    <div class="cd-header">
      <div class="av" style="background:${avColor(cand.name)};width:52px;height:52px;font-size:18px;border-radius:14px">${initials(cand.name)}</div>
      <div class="cd-header-info">
        <div class="cd-name">${esc(cand.name)}</div>
        <div class="cd-contacts">${contactParts.join('<span class="cd-sep">·</span>') || '<span class="cd-no-contact">No contact info</span>'}</div>
      </div>
    </div>
    ${apps.length ? `<div class="cd-section"><div class="cd-section-title">Applications</div><div class="cd-jobs">${jobRows}</div></div>` : '<div class="cd-section"><div class="cd-no-contact">Not attached to any job</div></div>'}
    ${resumePreview ? `<div class="cd-section"><div class="cd-section-title">Resume</div><pre class="cd-resume">${esc(resumePreview)}</pre></div>` : ""}
    <div class="cd-meta">Added ${new Date(cand.created_at).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}${cand.source ? " · Source: " + esc(cand.source) : ""}</div>`;

  openModal("Candidate profile", f);
}

async function findExistingCandidate(email, phone) {
  if (email) {
    const { data } = await sb.from("candidates").select("*").eq("client_id", S.clientId).eq("email", email).limit(1).maybeSingle();
    if (data) return data;
  }
  if (phone) {
    const normalized = phone.replace(/[\s\-()]/g, "");
    const { data } = await sb.from("candidates").select("*").eq("client_id", S.clientId).eq("phone", phone).limit(1).maybeSingle();
    if (data) return data;
    if (normalized !== phone) {
      const { data: d2 } = await sb.from("candidates").select("*").eq("client_id", S.clientId).eq("phone", normalized).limit(1).maybeSingle();
      if (d2) return d2;
    }
  }
  return null;
}

function candidateForm(preselectedJobId) {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <div class="file-drop" id="cf-drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <input type="file" id="cf-file" accept=".pdf,.docx,.doc" hidden />
      <span id="cf-drop-label">Click or drag a resume file here</span>
      <span style="font-size:11px;color:var(--grey)">PDF, DOCX — max 3 MB</span>
    </div>
    <div id="cf-parse-status" class="parse-status hidden"></div>
    <div id="cf-result" class="hidden"></div>`;
  openModal("Add candidate", f);

  const drop = f.querySelector("#cf-drop");
  const fileInput = f.querySelector("#cf-file");
  const dropLabel = f.querySelector("#cf-drop-label");
  const parseStatus = f.querySelector("#cf-parse-status");
  const resultDiv = f.querySelector("#cf-result");

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "docx", "doc"].includes(ext)) return toast("Only PDF and DOCX files are supported");
    if (file.size > 3 * 1024 * 1024) return toast("File too large (max 3 MB)");

    dropLabel.textContent = file.name;
    drop.classList.add("has-file");
    parseStatus.textContent = "Extracting text from resume…";
    parseStatus.classList.remove("hidden", "error");
    resultDiv.classList.add("hidden");

    try {
      const base64 = await readFileAsBase64(file);
      const { data: { session } } = await sb.auth.getSession();
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };

      const parseResp = await fetch("/api/parse-resume", { method: "POST", headers, body: JSON.stringify({ filename: file.name, data: base64 }) });
      const parseResult = await parseResp.json();
      if (!parseResp.ok) throw new Error(parseResult.error || "Parse failed");

      parseStatus.textContent = "Extracting candidate details with AI…";

      const extResp = await fetch("/api/extract-candidate", { method: "POST", headers, body: JSON.stringify({ resume_text: parseResult.text }) });
      const extResult = await extResp.json();
      if (!extResp.ok) throw new Error(extResult.error || "Extraction failed");

      const candName = extResult.name || file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
      parseStatus.textContent = "Saving candidate profile…";

      let cand = null;
      let isUpdate = false;
      const existing = await findExistingCandidate(extResult.email, extResult.phone);
      if (existing) {
        const updates = { resume_raw_text: parseResult.text, name: candName };
        if (extResult.email && !existing.email) updates.email = extResult.email;
        if (extResult.phone && !existing.phone) updates.phone = extResult.phone;
        const { data, error } = await sb.from("candidates").update(updates).eq("id", existing.id).select().single();
        if (error) throw new Error(error.message);
        cand = data;
        isUpdate = true;
      } else {
        const { data, error } = await sb.from("candidates").insert({
          client_id: S.clientId,
          name: candName,
          email: extResult.email || null,
          phone: extResult.phone || null,
          resume_raw_text: parseResult.text,
        }).select().single();
        if (error) throw new Error(error.message);
        cand = data;
      }

      if (preselectedJobId) {
        const { data: existingApp } = await sb.from("applications").select("id").eq("job_id", preselectedJobId).eq("candidate_id", cand.id).maybeSingle();
        if (!existingApp) {
          await sb.from("applications").insert({ job_id: preselectedJobId, candidate_id: cand.id });
        }
      }

      parseStatus.classList.add("hidden");
      resultDiv.classList.remove("hidden");
      resultDiv.innerHTML = `
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
          <div class="av" style="background:${avColor(candName)};width:44px;height:44px;font-size:16px;border-radius:12px">${initials(candName)}</div>
          <div>
            <strong style="font-size:15px">${esc(candName)}</strong><br>
            <span style="color:var(--grey);font-size:12.5px">${esc(extResult.email || "")} ${extResult.phone ? "· " + esc(extResult.phone) : ""}</span>
          </div>
        </div>
        ${extResult.summary ? `<p style="font-size:13px;color:var(--ink2);margin-bottom:12px">${esc(extResult.summary)}</p>` : ""}
        <p style="font-size:12.5px;color:var(--green);font-weight:600;margin-bottom:12px">${isUpdate ? "Resume updated for existing candidate" : "Profile created successfully"}</p>
        <div style="display:flex;gap:8px">
          <button class="btn btn-amber" id="cf-another">Upload another</button>
          <button class="btn btn-dark" id="cf-done">Done</button>
        </div>`;
      resultDiv.querySelector("#cf-another").onclick = () => {
        resultDiv.classList.add("hidden");
        drop.classList.remove("has-file");
        dropLabel.textContent = "Click or drag a resume file here";
        fileInput.value = "";
      };
      resultDiv.querySelector("#cf-done").onclick = () => { closeModal(); render(); };
      toast(isUpdate ? "Resume updated — " + candName : "Candidate added — " + candName);
    } catch (err) {
      parseStatus.textContent = err.message;
      parseStatus.classList.add("error");
    }
  }
}

// ---------- Bulk upload ----------
function bulkUploadForm(preselectedJobId) {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Attach all to job (optional)
      <select id="bu-job" class="input">
        <option value="">— none (add to pool) —</option>
        ${S.cache.jobs.map((j) => `<option value="${j.id}"${j.id === preselectedJobId ? " selected" : ""}>${esc(j.title)}</option>`).join("")}
      </select>
    </label>
    <label>Drop resume files (PDF / DOCX — up to 100)
      <div class="file-drop bulk-drop" id="bu-drop">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <input type="file" id="bu-files" accept=".pdf,.docx,.doc" multiple hidden />
        <span id="bu-drop-label">Click or drag files here</span>
        <span style="font-size:11px;color:var(--grey)">PDF, DOCX — max 3 MB each, up to 100 files</span>
      </div>
    </label>
    <div id="bu-file-list" style="font-size:12.5px;color:var(--grey)"></div>
    <button class="btn btn-amber" id="bu-start" disabled>Process resumes</button>
    <div id="bu-progress" class="hidden">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px" id="bu-prog-label">Processing…</div>
      <div style="height:8px;background:var(--line2);border-radius:6px;overflow:hidden;margin-bottom:12px">
        <div id="bu-prog-fill" style="height:100%;background:linear-gradient(90deg,var(--amber),var(--green));border-radius:6px;width:0%;transition:width .3s ease"></div>
      </div>
      <div id="bu-prog-log" style="max-height:200px;overflow-y:auto;font-size:12px;display:flex;flex-direction:column;gap:4px"></div>
    </div>`;
  openModal("Bulk resume upload", f);

  let files = [];
  const drop = f.querySelector("#bu-drop");
  const fileInput = f.querySelector("#bu-files");
  const dropLabel = f.querySelector("#bu-drop-label");
  const fileList = f.querySelector("#bu-file-list");
  const startBtn = f.querySelector("#bu-start");

  function setFiles(fl) {
    const valid = Array.from(fl).filter((f) => {
      const ext = f.name.split(".").pop().toLowerCase();
      return ["pdf", "docx", "doc"].includes(ext) && f.size <= 3 * 1024 * 1024;
    }).slice(0, 100);
    files = valid;
    dropLabel.textContent = `${files.length} file${files.length !== 1 ? "s" : ""} selected`;
    drop.classList.toggle("has-file", files.length > 0);
    fileList.innerHTML = files.map((f) => esc(f.name)).join(", ");
    startBtn.disabled = files.length === 0;
    if (fl.length > valid.length) {
      toast(`${fl.length - valid.length} file(s) skipped (wrong type or >3 MB)`);
    }
  }

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("dragover");
    if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) setFiles(fileInput.files); });

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    const jobId = f.querySelector("#bu-job").value || null;
    const progress = f.querySelector("#bu-progress");
    const progFill = f.querySelector("#bu-prog-fill");
    const progLabel = f.querySelector("#bu-prog-label");
    const progLog = f.querySelector("#bu-prog-log");
    progress.classList.remove("hidden");

    const { data: { session } } = await sb.auth.getSession();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };

    let done = 0;
    let success = 0;

    for (const file of files) {
      done++;
      progFill.style.width = `${Math.round((done / files.length) * 100)}%`;
      progLabel.textContent = `Processing ${done} of ${files.length}…`;

      const logEntry = el("div", "", `<span style="color:var(--amber)">⏳</span> ${esc(file.name)}`);
      progLog.appendChild(logEntry);
      progLog.scrollTop = progLog.scrollHeight;

      try {
        const base64 = await readFileAsBase64(file);

        const parseResp = await fetch("/api/parse-resume", {
          method: "POST", headers,
          body: JSON.stringify({ filename: file.name, data: base64 }),
        });
        const parseResult = await parseResp.json();
        if (!parseResp.ok) throw new Error(parseResult.error || "Parse failed");

        const extractResp = await fetch("/api/extract-candidate", {
          method: "POST", headers,
          body: JSON.stringify({ resume_text: parseResult.text }),
        });
        const extractResult = await extractResp.json();
        if (!extractResp.ok) throw new Error(extractResult.error || "Extract failed");

        const candName = extractResult.name || file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
        let cand = null;
        let isUpdate = false;
        const existing = await findExistingCandidate(extractResult.email, extractResult.phone);
        if (existing) {
          const updates = { resume_raw_text: parseResult.text, name: candName };
          if (extractResult.email && !existing.email) updates.email = extractResult.email;
          if (extractResult.phone && !existing.phone) updates.phone = extractResult.phone;
          const { data, error } = await sb.from("candidates").update(updates).eq("id", existing.id).select().single();
          if (error) throw new Error(error.message);
          cand = data;
          isUpdate = true;
        } else {
          const { data, error } = await sb.from("candidates").insert({
            client_id: S.clientId,
            name: candName,
            email: extractResult.email || null,
            phone: extractResult.phone || null,
            resume_raw_text: parseResult.text,
          }).select().single();
          if (error) throw new Error(error.message);
          cand = data;
        }

        if (jobId) {
          const { data: existingApp } = await sb.from("applications").select("id").eq("job_id", jobId).eq("candidate_id", cand.id).maybeSingle();
          if (!existingApp) {
            await sb.from("applications").insert({ job_id: jobId, candidate_id: cand.id });
          }
        }

        logEntry.innerHTML = `<span style="color:var(--green)">&#10003;</span> ${esc(candName)}${isUpdate ? " (updated)" : ""} — ${esc(extractResult.email || "")}`;
        success++;
      } catch (err) {
        logEntry.innerHTML = `<span style="color:var(--red)">&#10007;</span> ${esc(file.name)} — ${esc(err.message)}`;
      }
    }

    progLabel.textContent = `Done — ${success} of ${files.length} resumes processed`;
    progFill.style.width = "100%";
    toast(`${success} candidate${success !== 1 ? "s" : ""} added`);

    const doneBtn = el("button", "btn btn-dark", "Close");
    doneBtn.style.marginTop = "12px";
    doneBtn.onclick = () => { closeModal(); render(); };
    progress.appendChild(doneBtn);
  };
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ---------- Screen job ----------
async function screenJob(jobId) {
  const job = S.cache.jobs.find((j) => j.id === jobId);
  if (!job) return;

  const jobApps = S.cache.applications.filter((a) => a.job_id === jobId);
  const unscoredCount = jobApps.filter((a) => a.match_score == null).length;
  const attachedCandIds = new Set(jobApps.map((a) => a.candidate_id));
  const poolCands = S.cache.candidates
    .filter((c) => !attachedCandIds.has(c.id) && c.resume_raw_text)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const creditsBalance = S.org?.credits_balance ?? 0;

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  function renderItem(id, cls, name, contact, dateStr, scoreHtml, created, checked) {
    const sub = [contact, dateStr].filter(Boolean).join(" · ");
    return `<label class="sc-item">
      <input type="checkbox" value="${id}" class="${cls}" data-created="${created}" ${checked ? "checked" : ""} />
      <div class="av" style="background:${avColor(name)}">${initials(name)}</div>
      <div class="sc-item-info"><div class="sc-item-name">${esc(name)}</div><div class="sc-item-sub">${esc(sub)}</div></div>
      ${scoreHtml ? `<div class="sc-item-score">${scoreHtml}</div>` : "<div></div>"}
    </label>`;
  }

  const f = el("div", "form-grid");
  f.innerHTML = `
    <div class="sc-filters">
      <label>From <input type="date" id="sc-from" class="input" value="${weekAgo}" /></label>
      <label>To <input type="date" id="sc-to" class="input" value="${today}" /></label>
      <button class="btn btn-amber btn-sm" id="sc-apply-dates" style="white-space:nowrap">Apply</button>
    </div>

    <div class="sc-method">
      <span style="font-size:12px;font-weight:600;color:var(--grey)">Method</span>
      <div class="sc-toggle">
        <button class="sc-toggle-btn active" data-method="ai">AI</button>
        <button class="sc-toggle-btn" data-method="python">Basic</button>
      </div>
      <div class="sc-credit-bar" id="sc-credit-bar">
        <div class="sc-credit-track"><div class="sc-credit-fill" id="sc-credit-fill"></div></div>
        <span class="sc-credit-label" id="sc-credit-label">0 / ${creditsBalance}</span>
      </div>
    </div>

    ${jobApps.length ? `
      <div class="sc-toolbar">
        <strong>Candidates (${jobApps.length})</strong>
        <input type="text" id="sc-search" class="input" placeholder="Search…" style="flex:1;min-width:80px;padding:4px 8px;font-size:12px" />
        <button class="btn btn-outline btn-sm sc-tbtn" id="sc-sel-unscored">Unscored</button>
        <button class="btn btn-outline btn-sm sc-tbtn" id="sc-sel-all">All</button>
        <button class="btn btn-outline btn-sm sc-tbtn" id="sc-sel-none">Clear</button>
      </div>
      <div class="sc-list" id="sc-cand-list">
        ${jobApps.map((a) => {
          const c = S.cache.candidates.find((x) => x.id === a.candidate_id);
          const added = c?.created_at ? new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
          const contact = c?.email || c?.phone || "";
          return renderItem(a.id, "sc-check", c?.name || "Unknown", contact, added, scoreBar(a.match_score), c?.created_at || "", a.match_score == null);
        }).join("")}
      </div>
    ` : `<p style="color:var(--grey);font-size:13px">No candidates attached. Upload resumes or add from pool below.</p>`}

    ${poolCands.length ? `
      <div class="sc-toolbar" style="border-top:1px solid var(--line2);padding-top:10px;margin-top:4px">
        <strong>From pool (${poolCands.length})</strong>
        <input type="text" id="sc-pool-search" class="input" placeholder="Search…" style="flex:1;min-width:80px;padding:4px 8px;font-size:12px" />
        <button class="btn btn-outline btn-sm sc-tbtn" id="sc-pool-all">Select all</button>
      </div>
      <div class="sc-list" id="sc-pool-list">
        ${poolCands.slice(0, 200).map((c) => {
          const dateStr = new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
          return renderItem(c.id, "sc-pool-check", c.name, c.email || c.phone || "", dateStr, "", c.created_at || "", false);
        }).join("")}
      </div>
    ` : ""}

    <div class="sc-actions">
      <button class="btn btn-outline" id="sc-upload" style="flex:1">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Upload resumes
      </button>
      <button class="btn btn-amber" id="sc-start" style="flex:1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Screen selected (<span id="sc-start-count">0</span>)
      </button>
    </div>
    <div id="sc-progress" class="hidden">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px" id="sc-label">Screening…</div>
      <div style="height:8px;background:var(--line2);border-radius:6px;overflow:hidden;margin-bottom:12px">
        <div id="sc-fill" style="height:100%;background:linear-gradient(90deg,var(--amber),var(--green));border-radius:6px;width:0%;transition:width .3s ease"></div>
      </div>
      <div id="sc-log" style="max-height:180px;overflow-y:auto;font-size:12px;display:flex;flex-direction:column;gap:4px"></div>
    </div>`;
  openModal("Screen — " + job.title, f, { scrollList: true });

  let screenMethod = "ai";

  function updateCounts() {
    const count = f.querySelectorAll(".sc-check:checked, .sc-pool-check:checked").length;
    f.querySelector("#sc-start-count").textContent = count;
    const bar = f.querySelector("#sc-credit-bar");
    if (screenMethod === "ai") {
      bar.style.display = "";
      const cost = count;
      const pct = creditsBalance > 0 ? Math.min(100, (cost / creditsBalance) * 100) : (cost > 0 ? 100 : 0);
      f.querySelector("#sc-credit-fill").style.width = pct + "%";
      f.querySelector("#sc-credit-fill").style.background = pct > 80 ? "var(--red)" : "var(--amber)";
      f.querySelector("#sc-credit-label").textContent = cost + " / " + creditsBalance;
    } else {
      bar.style.display = "none";
    }
  }
  updateCounts();

  f.addEventListener("change", (e) => {
    if (e.target.classList.contains("sc-check") || e.target.classList.contains("sc-pool-check")) updateCounts();
  });

  f.querySelectorAll(".sc-toggle-btn").forEach((btn) => {
    btn.onclick = () => {
      f.querySelectorAll(".sc-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      screenMethod = btn.dataset.method;
      updateCounts();
    };
  });

  const searchInput = f.querySelector("#sc-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase();
      f.querySelectorAll("#sc-cand-list .sc-item").forEach((item) => {
        const name = item.querySelector(".sc-item-name")?.textContent?.toLowerCase() || "";
        const sub = item.querySelector(".sc-item-sub")?.textContent?.toLowerCase() || "";
        item.style.display = (!q || name.includes(q) || sub.includes(q)) ? "" : "none";
      });
    });
  }

  const poolSearch = f.querySelector("#sc-pool-search");
  if (poolSearch) {
    poolSearch.addEventListener("input", () => {
      const q = poolSearch.value.toLowerCase();
      f.querySelectorAll("#sc-pool-list .sc-item").forEach((item) => {
        const name = item.querySelector(".sc-item-name")?.textContent?.toLowerCase() || "";
        const sub = item.querySelector(".sc-item-sub")?.textContent?.toLowerCase() || "";
        item.style.display = (!q || name.includes(q) || sub.includes(q)) ? "" : "none";
      });
    });
  }

  f.querySelector("#sc-apply-dates").onclick = () => {
    const from = f.querySelector("#sc-from").value;
    const to = f.querySelector("#sc-to").value;
    if (!from || !to) return toast("Select both dates");
    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T23:59:59");
    f.querySelectorAll(".sc-check, .sc-pool-check").forEach((cb) => {
      if (cb.closest(".sc-item").style.display === "none") return;
      const created = cb.dataset.created ? new Date(cb.dataset.created) : null;
      cb.checked = created ? created >= fromDate && created <= toDate : false;
    });
    updateCounts();
  };

  const candList = f.querySelector("#sc-cand-list");
  if (candList) {
    f.querySelector("#sc-sel-unscored").onclick = () => {
      candList.querySelectorAll(".sc-check").forEach((cb) => {
        const app = jobApps.find((a) => a.id === cb.value);
        cb.checked = app?.match_score == null;
      });
      updateCounts();
    };
    f.querySelector("#sc-sel-all").onclick = () => { candList.querySelectorAll(".sc-check").forEach((cb) => { cb.checked = true; }); updateCounts(); };
    f.querySelector("#sc-sel-none").onclick = () => { candList.querySelectorAll(".sc-check").forEach((cb) => { cb.checked = false; }); updateCounts(); };
  }

  const poolAllBtn = f.querySelector("#sc-pool-all");
  if (poolAllBtn) {
    poolAllBtn.onclick = () => { f.querySelectorAll(".sc-pool-check").forEach((cb) => { cb.checked = true; }); updateCounts(); };
  }

  f.querySelector("#sc-upload").onclick = () => { closeModal(); bulkUploadForm(jobId); };

  f.querySelector("#sc-start").onclick = async () => {
    const selectedAppIds = Array.from(f.querySelectorAll(".sc-check:checked")).map((cb) => cb.value);
    const selectedPoolIds = Array.from(f.querySelectorAll(".sc-pool-check:checked")).map((cb) => cb.value);
    if (!selectedAppIds.length && !selectedPoolIds.length) return toast("Select at least one candidate");

    const startBtn = f.querySelector("#sc-start");
    startBtn.disabled = true;
    startBtn.textContent = "Screening…";

    const progress = f.querySelector("#sc-progress");
    const fill = f.querySelector("#sc-fill");
    const label = f.querySelector("#sc-label");
    const log = f.querySelector("#sc-log");
    progress.classList.remove("hidden");
    fill.style.width = "10%";

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Session expired — please log in again");
      }
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };

      if (selectedPoolIds.length) {
        label.textContent = `Adding ${selectedPoolIds.length} from pool…`;
        for (const candId of selectedPoolIds) {
          const { data: app, error } = await sb.from("applications").insert({ job_id: jobId, candidate_id: candId }).select().single();
          if (!error && app) selectedAppIds.push(app.id);
        }
      }

      label.textContent = `Scoring ${selectedAppIds.length} candidate${selectedAppIds.length !== 1 ? "s" : ""}…`;
      fill.style.width = "30%";

      const resp = await fetch("/api/screen-job", {
        method: "POST", headers,
        body: JSON.stringify({ job_id: jobId, mode: "all", application_ids: selectedAppIds, method: screenMethod }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Screening failed");

      fill.style.width = "100%";
      const scored = data.results.filter((r) => r.score != null).length;
      label.textContent = `Done — ${scored} scored, ${data.credits_used} credit${data.credits_used !== 1 ? "s" : ""} used`;
      if (data.credits_remaining != null) $("#credits-count").textContent = data.credits_remaining;

      data.results.forEach((r) => {
        const entry = el("div");
        entry.innerHTML = r.score != null
          ? `<span style="color:var(--green)">&#10003;</span> ${esc(r.candidate_name)} — score: <strong>${r.score}</strong>`
          : `<span style="color:var(--red)">&#10007;</span> ${esc(r.candidate_name)} — ${esc(r.error || "skipped")}`;
        log.appendChild(entry);
      });
      if (!data.results.length) log.innerHTML = `<div style="color:var(--grey)">No candidates to screen.</div>`;
      toast(`Screening complete — ${data.credits_used} credit${data.credits_used !== 1 ? "s" : ""} used`);
    } catch (err) {
      fill.style.width = "100%";
      fill.style.background = "var(--red)";
      label.textContent = "Screening failed";
      log.innerHTML = `<div style="color:var(--red)">${esc(err.message)}</div>`;
      toast(err.message);
    }

    const doneBtn = el("button", "btn btn-dark", "Close");
    doneBtn.style.marginTop = "12px";
    doneBtn.onclick = () => { closeModal(); render(); };
    progress.appendChild(doneBtn);
  };
}

function attachCandidateForm(jobId) {
  const f = el("div", "form-grid");
  f.innerHTML = `
    <label>Candidate
      <select id="af-cand" class="input">
        ${S.cache.candidates.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
      </select>
    </label>
    <button class="btn btn-amber" id="af-save">Attach</button>`;
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
      <select id="aj-job" class="input">
        ${S.cache.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("")}
      </select>
    </label>
    <button class="btn btn-amber" id="aj-save">Attach</button>`;
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
      <select id="sf-stage" class="input">${stages.map((s) =>
        `<option value="${s}"${app?.stage === s ? " selected" : ""}>${s.replaceAll("_", " ")}</option>`).join("")}
      </select>
    </label>
    <button class="btn btn-amber" id="sf-save">Update</button>`;
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
  const f = el("div", "sd-modal");
  const raw = app.match_raw_response || {};
  const score = app.match_score;

  const scoreRing = score != null
    ? `<div class="sd-ring" style="--score:${score}"><span class="sd-ring-num">${Math.round(score)}</span></div>`
    : "";

  f.innerHTML = `
    <div class="sd-header">
      <div class="av" style="background:${avColor(cand?.name)};width:48px;height:48px;font-size:17px;border-radius:13px">${initials(cand?.name)}</div>
      <div class="sd-header-info">
        <div class="sd-cand-name">${esc(cand?.name)}</div>
        <div class="sd-job-title">${esc(job?.title)}</div>
        ${cand?.email ? `<div class="sd-contact">${esc(cand.email)}${cand.phone ? " · " + esc(cand.phone) : ""}</div>` : ""}
      </div>
      ${scoreRing}
    </div>
    ${app.match_summary ? `<div class="sd-section"><div class="sd-section-title">Summary</div><p class="sd-summary">${esc(app.match_summary)}</p></div>` : ""}
    ${raw.strengths?.length ? `<div class="sd-section"><div class="sd-section-title sd-green">Strengths</div><ul class="sd-list sd-list-green">${raw.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
    ${raw.gaps?.length ? `<div class="sd-section"><div class="sd-section-title sd-red">Gaps</div><ul class="sd-list sd-list-red">${raw.gaps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
    ${score == null ? '<div class="sd-section"><p class="sd-no-score">Not scored yet — run a match to see the full analysis.</p></div>' : ""}
    <div class="sd-actions">
      <button class="btn btn-amber" id="sd-run">${score == null ? "Run AI match (1 credit)" : "Re-run match (1 credit)"}</button>
      ${cand?.phone ? `<button class="btn btn-outline" id="sd-wa">WhatsApp</button>` : ""}
    </div>
    <p id="sd-status" style="margin-top:8px;color:var(--grey);font-size:12.5px"></p>`;
  openModal("Match detail", f);
  if (cand?.phone) {
    f.querySelector("#sd-wa").onclick = () => {
      window.open(`https://wa.me/${cand.phone.replace(/[^\d]/g, "")}`, "_blank", "noopener");
      toast("Opening WhatsApp with " + cand.name.split(" ")[0]);
    };
  }
  f.querySelector("#sd-run").onclick = async (e) => {
    e.target.disabled = true;
    f.querySelector("#sd-status").textContent = "Scoring resume against JD…";
    try {
      await runMatch(appId);
      closeModal();
      toast("Scored");
      render();
    } catch (err) {
      f.querySelector("#sd-status").textContent = err.message;
      e.target.disabled = false;
    }
  };
}

// ---------- Manage interview slots (per candidate) ----------
async function manageSlots(appId) {
  const app = S.cache.applications.find((a) => a.id === appId);
  if (!app) return;
  const cand = S.cache.candidates.find((c) => c.id === app.candidate_id);
  const job = S.cache.jobs.find((j) => j.id === app.job_id);
  if (!cand || !job) return;

  const f = el("div", "slots-modal");
  f.innerHTML = `<div class="slots-loading">Loading slots…</div>`;
  openModal(`Slots for ${cand.name} — ${job.title}`, f, { scrollList: true });

  const { data: slots } = await sb
    .from("interview_slots")
    .select("*")
    .eq("application_id", appId)
    .order("slot_start");

  function renderSlotList() {
    const future = (slots || []).filter((s) => new Date(s.slot_start) > new Date());
    const past = (slots || []).filter((s) => new Date(s.slot_start) <= new Date());

    const linkActive = app.schedule_expires_at && new Date(app.schedule_expires_at) > new Date();
    const linkExpired = app.schedule_expires_at && new Date(app.schedule_expires_at) <= new Date();
    let linkStatus = "";
    if (linkActive) {
      const remain = new Date(app.schedule_expires_at) - Date.now();
      const hrs = Math.floor(remain / 3600000);
      const mins = Math.floor((remain % 3600000) / 60000);
      linkStatus = `<div class="slot-link-status slot-link-active">Link active — expires in ${hrs}h ${mins}m</div>`;
    } else if (linkExpired) {
      linkStatus = `<div class="slot-link-status slot-link-expired">Link expired — send a new invite to generate a fresh link</div>`;
    }

    f.innerHTML = `
      ${linkStatus}
      <div class="slot-add-form">
        <div class="slot-add-row">
          <label class="slot-field">
            <span>Date</span>
            <input type="date" id="sl-date" class="input" min="${new Date().toISOString().slice(0,10)}">
          </label>
          <label class="slot-field">
            <span>Start</span>
            <input type="time" id="sl-start" class="input" value="10:00">
          </label>
          <label class="slot-field">
            <span>End</span>
            <input type="time" id="sl-end" class="input" value="10:30">
          </label>
          <button class="btn btn-amber btn-sm" id="sl-add">Add slot</button>
        </div>
        <div class="slot-quick-row">
          <span class="slot-quick-label">Quick add:</span>
          <button class="btn btn-outline btn-sm" data-quick="30">+30 min slots</button>
          <button class="btn btn-outline btn-sm" data-quick="60">+1 hr slots</button>
        </div>
      </div>
      <div class="slot-list">
        ${!future.length ? `<div class="empty" style="padding:16px 0">No upcoming slots. Add time slots above, then send an invite via Chat.</div>` : ""}
        ${future.map((s) => {
          const st = new Date(s.slot_start);
          const en = new Date(s.slot_end);
          const booked = !!s.booked_by;
          return `<div class="slot-row${booked ? " slot-booked" : ""}">
            <div class="slot-date">${st.toLocaleDateString("en",{weekday:"short",day:"numeric",month:"short"})}</div>
            <div class="slot-time">${st.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} – ${en.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
            <div class="slot-status">${booked ? `<span class="pill pill-interview_scheduled"><span class="dot"></span>booked</span>` : `<span class="pill pill-new"><span class="dot"></span>open</span>`}</div>
            ${!booked ? `<button class="btn-icon slot-del" data-slot="${s.id}" title="Remove">✕</button>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${past.length ? `<details class="slot-past-toggle"><summary>${past.length} past slot${past.length>1?"s":""}</summary>
        <div class="slot-list slot-past">${past.map((s) => {
          const st = new Date(s.slot_start);
          const en = new Date(s.slot_end);
          return `<div class="slot-row slot-dim"><div class="slot-date">${st.toLocaleDateString("en",{weekday:"short",day:"numeric",month:"short"})}</div><div class="slot-time">${st.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} – ${en.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div><div class="slot-status">${s.booked_by ? "booked" : "expired"}</div></div>`;
        }).join("")}</div></details>` : ""}`;

    f.querySelector("#sl-add").onclick = addSlot;

    f.querySelectorAll("[data-quick]").forEach((btn) => {
      btn.onclick = () => quickAdd(+btn.dataset.quick);
    });

    f.querySelectorAll(".slot-del").forEach((btn) => {
      btn.onclick = async () => {
        const { error } = await sb.from("interview_slots").delete().eq("id", btn.dataset.slot);
        if (error) return toast(error.message);
        const idx = slots.findIndex((s) => s.id === btn.dataset.slot);
        if (idx !== -1) slots.splice(idx, 1);
        renderSlotList();
        toast("Slot removed");
      };
    });
  }

  async function addSlot() {
    const date = f.querySelector("#sl-date").value;
    const start = f.querySelector("#sl-start").value;
    const end = f.querySelector("#sl-end").value;
    if (!date || !start || !end) return toast("Fill in date, start and end time");
    if (start >= end) return toast("End time must be after start time");

    const slot_start = new Date(`${date}T${start}:00`).toISOString();
    const slot_end = new Date(`${date}T${end}:00`).toISOString();

    const { data, error } = await sb.from("interview_slots").insert({
      organization_id: S.org.id,
      job_id: job.id,
      application_id: appId,
      slot_start,
      slot_end,
      created_by: S.session.user.id,
    }).select().single();
    if (error) return toast(error.message);
    slots.push(data);
    slots.sort((a, b) => a.slot_start.localeCompare(b.slot_start));
    renderSlotList();
    toast("Slot added");
  }

  async function quickAdd(mins) {
    const date = f.querySelector("#sl-date").value;
    if (!date) return toast("Pick a date first");
    const startH = 9, endH = 18;
    const newSlots = [];
    for (let h = startH; h < endH; ) {
      const m = h * 60;
      const mEnd = m + mins;
      if (mEnd / 60 > endH) break;
      const sh = String(Math.floor(m/60)).padStart(2,"0");
      const sm = String(m%60).padStart(2,"0");
      const eh = String(Math.floor(mEnd/60)).padStart(2,"0");
      const em = String(mEnd%60).padStart(2,"0");
      const slot_start = new Date(`${date}T${sh}:${sm}:00`).toISOString();
      const slot_end = new Date(`${date}T${eh}:${em}:00`).toISOString();
      const exists = slots.some((s) => s.slot_start === slot_start && s.slot_end === slot_end);
      if (!exists) {
        newSlots.push({ organization_id: S.org.id, job_id: job.id, application_id: appId, slot_start, slot_end, created_by: S.session.user.id });
      }
      h = mEnd / 60;
    }
    if (!newSlots.length) return toast("All slots for that day already exist");
    const { data, error } = await sb.from("interview_slots").insert(newSlots).select();
    if (error) return toast(error.message);
    slots.push(...data);
    slots.sort((a, b) => a.slot_start.localeCompare(b.slot_start));
    renderSlotList();
    toast(`${data.length} slots added`);
  }

  renderSlotList();
}

async function generateScheduleLink(appId) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const newToken = crypto.randomUUID();
  const { error } = await sb
    .from("applications")
    .update({ schedule_token: newToken, schedule_expires_at: expires })
    .eq("id", appId);
  if (error) { toast(error.message); return ""; }
  const app = S.cache.applications.find((a) => a.id === appId);
  if (app) { app.schedule_token = newToken; app.schedule_expires_at = expires; }
  return `${window.location.origin}/schedule?token=${newToken}`;
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

  // Show all candidates that can be scheduled
  const schedulable = S.cache.applications
    .filter((a) => !["rejected","hired"].includes(a.stage) && !a.interview_at)
    .map((a) => ({
      app: a,
      cand: S.cache.candidates.find((c) => c.id === a.candidate_id),
      job: S.cache.jobs.find((j) => j.id === a.job_id),
    }))
    .filter((r) => r.cand && r.job);

  if (schedulable.length) {
    const schedBar = el("div", "int-slot-bar");
    schedBar.innerHTML = `<div class="int-slot-label">Assign interview slots to candidates:</div>
      <div class="int-slot-btns">${schedulable.map((r) =>
        `<button class="btn btn-outline btn-sm" data-act="manage-slots" data-app="${r.app.id}">${esc(r.cand.name)} · ${esc(r.job.title)}</button>`
      ).join("")}</div>`;
    root.appendChild(schedBar);

    schedBar.querySelectorAll("[data-act=manage-slots]").forEach((b) =>
      b.addEventListener("click", () => manageSlots(b.dataset.app))
    );
  }

  if (!rows.length) {
    root.appendChild(el("div", "card", `<div class="empty"><strong>No interviews scheduled</strong>Assign slots to a candidate above, then send a scheduling link via Chat → Interview invite.</div>`));
    return;
  }

  const list = el("div", "interview-list");
  rows.forEach((r) => {
    const d = r.app.interview_at ? new Date(r.app.interview_at) : new Date(r.app.updated_at);
    const card = el("div", "interview-card");
    card.innerHTML = `
      <div class="date-block">
        <div class="day">${d.getDate()}</div>
        <div class="mon">${d.toLocaleString("en", { month: "short" })}</div>
      </div>
      <div class="int-info">
        <div class="int-name">${esc(r.cand.name)}</div>
        <div class="int-meta">${esc(r.job.title)} · ${r.app.stage.replaceAll("_", " ")}</div>
        <div class="int-time">${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${r.app.interview_at ? "" : " (manual)"}</div>
      </div>
      <div class="int-actions">
        <button class="btn btn-outline btn-sm" data-app="${r.app.id}" data-act="slots">Manage slots</button>
        <button class="btn btn-outline btn-sm" data-app="${r.app.id}" data-act="stage">Update stage</button>
        ${r.cand.phone ? `<button class="btn btn-outline btn-sm" data-phone="${esc(r.cand.phone)}" data-name="${esc(r.cand.name)}" data-act="wa">WhatsApp</button>` : ""}
      </div>`;
    list.appendChild(card);
  });
  root.appendChild(list);

  list.querySelectorAll("[data-act=slots]").forEach((b) =>
    b.addEventListener("click", () => manageSlots(b.dataset.app))
  );
  list.querySelectorAll("[data-act=stage]").forEach((b) =>
    b.addEventListener("click", () => stageForm(b.dataset.app))
  );
  list.querySelectorAll("[data-act=wa]").forEach((b) =>
    b.addEventListener("click", () => {
      const phone = b.dataset.phone.replace(/[^\d]/g, "");
      window.open(`https://wa.me/${phone}`, "_blank", "noopener");
    })
  );
}

// ---------- Chat ----------
function chat(root) {
  const candsWithPhone = S.cache.candidates.filter((c) => c.phone);

  if (!candsWithPhone.length) {
    root.appendChild(el("div", "card", `<div class="empty"><strong>No candidates with phone numbers</strong>Add a candidate with a phone number to compose WhatsApp messages.</div>`));
    return;
  }

  const layout = el("div", "chat-layout");
  const listCol = el("div", "chat-list");
  listCol.innerHTML = `<div class="chat-list-head">WhatsApp Composer</div>`;

  candsWithPhone.forEach((c) => {
    const item = el("div", "chat-item");
    item.innerHTML = `
      <div class="ci-av" style="background:${avColor(c.name)}">${initials(c.name)}</div>
      <div style="flex:1;min-width:0">
        <div class="ci-name">${esc(c.name)}</div>
        <div class="ci-last">${esc(c.phone)}</div>
      </div>`;
    item.onclick = () => openComposer(c);
    listCol.appendChild(item);
  });

  const windowCol = el("div", "chat-window");
  windowCol.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--grey);font-size:13px;">Select a candidate to compose a message</div>`;

  layout.appendChild(listCol);
  layout.appendChild(windowCol);
  root.appendChild(layout);

  function openComposer(c) {
    listCol.querySelectorAll(".chat-item").forEach((i) => i.classList.remove("active-chat"));
    const items = listCol.querySelectorAll(".chat-item");
    const idx = candsWithPhone.indexOf(c);
    if (items[idx]) items[idx].classList.add("active-chat");

    const firstName = c.name.split(" ")[0];
    const candApps = S.cache.applications.filter((a) => a.candidate_id === c.id);
    const candJob = candApps.length ? S.cache.jobs.find((j) => j.id === candApps[0].job_id) : null;
    const jobTitle = candJob ? candJob.title : "[Position]";
    const orgName = S.org?.name || "[Company]";

    const app = candApps.length ? candApps[0] : null;

    const inviteBase = (link) => `Hi ${firstName}, this is ${orgName}. We reviewed your profile for the ${jobTitle} role and would like to invite you for an interview.\n\nPick a time that works for you:\n${link}\n\nThis link is valid for 24 hours. Looking forward to meeting you!`;

    const templates = [
      { label: "Interview invite", text: inviteBase("[generating link…]"), async: true },
      { label: "Job offer", text: `Hi ${firstName}, congratulations! We're pleased to offer you the ${jobTitle} position at ${orgName}. We were impressed with your profile and believe you'd be a great fit for our team. We'll be sharing the offer details shortly. Please confirm your interest so we can proceed. Welcome aboard!` },
      { label: "Schedule call", text: `Hi ${firstName}, thank you for your interest in the ${jobTitle} role at ${orgName}. We'd like to schedule a brief call to discuss the opportunity and next steps. Could you share your availability for a 15-20 minute call this week?` },
      { label: "Follow-up", text: `Hi ${firstName}, just following up regarding the ${jobTitle} position at ${orgName}. We wanted to check if you're still interested and available. Please let us know at your earliest convenience.` },
      { label: "Document request", text: `Hi ${firstName}, thank you for your interest in the ${jobTitle} role at ${orgName}. To move forward with your application, could you please share the following documents:\n\n1. Updated resume\n2. ID proof\n3. Relevant certifications\n\nPlease share at your earliest convenience.` },
      { label: "Custom", text: `Hi ${firstName},\n\n` },
    ];

    windowCol.innerHTML = `
      <div class="chat-head">
        <div>
          <div class="ch-name">${esc(c.name)}</div>
          <div class="ch-sub">${esc(c.phone)}${candJob ? ` · ${esc(jobTitle)}` : ""}</div>
        </div>
        <a class="wa-link" href="https://wa.me/${c.phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          Open in WhatsApp
        </a>
      </div>
      <div class="tpl-picker">
        ${templates.map((t, i) => `<button class="tpl-chip${i === 2 ? " active" : ""}" data-tpl="${i}">${t.label}</button>`).join("")}
      </div>
      <div class="chat-messages">
        <div class="msg us">
          ${esc(templates[2].text).replace(/\n/g, "<br>")}
          <div class="msg-time">Preview</div>
        </div>
      </div>
      <div class="chat-input-row">
        <textarea id="wa-msg" placeholder="Edit message or pick a template above…">${templates[2].text}</textarea>
        <button class="btn btn-dark btn-sm" id="wa-send">Send via WA</button>
      </div>`;

    windowCol.querySelectorAll(".tpl-chip").forEach((chip) => {
      chip.onclick = async () => {
        windowCol.querySelectorAll(".tpl-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const tpl = templates[+chip.dataset.tpl];

        if (tpl.async && app) {
          windowCol.querySelector("#wa-msg").value = "[Generating 24hr scheduling link…]";
          windowCol.querySelector(".msg.us").innerHTML = `Generating scheduling link…<div class="msg-time">Please wait</div>`;
          const link = await generateScheduleLink(app.id);
          if (!link) return;
          tpl.text = inviteBase(link);
        }

        windowCol.querySelector("#wa-msg").value = tpl.text;
        windowCol.querySelector(".msg.us").innerHTML = `${esc(tpl.text).replace(/\n/g, "<br>")}<div class="msg-time">Preview</div>`;
      };
    });

    windowCol.querySelector("#wa-msg").addEventListener("input", (e) => {
      windowCol.querySelector(".msg.us").innerHTML = `${esc(e.target.value).replace(/\n/g, "<br>")}<div class="msg-time">Preview</div>`;
    });

    windowCol.querySelector("#wa-send").onclick = () => {
      const phone = c.phone.replace(/[^\d]/g, "");
      const msg = windowCol.querySelector("#wa-msg").value;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
      toast("Opening WhatsApp");
    };
  }
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

  const card = el("div", "rescore-card");
  card.innerHTML = `<h2>Re-run AI matching on stored resumes</h2>
    <p>The AI will re-read all stored resumes and update their match scores based on the latest JD requirements.</p>`;

  if (!rows.length) {
    card.innerHTML += `<div class="empty"><strong>Nothing to re-score</strong>Applications need both resume text and JD text stored.</div>`;
    root.appendChild(card);
    return;
  }

  const table = el("table", "table");
  table.innerHTML = `
    <thead><tr><th>Score</th><th>Candidate</th><th>Job</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${scoreBar(r.app.match_score)}</td>
      <td><strong>${esc(r.cand.name)}</strong></td>
      <td>${esc(r.job.title)}</td>
      <td><button class="btn btn-outline btn-sm" data-app="${r.app.id}">Re-score (1 credit)</button></td>
    </tr>`).join("")}</tbody>`;
  card.appendChild(table);
  root.appendChild(card);
  table.querySelectorAll("button[data-app]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "Scoring…";
      try {
        await runMatch(b.dataset.app);
        toast("Re-scored");
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
    [S.cache.jobs.length, "Open jobs"],
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

  const dist = el("div", "card", `<div class="card-title">Score distribution</div>`);
  const buckets = [[0,20],[20,40],[40,60],[60,80],[80,101]];
  const maxB = Math.max(1, ...buckets.map(([lo, hi]) =>
    scored.filter((a) => a.match_score >= lo && a.match_score < hi).length));
  buckets.forEach(([lo, hi]) => {
    const n = scored.filter((a) => a.match_score >= lo && a.match_score < hi).length;
    dist.innerHTML += `<div class="bar-row">
      <span class="bar-label">${lo}–${hi > 100 ? 100 : hi}</span>
      <div class="bar-track"><div class="bar-fill green" style="width:${(n / maxB) * 100}%"></div></div>
      <span class="bar-num">${n}</span></div>`;
  });
  grid.appendChild(dist);
  root.appendChild(grid);

  // ── Daily activity (date range) ──
  const activity = el("div", "card", "");
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  activity.innerHTML = `<div class="da-header">
    <div class="card-title">Daily activity</div>
    <div class="da-dates">
      <input type="date" class="da-date-input" id="da-from" value="${weekAgoStr}" max="${todayStr}">
      <span class="da-date-sep">to</span>
      <input type="date" class="da-date-input" id="da-to" value="${todayStr}" max="${todayStr}">
    </div>
  </div>
  <div id="da-chart-area"></div>`;
  root.appendChild(activity);

  function renderActivityChart() {
    const fromVal = activity.querySelector("#da-from").value;
    const toVal = activity.querySelector("#da-to").value;
    if (!fromVal || !toVal || fromVal > toVal) return;

    const from = new Date(fromVal + "T00:00:00");
    const to = new Date(toVal + "T00:00:00");
    const diffDays = Math.round((to - from) / 86400000) + 1;
    if (diffDays > 90) { activity.querySelector("#da-chart-area").innerHTML = `<div class="empty">Max 90 days range</div>`; return; }

    const days = [];
    for (let i = 0; i < diffDays; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const isToday = key === todayStr;
      const compact = diffDays > 14;
      const label = compact
        ? d.toLocaleDateString("en", { day: "numeric", month: "short" })
        : d.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });

      const dayApps = apps.filter((a) => (a.updated_at || a.created_at || "").slice(0, 10) === key);
      const dayCands = S.cache.candidates.filter((c) => (c.created_at || "").slice(0, 10) === key);
      const dayScored = dayApps.filter((a) => a.match_score != null);
      const dayStageChanges = dayApps.filter((a) => a.stage !== "new");
      const dayShortlisted = dayApps.filter((a) => ["shortlisted", "interview_scheduled", "interviewed", "offered", "hired"].includes(a.stage));

      days.push({ key, label, isToday, uploaded: dayCands.length, scored: dayScored.length, stageChanges: dayStageChanges.length, shortlisted: dayShortlisted.length });
    }

    const maxAct = Math.max(1, ...days.map((d) => d.uploaded + d.scored));
    const scrollable = diffDays > 14;
    const colW = scrollable ? "48px" : "";

    const totals = days.reduce((t, d) => ({ uploaded: t.uploaded + d.uploaded, scored: t.scored + d.scored, shortlisted: t.shortlisted + d.shortlisted, stageChanges: t.stageChanges + d.stageChanges }), { uploaded: 0, scored: 0, shortlisted: 0, stageChanges: 0 });

    activity.querySelector("#da-chart-area").innerHTML = `
    <div class="da-grid${scrollable ? " da-scrollable" : ""}">
      ${days.map((d) => {
        const total = d.uploaded + d.scored;
        const barH = Math.max(4, (total / maxAct) * 100);
        return `<div class="da-col${d.isToday ? " da-today" : ""}" ${colW ? `style="min-width:${colW}"` : ""}>
          <div class="da-bar-wrap">
            <div class="da-bar" style="height:${barH}%">
              ${d.scored ? `<div class="da-bar-seg da-scored" style="flex:${d.scored}"></div>` : ""}
              ${d.uploaded ? `<div class="da-bar-seg da-uploaded" style="flex:${d.uploaded}"></div>` : ""}
            </div>
          </div>
          <div class="da-num">${total || ""}</div>
          <div class="da-label">${d.label}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="da-legend">
      <span class="da-leg"><span class="da-dot da-scored"></span> Scored</span>
      <span class="da-leg"><span class="da-dot da-uploaded"></span> Uploaded</span>
    </div>
    <div class="da-today-summary">
      <div class="da-today-title">Period summary</div>
      <div class="da-today-stats">
        <span>${totals.uploaded} uploaded</span>
        <span>${totals.scored} scored</span>
        <span>${totals.shortlisted} shortlisted</span>
        <span>${totals.stageChanges} stage updates</span>
      </div>
    </div>`;
  }

  renderActivityChart();
  activity.querySelector("#da-from").addEventListener("change", renderActivityChart);
  activity.querySelector("#da-to").addEventListener("change", renderActivityChart);

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
