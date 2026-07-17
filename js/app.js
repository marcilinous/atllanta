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

function openModal(title, bodyNode) {
  $("#modal-title").textContent = title;
  const body = $("#modal-body");
  body.innerHTML = "";
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
        const candRows = jobApps.map((a) => {
          const c = S.cache.candidates.find((x) => x.id === a.candidate_id);
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line2)">
            <div class="av" style="background:${avColor(c?.name)};width:26px;height:26px;font-size:9px;border-radius:7px;flex-shrink:0">${initials(c?.name)}</div>
            <div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c?.name || "Unknown")}</div>
            <div style="flex-shrink:0">${scoreBar(a.match_score)}</div>
            <div style="flex-shrink:0">${stagePill(a.stage)}</div>
          </div>`;
        }).join("");

        detailHTML = `
          <div class="job-detail" data-id="${j.id}">
            ${jdPreview ? `<div style="font-size:12.5px;color:var(--ink2);line-height:1.5;margin-bottom:10px;white-space:pre-wrap;word-break:break-word">${esc(jdPreview)}${(j.jd_raw_text || "").length > 200 ? "…" : ""}</div>` : ""}
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--grey);margin-bottom:6px">Candidates (${appCount})</div>
            ${candRows || `<div style="font-size:12.5px;color:var(--grey);padding:8px 0">No candidates yet</div>`}
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
        <div class="who">
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
        <div class="who">
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
  }
  draw();
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

      const { data: cand, error } = await sb.from("candidates").insert({
        client_id: S.clientId,
        name: candName,
        email: extResult.email || null,
        phone: extResult.phone || null,
        resume_raw_text: parseResult.text,
      }).select().single();
      if (error) throw new Error(error.message);

      if (preselectedJobId) {
        await sb.from("applications").insert({ job_id: preselectedJobId, candidate_id: cand.id });
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
        <p style="font-size:12.5px;color:var(--green);font-weight:600;margin-bottom:12px">Profile created successfully</p>
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
      toast("Candidate added — " + candName);
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

        const { data: cand, error } = await sb.from("candidates").insert({
          client_id: S.clientId,
          name: extractResult.name || file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "),
          email: extractResult.email || null,
          phone: extractResult.phone || null,
          resume_raw_text: parseResult.text,
        }).select().single();

        if (error) throw new Error(error.message);
        if (jobId) {
          await sb.from("applications").insert({ job_id: jobId, candidate_id: cand.id });
        }

        logEntry.innerHTML = `<span style="color:var(--green)">&#10003;</span> ${esc(extractResult.name || file.name)} — ${esc(extractResult.email || "")}`;
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
    <div class="sc-summary">
      <div class="sc-stat"><div class="n">${jobApps.length}</div><div class="l">In pipeline</div></div>
      <div class="sc-stat"><div class="n">${unscoredCount}</div><div class="l">Unscored</div></div>
      <div class="sc-stat"><div class="n" id="sc-sel-count">0</div><div class="l">Selected</div></div>
      <div class="sc-stat"><div class="n" id="sc-credit-cost">0</div><div class="l">Credits cost</div></div>
      <div class="sc-stat"><div class="n">${creditsBalance}</div><div class="l">Balance</div></div>
    </div>

    <div class="sc-filters">
      <label>From <input type="date" id="sc-from" class="input" value="${weekAgo}" /></label>
      <label>To <input type="date" id="sc-to" class="input" value="${today}" /></label>
      <button class="btn btn-outline btn-sm" id="sc-apply-dates" style="padding:5px 10px;white-space:nowrap;font-size:11px">Apply</button>
    </div>

    ${jobApps.length ? `
      <div class="sc-toolbar">
        <strong>Candidates (${jobApps.length})</strong>
        <input type="text" id="sc-search" class="input" placeholder="Search…" style="flex:1;min-width:80px;padding:4px 8px;font-size:12px" />
        <button class="btn btn-outline btn-sm" id="sc-sel-unscored" style="font-size:11px;padding:2px 8px">Unscored</button>
        <button class="btn btn-outline btn-sm" id="sc-sel-all" style="font-size:11px;padding:2px 8px">All</button>
        <button class="btn btn-outline btn-sm" id="sc-sel-none" style="font-size:11px;padding:2px 8px">Clear</button>
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
        <button class="btn btn-outline btn-sm" id="sc-pool-all" style="font-size:11px;padding:2px 8px">Select all</button>
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
  openModal("Screen — " + job.title, f);

  function updateCounts() {
    const count = f.querySelectorAll(".sc-check:checked, .sc-pool-check:checked").length;
    f.querySelector("#sc-sel-count").textContent = count;
    f.querySelector("#sc-credit-cost").textContent = count;
    f.querySelector("#sc-start-count").textContent = count;
  }
  updateCounts();

  f.addEventListener("change", (e) => {
    if (e.target.classList.contains("sc-check") || e.target.classList.contains("sc-pool-check")) updateCounts();
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
        body: JSON.stringify({ job_id: jobId, mode: "all", application_ids: selectedAppIds }),
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
  const f = el("div");
  const raw = app.match_raw_response || {};
  const score = app.match_score;

  f.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
      <div class="av" style="background:${avColor(cand?.name)};width:44px;height:44px;font-size:16px;border-radius:12px">${initials(cand?.name)}</div>
      <div><strong style="font-size:15px">${esc(cand?.name)}</strong><br>
      <span style="color:var(--grey);font-size:12.5px">${esc(job?.title)}</span></div>
      ${score != null ? `<div style="margin-left:auto">${scoreBar(score)}</div>` : ""}
    </div>
    ${app.match_summary ? `<p style="margin-bottom:12px;font-size:13px;color:var(--ink2)">${esc(app.match_summary)}</p>` : ""}
    ${raw.strengths?.length ? `<p style="font-weight:700;font-size:12px;color:var(--green);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Strengths</p><ul style="margin:0 0 12px 18px;font-size:13px">${raw.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    ${raw.gaps?.length ? `<p style="font-weight:700;font-size:12px;color:var(--red);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Gaps</p><ul style="margin:0 0 12px 18px;font-size:13px">${raw.gaps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <button class="btn btn-amber" id="sd-run">${score == null ? "Run AI match (1 credit)" : "Re-run match (1 credit)"}</button>
    <p id="sd-status" style="margin-top:8px;color:var(--grey);font-size:12.5px"></p>`;
  openModal("Match detail", f);
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

  if (!rows.length) {
    root.appendChild(el("div", "card", `<div class="empty"><strong>No interviews scheduled</strong>Move a candidate's stage to "interview scheduled" and they'll appear here.</div>`));
    return;
  }

  const list = el("div", "interview-list");
  rows.forEach((r) => {
    const d = new Date(r.app.updated_at);
    const card = el("div", "interview-card");
    card.innerHTML = `
      <div class="date-block">
        <div class="day">${d.getDate()}</div>
        <div class="mon">${d.toLocaleString("en", { month: "short" })}</div>
      </div>
      <div class="int-info">
        <div class="int-name">${esc(r.cand.name)}</div>
        <div class="int-meta">${esc(r.job.title)} · ${r.app.stage.replaceAll("_", " ")}</div>
        <div class="int-time">${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      <div class="int-actions">
        <button class="btn btn-outline btn-sm" data-app="${r.app.id}" data-act="stage">Update stage</button>
        ${r.cand.phone ? `<button class="btn btn-outline btn-sm" data-phone="${esc(r.cand.phone)}" data-name="${esc(r.cand.name)}" data-act="wa">WhatsApp</button>` : ""}
      </div>`;
    list.appendChild(card);
  });
  root.appendChild(list);

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

    windowCol.innerHTML = `
      <div class="chat-head">
        <div>
          <div class="ch-name">${esc(c.name)}</div>
          <div class="ch-sub">${esc(c.phone)}</div>
        </div>
        <a class="wa-link" href="https://wa.me/${c.phone.replace(/[^\d]/g, "")}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          Open in WhatsApp
        </a>
      </div>
      <div class="chat-messages">
        <div class="msg us">
          Hi ${esc(c.name.split(" ")[0])}, thanks for applying! We'd like to move forward with your application. Could you confirm your availability this week for a quick call?
          <div class="msg-time">Template</div>
        </div>
      </div>
      <div class="chat-input-row">
        <textarea id="wa-msg" placeholder="Type a message…">Hi ${esc(c.name.split(" ")[0])}, thanks for applying! We'd like to move forward with your application. Could you confirm your availability this week for a quick call?</textarea>
        <button class="btn btn-dark btn-sm" id="wa-send">Send via WA</button>
      </div>`;

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
