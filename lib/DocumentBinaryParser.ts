/**
 * Binary PDF/DOCX parser using system Python libraries (pypdf, python-docx)
 * and pdftotext when available. Fail-closed when extraction is impossible.
 * OCR for scanned PDFs is NOT claimed unless a real OCR tool is present.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export type BinaryFormat = 'pdf' | 'docx';

export interface PageProvenance {
  page: number;
  text: string;
  charCount: number;
}

export interface BinaryParseResult {
  success: boolean;
  format: BinaryFormat;
  text: string;
  pages: PageProvenance[];
  pageCount: number;
  warnings: string[];
  errors: string[];
  meta: Record<string, unknown>;
  extracted: boolean;
  ocrUsed: boolean;
}

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 200;

function detectPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

function detectDocx(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

export function validateBinaryBuffer(
  buf: Buffer,
  declared: BinaryFormat
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!buf || buf.length === 0) errors.push('EMPTY_FILE');
  if (buf.length > MAX_BYTES) errors.push(`FILE_TOO_LARGE:${buf.length}>${MAX_BYTES}`);
  if (declared === 'pdf' && !detectPdf(buf)) errors.push('INVALID_PDF_MAGIC');
  if (declared === 'docx' && !detectDocx(buf)) errors.push('INVALID_DOCX_ZIP_MAGIC');
  return { ok: errors.length === 0, errors };
}

function writeTemp(buf: Buffer, ext: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-doc-'));
  const file = path.join(dir, `input.${ext}`);
  fs.writeFileSync(file, buf);
  return file;
}

function cleanupTemp(file: string): void {
  try {
    const dir = path.dirname(file);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const PY_PDF = `
import json, sys
from pypdf import PdfReader
path = sys.argv[1]
max_pages = int(sys.argv[2])
reader = PdfReader(path)
n = len(reader.pages)
if n > max_pages:
    print(json.dumps({"ok": False, "error": f"TOO_MANY_PAGES:{n}>{max_pages}", "pageCount": n}))
    sys.exit(0)
pages = []
for i, page in enumerate(reader.pages):
    try:
        t = page.extract_text() or ""
    except Exception as e:
        t = ""
    pages.append({"page": i+1, "text": t, "charCount": len(t.strip())})
text = "\\n\\n".join(p["text"] for p in pages).strip()
print(json.dumps({"ok": True, "pageCount": n, "pages": pages, "text": text, "meta": {"producer": getattr(reader.metadata, "producer", None) if reader.metadata else None}}))
`;

const PY_DOCX = `
import json, sys
from docx import Document
path = sys.argv[1]
doc = Document(path)
paras = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
# tables
for table in doc.tables:
    for row in table.rows:
        cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
        if cells:
            paras.append(" | ".join(cells))
text = "\\n\\n".join(paras).strip()
pages = [{"page": 1, "text": text, "charCount": len(text)}]
print(json.dumps({"ok": True, "pageCount": 1, "pages": pages, "text": text, "meta": {"paragraphs": len(paras)}, "warnings": ["DOCX_PAGE_BOUNDARIES_UNAVAILABLE"]}))
`;

function runPython(script: string, file: string): { ok: boolean; data?: any; error?: string } {
  const res = spawnSync('python3', ['-c', script, file, String(MAX_PAGES)], {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    timeout: 60000
  });
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) return { ok: false, error: res.stderr || `exit ${res.status}` };
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch (e: any) {
    return { ok: false, error: 'INVALID_JSON_FROM_PARSER: ' + (e.message || String(e)) };
  }
}

export async function parsePdfBuffer(buf: Buffer): Promise<BinaryParseResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const v = validateBinaryBuffer(buf, 'pdf');
  if (!v.ok) {
    return { success: false, format: 'pdf', text: '', pages: [], pageCount: 0, warnings, errors: v.errors, meta: {}, extracted: false, ocrUsed: false };
  }

  const tmp = writeTemp(buf, 'pdf');
  try {
    const result = runPython(PY_PDF, tmp);
    if (!result.ok || !result.data) {
      // fallback pdftotext
      const pt = spawnSync('pdftotext', ['-layout', tmp, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, timeout: 60000 });
      if (pt.status === 0 && (pt.stdout || '').trim()) {
        const text = pt.stdout.trim();
        return {
          success: true,
          format: 'pdf',
          text,
          pages: [{ page: 1, text, charCount: text.length }],
          pageCount: 1,
          warnings: ['PDFTOTEXT_FALLBACK_NO_PAGE_SPLIT'],
          errors: [],
          meta: { engine: 'pdftotext' },
          extracted: true,
          ocrUsed: false
        };
      }
      return {
        success: false,
        format: 'pdf',
        text: '',
        pages: [],
        pageCount: 0,
        warnings,
        errors: [result.error || pt.stderr || 'PDF_PARSE_FAILED'],
        meta: {},
        extracted: false,
        ocrUsed: false
      };
    }
    const data = result.data;
    if (data.ok === false) {
      return {
        success: false,
        format: 'pdf',
        text: '',
        pages: [],
        pageCount: data.pageCount || 0,
        warnings,
        errors: [data.error || 'PDF_REJECTED'],
        meta: {},
        extracted: false,
        ocrUsed: false
      };
    }
    const text = String(data.text || '').trim();
    const pages: PageProvenance[] = (data.pages || []).map((p: any) => ({
      page: p.page,
      text: p.text || '',
      charCount: p.charCount || 0
    }));
    if (!text) {
      warnings.push('PDF_TEXT_EMPTY_MAY_BE_SCANNED');
      warnings.push('OCR_NOT_IMPLEMENTED_IN_THIS_BUILD');
      return {
        success: false,
        format: 'pdf',
        text: '',
        pages,
        pageCount: data.pageCount || pages.length,
        warnings,
        errors: ['NO_EXTRACTABLE_TEXT'],
        meta: data.meta || {},
        extracted: false,
        ocrUsed: false
      };
    }
    return {
      success: true,
      format: 'pdf',
      text,
      pages: pages.filter((p) => p.charCount > 0),
      pageCount: data.pageCount || pages.length,
      warnings,
      errors: [],
      meta: { ...(data.meta || {}), engine: 'pypdf' },
      extracted: true,
      ocrUsed: false
    };
  } finally {
    cleanupTemp(tmp);
  }
}

export async function parseDocxBuffer(buf: Buffer): Promise<BinaryParseResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const v = validateBinaryBuffer(buf, 'docx');
  if (!v.ok) {
    return { success: false, format: 'docx', text: '', pages: [], pageCount: 0, warnings, errors: v.errors, meta: {}, extracted: false, ocrUsed: false };
  }
  const tmp = writeTemp(buf, 'docx');
  try {
    const result = runPython(PY_DOCX, tmp);
    if (!result.ok || !result.data || result.data.ok === false) {
      return {
        success: false,
        format: 'docx',
        text: '',
        pages: [],
        pageCount: 0,
        warnings,
        errors: [result.error || result.data?.error || 'DOCX_PARSE_FAILED'],
        meta: {},
        extracted: false,
        ocrUsed: false
      };
    }
    const data = result.data;
    const text = String(data.text || '').trim();
    if (!text) {
      return {
        success: false,
        format: 'docx',
        text: '',
        pages: [],
        pageCount: 0,
        warnings: ['DOCX_EMPTY'],
        errors: ['NO_EXTRACTABLE_TEXT'],
        meta: data.meta || {},
        extracted: false,
        ocrUsed: false
      };
    }
    return {
      success: true,
      format: 'docx',
      text,
      pages: data.pages || [{ page: 1, text, charCount: text.length }],
      pageCount: data.pageCount || 1,
      warnings: data.warnings || ['DOCX_PAGE_BOUNDARIES_UNAVAILABLE'],
      errors: [],
      meta: { ...(data.meta || {}), engine: 'python-docx' },
      extracted: true,
      ocrUsed: false
    };
  } finally {
    cleanupTemp(tmp);
  }
}

export async function parseBinaryDocument(buf: Buffer, format: BinaryFormat): Promise<BinaryParseResult> {
  if (format === 'pdf') return parsePdfBuffer(buf);
  if (format === 'docx') return parseDocxBuffer(buf);
  return {
    success: false,
    format,
    text: '',
    pages: [],
    pageCount: 0,
    warnings: [],
    errors: ['UNSUPPORTED_FORMAT'],
    meta: {},
    extracted: false,
    ocrUsed: false
  };
}

export async function parserCapabilityReport(): Promise<{ pdf: boolean; docx: boolean; ocr: boolean; engines: Record<string, string> }> {
  const pdfProbe = spawnSync('python3', ['-c', 'import pypdf; print("ok")'], { encoding: 'utf8' });
  const docxProbe = spawnSync('python3', ['-c', 'import docx; print("ok")'], { encoding: 'utf8' });
  const pdftotext = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  return {
    pdf: pdfProbe.status === 0 || pdftotext.status === 0 || (pdftotext.stderr || '').includes('pdftotext'),
    docx: docxProbe.status === 0,
    ocr: false,
    engines: {
      pdf: pdfProbe.status === 0 ? 'pypdf' : 'pdftotext-fallback',
      docx: docxProbe.status === 0 ? 'python-docx' : 'none',
      ocr: 'not-implemented'
    }
  };
}

export function bufferFromBase64(b64: string): Buffer {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(cleaned, 'base64');
}
