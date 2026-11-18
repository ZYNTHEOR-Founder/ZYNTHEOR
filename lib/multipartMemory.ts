/**
 * Minimal multipart/form-data parser (memory-only, single-file).
 * Avoids multer dependency when npm install is unavailable.
 * Supports field "file" plus text fields (format, title, collection, ingest).
 */

export interface MultipartFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  file?: MultipartFile;
}

function getBoundary(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  return m ? (m[1] || m[2] || '').trim() : null;
}

export function parseMultipartBuffer(buf: Buffer, contentType: string): MultipartResult {
  const boundary = getBoundary(contentType);
  if (!boundary) throw new Error('Missing multipart boundary');
  const sep = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: MultipartFile | undefined;

  let start = buf.indexOf(sep);
  while (start !== -1) {
    let next = buf.indexOf(sep, start + sep.length);
    // part is between start+sep and next (or end)
    let partStart = start + sep.length;
    // skip leading CRLF
    if (buf[partStart] === 13 && buf[partStart + 1] === 10) partStart += 2;
    // end boundary --
    if (buf[partStart] === 45 && buf[partStart + 1] === 45) break;

    const partEnd = next === -1 ? buf.length : next;
    let part = buf.subarray(partStart, partEnd);
    // strip trailing CRLF before boundary
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      start = next;
      continue;
    }
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const body = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
    const name = nameMatch?.[1] || '';

    if (fileMatch) {
      file = {
        fieldname: name || 'file',
        originalname: fileMatch[1] || 'upload.bin',
        mimetype: (typeMatch?.[1] || 'application/octet-stream').trim(),
        buffer: Buffer.from(body)
      };
    } else if (name) {
      fields[name] = body.toString('utf8');
    }

    start = next;
  }

  return { fields, file };
}

export function readRequestBuffer(req: any, limit = 20 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
