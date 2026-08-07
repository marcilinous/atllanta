// Offline write queue — the "outbox" pattern for field use.
//
// Field staff (BDE/TL, telecallers) work in areas with patchy signal. Rather
// than fail a check-in or a visit log when the network is down, we write the
// mutation into an on-device IndexedDB queue, confirm to the user immediately,
// and replay it against Supabase when connectivity returns.
//
// Each job carries a caller-supplied kind, a JSON payload, and optional binary
// blobs (e.g. a compressed selfie). A handler registered for that kind knows
// how to actually perform the write. Jobs replay oldest-first, so a check-in
// queued before a check-out runs first. Idempotency is the caller's job: use a
// client-generated id / natural unique key so a replay can't double-insert.
//
// Background Sync (where supported) wakes the service worker to trigger a
// flush; we also flush on `online`, on tab focus, and at startup, so delivery
// never depends on Background Sync alone.

const DB_NAME = 'atllanta';
const STORE = 'outbox';
const DB_VERSION = 1;
const SYNC_TAG = 'atllanta-outbox';

let _dbPromise = null;
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function store(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    (Date.now() + '-' + Math.random().toString(16).slice(2));
}

// ---- handler registry -----------------------------------------------------
const handlers = Object.create(null);

// Register how a given job kind is performed. fn(payload, blobs, job) should
// throw on failure (the job is kept and retried) or resolve on success.
export function registerHandler(kind, fn) { handlers[kind] = fn; }

// ---- change subscription (for the sync-status pill) -----------------------
const listeners = new Set();
let _count = 0;
let _syncing = false;
function snapshot() { return { count: _count, syncing: _syncing }; }
function emit() { for (const fn of listeners) { try { fn(snapshot()); } catch { /* ignore */ } } }

export function onOutboxChange(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}
export function pendingCount() { return _count; }

// ---- low-level queue ops --------------------------------------------------
function reqAsPromise(request, fallback) {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(fallback);
  });
}

async function countJobs() {
  const s = await store('readonly');
  return reqAsPromise(s.count(), 0);
}
async function allJobs() {
  const s = await store('readonly');
  const rows = await reqAsPromise(s.getAll(), []);
  return (rows || []).sort((a, b) => a.createdAt - b.createdAt);
}
async function putJob(job) { const s = await store('readwrite'); s.put(job); }
async function deleteJob(id) { const s = await store('readwrite'); s.delete(id); }

async function refreshCount() { _count = await countJobs(); emit(); }

// Queue a mutation. Returns the job id. Fires a background-sync request so the
// service worker can flush even if the tab is later backgrounded.
export async function enqueue(kind, payload, blobs) {
  const job = {
    id: uuid(), kind,
    payload: payload || {},
    blobs: blobs || null,
    createdAt: Date.now(), attempts: 0, lastError: null,
  };
  await putJob(job);
  await refreshCount();
  requestBackgroundSync();
  return job.id;
}

// ---- flushing -------------------------------------------------------------
let _flushing = false;

// Replay queued jobs oldest-first. A job whose handler isn't registered yet
// (e.g. its view hasn't loaded) is left in place for a later flush.
export async function flush() {
  if (_flushing || !navigator.onLine) return;
  _flushing = true; _syncing = true; emit();
  try {
    const jobs = await allJobs();
    for (const job of jobs) {
      if (!navigator.onLine) break;
      const handler = handlers[job.kind];
      if (!handler) continue;
      try {
        await handler(job.payload, job.blobs, job);
        await deleteJob(job.id);
        await refreshCount();
      } catch (e) {
        job.attempts = (job.attempts || 0) + 1;
        job.lastError = String((e && e.message) || e);
        await putJob(job);
        // Network dropped mid-flush → stop and wait for the next trigger.
        if (!navigator.onLine) break;
      }
    }
  } finally {
    _flushing = false; _syncing = false;
    await refreshCount();
  }
}

function requestBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg) => reg.sync.register(SYNC_TAG).catch(() => {}))
      .catch(() => {});
  }
}

// Wire up flush triggers. Call once at app boot, after handlers are registered.
export function initOutbox() {
  refreshCount();
  window.addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'flush-outbox') flush();
    });
  }
  if (navigator.onLine) flush();
}
