/**
 * ZYNTHEOR Cloud Checkpoint Storage Client
 * Streams `.pt` neural model checkpoints directly from S3-compatible Cloud Object Storage
 * (AWS S3, Cloudflare R2, Supabase Storage S3, or Google Cloud Storage S3-interop)
 * into memory without relying on local disk persistence.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { AuditLedger } from './AuditLedger.ts';
import { upsertCloudModelCheckpoint } from '../src/db/repositories.ts';

export interface CloudStorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  defaultKey: string;
}

export interface CloudRuntimeConfigValidation {
  configValid: boolean;
  provider: 'presigned_url' | 's3' | 'cloud_runtime_url' | 'none';
  missingKeys: string[];
  validationError: string | null;
  sourceUri: string | null;
  normalizedEnv: Record<string, string>;
}

export interface ParsedCloudCheckpoint {
  magic: string;
  metadata: Record<string, any>;
  weightsFloat32: Float32Array;
  payloadSha256: string;
  containerSha256: string;
  byteSize: number;
  sourceUri: string;
}

const MAGIC = 'ZYNTHEOR_QPLUS_PT';

const CLOUD_ENV_KEYS = [
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_FORCE_PATH_STYLE',
  'S3_CHECKPOINT_KEY',
  'CHECKPOINT_PRESIGNED_URL',
  'CLOUD_RUNTIME_URL',
  'ZYNTHEOR_CONNECTIVITY_PROBE_URL',
  'CHECKPOINT_UPLOAD_URL',
  'ZYNTHEOR_ALLOW_LOOPBACK_CLOUD',
] as const;

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  let trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readDotenvFileMap(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    if (!fs.existsSync(filePath)) return out;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith('#')) continue;
      const eqIdx = stripped.indexOf('=');
      if (eqIdx <= 0) continue;
      const k = stripped.slice(0, eqIdx).trim().replace(/^export\s+/, '');
      const v = cleanEnvValue(stripped.slice(eqIdx + 1));
      if (k && v) out[k] = v;
    }
  } catch {
    // Fail gracefully if env file is unreadable
  }
  return out;
}

/**
 * Hydrates unset cloud runtime environment variables from `.env.local` / `.env`
 * and strips accidental surrounding quotes/whitespace from process.env entries
 * without ever overriding explicitly supplied runtime environment variables.
 */
export function hydrateCloudRuntimeEnv(overrides?: Partial<Record<string, string | undefined>>): Record<string, string> {
  const cwd = process.cwd();
  const dotenvBase = readDotenvFileMap(path.join(cwd, '.env'));
  const dotenvLocal = readDotenvFileMap(path.join(cwd, '.env.local'));
  const normalized: Record<string, string> = {};

  for (const key of CLOUD_ENV_KEYS) {
    const overrideVal = overrides && Object.prototype.hasOwnProperty.call(overrides, key)
      ? cleanEnvValue(overrides[key])
      : undefined;
    if (overrideVal !== undefined) {
      if (overrideVal) normalized[key] = overrideVal;
      continue;
    }
    const existing = cleanEnvValue(process.env[key]);
    if (existing) {
      process.env[key] = existing;
      normalized[key] = existing;
      continue;
    }
    const fallback = dotenvLocal[key] || dotenvBase[key] || '';
    if (fallback) {
      process.env[key] = fallback;
      normalized[key] = fallback;
    }
  }
  return normalized;
}

/**
 * Pre-bind validated configuration check before attempting to bind/load model weights.
 */
