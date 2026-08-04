// Client-side image compression for field-captured selfies.
//
// Phone cameras produce 2–6 MB photos. Uploading those raw over mobile data
// from the field is slow and wastes storage, so we downscale and re-encode to
// JPEG in the browser before upload ("compress"). Two renditions are produced
// so each use case loads only what it needs ("decompress as per use case"):
//   • full  — up to 1280px, for the visit detail / full-screen view
//   • thumb — up to 320px, for list rows and previews
//
// Nothing here needs a library — it's canvas + the platform image decoders.

// Decode a File into something drawable, honouring EXIF orientation so
// portrait phone selfies aren't rotated. Returns width/height + a cleanup fn.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bmp.width, height: bmp.height, draw: bmp, cleanup: () => bmp.close && bmp.close() };
    } catch {
      // Older Safari lacks the options arg — fall through to the <img> path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image'));
      i.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, draw: img, cleanup: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

// Compress a File to a JPEG Blob no larger than maxEdge on its longest side.
export async function compressImage(file, { maxEdge = 1280, quality = 0.72, mimeType = 'image/jpeg' } = {}) {
  const { width, height, draw, cleanup } = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(width, height || 1));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round((height || width) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(draw, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, mimeType, quality));
    if (!blob) throw new Error('Image encoding failed');
    return blob;
  } finally {
    cleanup();
  }
}

// Full + thumbnail renditions for one captured photo.
export async function makeRenditions(file) {
  const full = await compressImage(file, { maxEdge: 1280, quality: 0.72 });
  const thumb = await compressImage(file, { maxEdge: 320, quality: 0.6 });
  return { full, thumb };
}

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
