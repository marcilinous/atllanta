// POST /api/parse-resume
// Accepts a resume file (PDF or DOCX) as base64 JSON payload, extracts text.
// Body: { filename: "resume.pdf", data: "<base64 string>" }
// Returns: { text: "<extracted text>" }

import { SUPABASE_URL } from "../lib/supabaseServer.js";

async function getUserFromToken(token) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!resp.ok) return null;
  return resp.json();
}

function getExtension(filename) {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  const { filename, data } = req.body || {};
  if (!filename || !data) {
    return res.status(400).json({ error: "filename and data (base64) are required" });
  }

  const ext = getExtension(filename);
  if (!["pdf", "docx", "doc"].includes(ext)) {
    return res.status(400).json({ error: "Only PDF and DOCX files are supported" });
  }

  const buffer = Buffer.from(data, "base64");

  const MAX_SIZE = 3 * 1024 * 1024;
  if (buffer.length > MAX_SIZE) {
    return res.status(400).json({ error: "File too large (max 3 MB)" });
  }

  let text = "";

  try {
    if (ext === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        pages.push(tc.items.map((it) => it.str).join(" "));
      }
      text = pages.join("\n");
      await doc.destroy();
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    }
  } catch (err) {
    return res.status(422).json({
      error: "Could not extract text from this file. It may be scanned or corrupted.",
    });
  }

  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    return res.status(422).json({
      error: "No text found in this file. It may be a scanned image — try pasting the text instead.",
    });
  }

  return res.status(200).json({ text });
}
