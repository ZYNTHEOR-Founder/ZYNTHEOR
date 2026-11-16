/**
 * Shared knowledge utilities — no imports from Workspace/Engine (breaks cycles).
 */
import crypto from 'crypto';

export function detectLang(text: string): 'th' | 'en' | 'mixed' {
  const thai = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (thai > 0 && latin > 0) return 'mixed';
  if (thai > latin) return 'th';
  return 'en';
}

export function semanticChunk(
  text: string,
  opts: { targetSize?: number; maxSize?: number; overlap?: number } = {}
): string[] {
  const target = opts.targetSize ?? 500;
  const maxSize = opts.maxSize ?? 900;
  const overlap = opts.overlap ?? 80;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxSize) {
      units.push(para);
    } else {
      const sentences = para.split(/(?<=[\.\!\?\u0E2F])\s+|\n+/).filter((s) => s.trim());
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > maxSize && buf) {
          units.push(buf.trim());
          buf = s;
        } else {
          buf = buf ? `${buf} ${s}` : s;
        }
      }
      if (buf.trim()) units.push(buf.trim());
    }
  }

  const merged: string[] = [];
  let acc = '';
  for (const u of units) {
    if (!acc) {
      acc = u;
      continue;
    }
    if ((acc + '\n\n' + u).length <= target + 150) {
      acc = `${acc}\n\n${u}`;
    } else {
      merged.push(acc);
      const tail = acc.slice(-overlap);
      acc = tail && u.length + tail.length < maxSize ? `${tail}\n${u}` : u;
    }
  }
  if (acc) merged.push(acc);
  return merged.length > 0 ? merged : text.trim() ? [text.trim()] : [];
}

export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeIntegrityText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}