export function validateCloudRuntimeConfig(overrides?: {
  presignedUrl?: string;
  objectKey?: string;
}): CloudRuntimeConfigValidation {
  const envOverrides: Record<string, string | undefined> = {};
  if (overrides?.presignedUrl !== undefined) {
    envOverrides.CHECKPOINT_PRESIGNED_URL = overrides.presignedUrl;
  }
  if (overrides?.objectKey !== undefined) {
    envOverrides.S3_CHECKPOINT_KEY = overrides.objectKey;
  }
  const normalizedEnv = hydrateCloudRuntimeEnv(envOverrides);
  const presignedUrl = normalizedEnv.CHECKPOINT_PRESIGNED_URL || '';
  const probeUrl = normalizedEnv.ZYNTHEOR_CONNECTIVITY_PROBE_URL || '';
  const runtimeUrl = normalizedEnv.CLOUD_RUNTIME_URL || '';
  const bucket = normalizedEnv.S3_BUCKET || '';
  const accessKey = normalizedEnv.S3_ACCESS_KEY_ID || '';
  const secretKey = normalizedEnv.S3_SECRET_ACCESS_KEY || '';
  const endpoint = normalizedEnv.S3_ENDPOINT || '';
  const key = normalizedEnv.S3_CHECKPOINT_KEY || 'checkpoints/model_checkpoint.pt';

  if (presignedUrl) {
    try {
      const parsed = new URL(presignedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          configValid: false,
          provider: 'presigned_url',
          missingKeys: [],
          validationError: `Invalid CHECKPOINT_PRESIGNED_URL scheme '${parsed.protocol}'`,
          sourceUri: presignedUrl,
          normalizedEnv,
        };
      }
      return {
        configValid: true,
        provider: 'presigned_url',
        missingKeys: [],
        validationError: null,
        sourceUri: presignedUrl,
        normalizedEnv,
      };
    } catch {
      return {
        configValid: false,
        provider: 'presigned_url',
        missingKeys: [],
        validationError: 'Malformed CHECKPOINT_PRESIGNED_URL',
        sourceUri: presignedUrl,
        normalizedEnv,
      };
    }
  }

  if (bucket) {
    const missingKeys: string[] = [];
    if (!accessKey) missingKeys.push('S3_ACCESS_KEY_ID');
    if (!secretKey) missingKeys.push('S3_SECRET_ACCESS_KEY');
    if (endpoint) {
      try {
        const ep = new URL(endpoint);
        if (ep.protocol !== 'http:' && ep.protocol !== 'https:') {
          return {
            configValid: false,
            provider: 's3',
            missingKeys,
            validationError: `Invalid S3_ENDPOINT scheme '${ep.protocol}'`,
            sourceUri: `s3://${bucket}/${key}`,
            normalizedEnv,
          };
        }
      } catch {
        return {
          configValid: false,
          provider: 's3',
          missingKeys,
          validationError: 'Malformed S3_ENDPOINT URL',
          sourceUri: `s3://${bucket}/${key}`,
          normalizedEnv,
        };
      }
    }
    if (missingKeys.length > 0) {
      return {
        configValid: false,
        provider: 's3',
        missingKeys,
        validationError: `S3_BUCKET is set but required credentials are missing: ${missingKeys.join(', ')}`,
        sourceUri: `s3://${bucket}/${key}`,
        normalizedEnv,
      };
    }
    return {
      configValid: true,
      provider: 's3',
      missingKeys: [],
      validationError: null,
      sourceUri: `s3://${bucket}/${key}`,
      normalizedEnv,
    };
  }

  const fallbackUrl = probeUrl || runtimeUrl;
  if (fallbackUrl) {
    try {
      const parsed = new URL(fallbackUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          configValid: false,
          provider: 'cloud_runtime_url',
          missingKeys: [],
          validationError: `Invalid CLOUD_RUNTIME_URL scheme '${parsed.protocol}'`,
          sourceUri: fallbackUrl,
          normalizedEnv,
        };
      }
      return {
        configValid: true,
        provider: 'cloud_runtime_url',
        missingKeys: [],
        validationError: null,
        sourceUri: fallbackUrl,
        normalizedEnv,
      };
    } catch {
      return {
        configValid: false,
        provider: 'cloud_runtime_url',
        missingKeys: [],
        validationError: 'Malformed CLOUD_RUNTIME_URL',
        sourceUri: fallbackUrl,
        normalizedEnv,
      };
    }
  }

  return {
    configValid: false,
    provider: 'none',
    missingKeys: ['CHECKPOINT_PRESIGNED_URL', 'S3_BUCKET', 'CLOUD_RUNTIME_URL'],
    validationError: 'No Cloud Object Storage (CHECKPOINT_PRESIGNED_URL / S3_BUCKET) or CLOUD_RUNTIME_URL configured',
    sourceUri: null,
    normalizedEnv,
  };
}

