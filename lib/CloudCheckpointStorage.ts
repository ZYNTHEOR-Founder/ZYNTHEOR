/**
 * ZYNTHEOR Cloud Checkpoint Storage Client
 * Streams `.pt` neural model checkpoints directly from S3-compatible Cloud Object Storage
 * (AWS S3, Cloudflare R2, Supabase Storage S3, or Google Cloud Storage S3-interop)
 * into memory without relying on local disk persistence.
 */

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

export interface ParsedCloudCheckpoint {
  magic: string;
  metadata: Record<string, any>;
  weightsFloat32: Float32Array;
  payloadSha256: string;
  byteSize: number;
  sourceUri: string;
}

const MAGIC = 'ZYNTHEOR_QPLUS_PT';

export function isCloudCheckpointStorageConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

export function getCloudStorageConfig(): CloudStorageConfig {
  const bucket = process.env.S3_BUCKET || '';
  if (!bucket) {
    throw new Error('FAIL_CLOSED: S3_BUCKET environment variable is not configured.');
  }
  return {
    bucket,
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    defaultKey: process.env.S3_CHECKPOINT_KEY || 'checkpoints/model_checkpoint.pt',
  };
}

function createS3Client(cfg: CloudStorageConfig): S3Client {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
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

  return {
    magic,
    metadata,
    weightsFloat32,
    payloadSha256,
    byteSize: buffer.length,
    sourceUri,
  };
}

/**
 * Loads and verifies a `.pt` checkpoint directly from Cloud Object Storage (S3/R2/GCS/Supabase).
 */
export async function loadCheckpointFromCloudStorage(objectKey?: string): Promise<ParsedCloudCheckpoint> {
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
