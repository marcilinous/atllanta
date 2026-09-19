// Shared CSV helpers: build a CSV string from rows, trigger a browser download,
// and parse an uploaded CSV back into row objects. No dependencies — RFC-4180
// quoting (fields with comma/quote/newline are wrapped and quotes doubled).

// cols: array of { key, label } (label optional → key). value can be mapped by
// passing { key, label, map:(row)=>value }.
export function toCSV(rows, cols) {
  const columns = cols.map(c => typeof c === 'string' ? { key: c, label: c } : c);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map(c => esc(c.label || c.key)).join(',');
  const body = rows.map(r => columns.map(c => esc(c.map ? c.map(r) : r[c.key])).join(',')).join('\r\n');
  return header + '\r\n' + body;
}

// Trigger a client-side download of the given text as <filename>.
export function downloadCSV(filename, text) {
  const name = /\.csv$/i.test(filename) ? filename : filename + '.csv';
  // BOM so Excel opens UTF-8 (₹, names) correctly.
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Convenience: build + download in one call.
export function exportCSV(filename, rows, cols) {
  downloadCSV(filename, toCSV(rows, cols));
}

// Parse CSV text → array of objects keyed by the header row. Handles quoted
// fields, doubled quotes, and CRLF/LF line endings.
export function parseCSV(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* handled with \n or trailing */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(v => (v || '').trim() !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map(h => (h || '').trim());
  return nonEmpty.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] == null ? '' : r[i]).trim(); });
    return o;
  });
}