export function isCloudCheckpointStorageConfigured(): boolean {
  const norm = hydrateCloudRuntimeEnv();
  return Boolean(norm.S3_BUCKET && norm.S3_ACCESS_KEY_ID && norm.S3_SECRET_ACCESS_KEY);
}

export function getCloudStorageConfig(): CloudStorageConfig {
  const norm = hydrateCloudRuntimeEnv();
  const bucket = norm.S3_BUCKET || '';
  if (!bucket) {
    throw new Error('FAIL_CLOSED: S3_BUCKET environment variable is not configured.');
  }
  return {
    bucket,
    region: norm.S3_REGION || 'auto',
    endpoint: norm.S3_ENDPOINT || undefined,
    forcePathStyle: norm.S3_FORCE_PATH_STYLE === 'true',
    defaultKey: norm.S3_CHECKPOINT_KEY || 'checkpoints/model_checkpoint.pt',
  };
}

function createS3Client(cfg: CloudStorageConfig): S3Client {
  const norm = hydrateCloudRuntimeEnv();
  const accessKeyId = norm.S3_ACCESS_KEY_ID;
  const secretAccessKey = norm.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('FAIL_CLOSED: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for Cloud Object Storage.');
  }
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

async function streamToBuffer(body: any): Promise<Buffer> {
  if (!body) {
    throw new Error('Empty response stream from Cloud Object Storage');
  }
  if (typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Parses and cryptographically verifies a ZYNTHEOR `.pt` binary checkpoint buffer in memory.
 * Format: 17-byte MAGIC + 4-byte uint32 LE metaLen + JSON metadata + Float32LE parameter tensor payload.
 */
export function parseCheckpointBuffer(buffer: Buffer, sourceUri: string): ParsedCloudCheckpoint {
  if (buffer.length < MAGIC.length + 4) {
    throw new Error(`CORRUPTED_CHECKPOINT: Buffer too short (${buffer.length} bytes) from ${sourceUri}`);
  }
  const magic = buffer.subarray(0, MAGIC.length).toString('utf8');
  if (magic !== MAGIC) {
    throw new Error(`CORRUPTED_CHECKPOINT: Invalid magic header '${magic}' from ${sourceUri}`);
  }

  const metaLen = buffer.readUInt32BE(MAGIC.length);
  const metaStart = MAGIC.length + 4;
  const metaEnd = metaStart + metaLen;
  if (metaEnd > buffer.length) {
    throw new Error(`CORRUPTED_CHECKPOINT: Metadata length ${metaLen} exceeds buffer size ${buffer.length}`);
  }

  const metadata = JSON.parse(buffer.subarray(metaStart, metaEnd).toString('utf8')) as Record<string, any>;
  const weightBytes = buffer.subarray(metaEnd);
  if (weightBytes.length % 4 !== 0) {
    throw new Error(`CORRUPTED_CHECKPOINT: Float32 payload length ${weightBytes.length} not aligned to 4 bytes`);
  }

  const expectedParams = Number(metadata.total_params || 0);
  const actualParams = weightBytes.length / 4;
  if (expectedParams > 0 && actualParams !== expectedParams) {
    throw new Error(
      `CORRUPTED_CHECKPOINT: Parameter count mismatch. Metadata expects ${expectedParams}, payload has ${actualParams}`
    );
  }

  const containerSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const payloadSha256 = crypto.createHash('sha256').update(weightBytes).digest('hex');
  const expectedSha = metadata.sha256 || metadata.payload_sha256;
  if (expectedSha && expectedSha !== payloadSha256) {
    throw new Error(
      `CORRUPTED_CHECKPOINT: SHA-256 checksum mismatch. Expected ${expectedSha}, got ${payloadSha256}`
    );
  }

  // Copy into aligned ArrayBuffer for Float32Array
  const aligned = new Uint8Array(weightBytes.length);
  aligned.set(weightBytes);
  const weightsFloat32 = new Float32Array(aligned.buffer);
  for (let i = 0; i < weightsFloat32.length; i++) {
    if (!Number.isFinite(weightsFloat32[i])) {
      throw new Error(`CORRUPTED_CHECKPOINT: Non-finite (NaN/Inf) Float32 weight detected at index ${i}`);
    }
  }

  return {
    magic,
    metadata,
    weightsFloat32,
    payloadSha256,
    containerSha256,
    byteSize: buffer.length,
    sourceUri,
  };
}

/**
 * Downloads raw container bytes + parsed verification directly from S3-compatible Cloud Storage.
 */
export async function downloadRawCheckpointFromCloudStorage(objectKey?: string): Promise<{
  buffer: Buffer;
  sourceUri: string;
  parsed: ParsedCloudCheckpoint;
}> {
  const cfg = getCloudStorageConfig();
  const key = objectKey || cfg.defaultKey;
  const client = createS3Client(cfg);
  const sourceUri = `s3://${cfg.bucket}/${key}`;

  const response = await client.send(
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    })
  );

  const buffer = await streamToBuffer(response.Body);
  const parsed = parseCheckpointBuffer(buffer, sourceUri);
  return { buffer, sourceUri, parsed };
}

