// One function for every legacy endpoint. Vercel counts functions, not routes,
// and the 12 legacy handlers keep their exact (req, res) signature.
const handlers = {
  "parse-resume": () => import("../../server/legacy/parse-resume.js"),
  "extract-candidate": () => import("../../server/legacy/extract-candidate.js"),
  match: () => import("../../server/legacy/match.js"),
  "screen-job": () => import("../../server/legacy/screen-job.js"),
  schedule: () => import("../../server/legacy/schedule.js"),
  "google-auth": () => import("../../server/legacy/google-auth.js"),
  "event-processor": () => import("../../server/legacy/event-processor.js"),
  "create-org": () => import("../../server/legacy/create-org.js"),
  "bulk-import": () => import("../../server/legacy/bulk-import.js"),
  reports: () => import("../../server/legacy/reports.js"),
  "send-notification": () => import("../../server/legacy/send-notification.js"),
  "ai-query": () => import("../../server/legacy/ai-query.js"),
};

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

export default async function handler(req, res) {
  const [name] = req.query.legacy || [];
  const load = handlers[name];
  if (!load) return res.status(404).json({ error: "Not found" });
  const mod = await load();
  return mod.default(req, res);
}