/**
 * Loads and verifies a `.pt` checkpoint directly from Cloud Object Storage (S3/R2/GCS/Supabase).
 */
export async function loadCheckpointFromCloudStorage(objectKey?: string): Promise<ParsedCloudCheckpoint> {
  const { parsed, sourceUri } = await downloadRawCheckpointFromCloudStorage(objectKey);

  AuditLedger.append('SYSTEM', 'CLOUD_CHECKPOINT_LOADED', {
    sourceUri,
    payloadSha256: parsed.payloadSha256,
    totalParams: parsed.weightsFloat32.length,
    byteSize: parsed.byteSize,
    architecture: parsed.metadata.architecture || 'unknown',
  });

  return parsed;
}

/**
 * Checks object existence and metadata in Cloud Object Storage without downloading full weights.
 */
export async function statCheckpointInCloudStorage(objectKey?: string) {
  const cfg = getCloudStorageConfig();
  const key = objectKey || cfg.defaultKey;
  const client = createS3Client(cfg);

  const head = await client.send(
    new HeadObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    })
  );

  return {
    bucket: cfg.bucket,
    objectKey: key,
    sourceUri: `s3://${cfg.bucket}/${key}`,
    contentLength: head.ContentLength ?? 0,
    etag: head.ETag ?? null,
    lastModified: head.LastModified?.toISOString() ?? null,
    metadata: head.Metadata ?? {},
  };
}

/**
 * Uploads an in-memory `.pt` checkpoint buffer to Cloud Object Storage and registers it in PostgreSQL.
 */
export async function uploadCheckpointToCloudStorage(
  buffer: Buffer,
  objectKey?: string,
  modelKey: string = 'active_native'
) {
  const cfg = getCloudStorageConfig();
  const key = objectKey || cfg.defaultKey;
  const sourceUri = `s3://${cfg.bucket}/${key}`;
  const parsed = parseCheckpointBuffer(buffer, sourceUri);

  const client = createS3Client(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
      Metadata: {
        'zyntheor-sha256': parsed.payloadSha256,
        'zyntheor-params': String(parsed.weightsFloat32.length),
      },
    })
  );

  await upsertCloudModelCheckpoint({
    modelKey,
    storageProvider: cfg.endpoint ? 's3-compatible' : 'aws-s3',
    bucket: cfg.bucket,
    objectKey: key,
    sha256: parsed.payloadSha256,
    totalParams: parsed.weightsFloat32.length,
    architecture: String(parsed.metadata.architecture || 'ZYNTHEOR-Native'),
    storageMode: String(parsed.metadata.storage_mode || 'LEARNED_WEIGHTS_TRAINED'),
    byteSize: parsed.byteSize,
    metadata: parsed.metadata,
  });

  AuditLedger.append('SYSTEM', 'CLOUD_CHECKPOINT_UPLOADED', {
    sourceUri,
    modelKey,
    payloadSha256: parsed.payloadSha256,
    byteSize: parsed.byteSize,
  });

  return {
    sourceUri,
    payloadSha256: parsed.payloadSha256,
    totalParams: parsed.weightsFloat32.length,
    byteSize: parsed.byteSize,
  };
}

/**
 * Publishes an integrity-verified `.pt` buffer either to configured S3/R2 storage
 * or via HTTP PUT to a presigned `CHECKPOINT_UPLOAD_URL`. Fails closed when unconfigured.
 */
export async function publishCheckpointBufferToCloud(
  buffer: Buffer,
  opts?: {
    objectKey?: string;
    presignedUploadUrl?: string;
    modelKey?: string;
  }
): Promise<{
  provider: 's3' | 'presigned_upload_url';
  sourceUri: string;
  payloadSha256: string;
  totalParams: number;
  byteSize: number;
  httpStatus?: number;
}> {
  const norm = hydrateCloudRuntimeEnv();
  const putUrl = cleanEnvValue(opts?.presignedUploadUrl) || norm.CHECKPOINT_UPLOAD_URL || '';

  if (isCloudCheckpointStorageConfigured()) {
    const out = await uploadCheckpointToCloudStorage(buffer, opts?.objectKey, opts?.modelKey || 'active_native');
    return { provider: 's3', ...out };
  }

  if (putUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(putUrl);
    } catch {
      throw new Error('FAIL_CLOSED: Malformed CHECKPOINT_UPLOAD_URL');
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error(`FAIL_CLOSED: Unsupported upload URL scheme '${parsedUrl.protocol}'`);
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('SSRF_BLOCKED: Embedded credentials disallowed in upload URL');
    }
    const uploadHost = parsedUrl.hostname.toLowerCase();
    const allowLoopback = process.env.ZYNTHEOR_ALLOW_LOOPBACK_CLOUD !== 'false';
    const isLoopback = uploadHost === 'localhost' || uploadHost === '127.0.0.1' || uploadHost === '::1';
    if (
      uploadHost === 'metadata.google.internal' ||
      uploadHost === 'metadata.goog' ||
      uploadHost.endsWith('.internal') ||
      uploadHost.startsWith('169.254.') ||
      uploadHost.startsWith('10.') ||
      uploadHost.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(uploadHost) ||
      (isLoopback && !allowLoopback)
    ) {
      throw new Error(`SSRF_BLOCKED: Restricted upload host '${uploadHost}'`);
    }
    const parsed = parseCheckpointBuffer(buffer, putUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'User-Agent': 'ZYNTHEOR-Cloud-Runtime/1.0',
        },
        body: new Uint8Array(buffer),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`Cloud upload HTTP ${res.status} ${res.statusText}`);
      }
      AuditLedger.append('SYSTEM', 'CLOUD_CHECKPOINT_UPLOADED', {
        sourceUri: putUrl,
        modelKey: opts?.modelKey || 'active_native',
        payloadSha256: parsed.payloadSha256,
        byteSize: parsed.byteSize,
        httpStatus: res.status,
      });
      return {
        provider: 'presigned_upload_url',
        sourceUri: putUrl,
        payloadSha256: parsed.payloadSha256,
        totalParams: parsed.weightsFloat32.length,
        byteSize: parsed.byteSize,
        httpStatus: res.status,
      };
    } catch (err: any) {
      clearTimeout(timer);
      throw new Error(`FAIL_CLOSED: Online Connectivity Required — cloud upload failed (${err?.message || err})`);
    }
  }

  throw new Error(
    'FAIL_CLOSED: Online Connectivity Required — no Cloud Object Storage upload target configured (missing S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY or CHECKPOINT_UPLOAD_URL).'
  );
}

