/**
 * ZYNTHEOR Cloud Object Storage Service Layer
 * Provides configuration management, live bucket reachability + read/write/delete probe testing,
 * and authenticated checkpoint artifact read/write operations against S3-compatible Cloud Object Storage.
 */

import crypto from 'crypto';
import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  hydrateCloudRuntimeEnv,
  validateCloudRuntimeConfig,
  getCloudSecretsSnapshot,
  persistCloudSecretsToEnv,
  parseCheckpointBuffer,
  publishCheckpointBufferToCloud,
  isCloudCheckpointStorageConfigured,
  type AllowedCloudConfigKey,
  type CloudSecretsSnapshot,
  type ParsedCloudCheckpoint,
} from './CloudCheckpointStorage.ts';
import { AuditLedger } from './AuditLedger.ts';

export interface CloudStorageEndpointConfigInput {
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_CHECKPOINT_KEY?: string;
  S3_FORCE_PATH_STYLE?: string | boolean;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  CHECKPOINT_PRESIGNED_URL?: string;
  CHECKPOINT_UPLOAD_URL?: string;
}

export interface BucketArtifactSummary {
  key: string;
  sizeBytes: number;
  lastModified: string | null;
  etag: string | null;
}

export interface CloudStorageConnectionTestResult {
  success: boolean;
  preflightReady: boolean;
  validConfig: boolean;
  bucketReachable: boolean;
  readVerified: boolean;
  writeVerified: boolean;
  cleanupVerified: boolean;
  roundtripSha256Match: boolean;
  objectExists: boolean | null;
  objectSizeBytes: number | null;
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  forcePathStyle: boolean;
  httpStatusCode: number | null;
  latencyMs: number;
  probeKey: string | null;
  probeSha256: string | null;
  artifacts: BucketArtifactSummary[];
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface CloudPreflightReport {
  passed: boolean;
  status: 'PREFLIGHT_PASS' | 'PREFLIGHT_BLOCKED';
  checks: {
    credentialsValid: boolean;
    bucketAvailable: boolean;
    checkpointExists: boolean;
    checkpointAccessible: boolean;
    readWriteVerified: boolean;
  };
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  checkpointSizeBytes: number | null;
  checkpointETag: string | null;
  checkpointLastModified: string | null;
  headerMagicValid: boolean | null;
  httpStatusCode: number | null;
  missingCredentials: string[];
  blockers: string[];
  error: string | null;
  latencyMs: number;
  checkedAt: string;
}

export interface CloudCheckpointArtifactReadResult {
  buffer: Buffer;
  sourceUri: string;
  provider: 's3' | 'presigned_url';
  byteSize: number;
  fetchLatencyMs: number;
  httpStatusCode: number | null;
  etag: string | null;
}

export interface S3ClientLike {
  send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any>;
  destroy?: () => void;
}

export type S3ClientFactory = (cfg: {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}) => S3ClientLike;

function cleanValue(raw: string | boolean | undefined): string {
  if (raw === undefined) return '';
  let trimmed = String(raw).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function validateSafeExternalUrl(label: string, rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL format for ${label}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} must use http:// or https://`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} cannot contain embedded credentials`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowLoopback = process.env.ZYNTHEOR_ALLOW_LOOPBACK_CLOUD !== 'false';
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (
    !host ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host.endsWith('.internal') ||
    host.startsWith('169.254.') ||
    host === '0.0.0.0' ||
    host === '::' ||
    (isLoopback && !allowLoopback)
  ) {
    throw new Error(`SSRF_BLOCKED: Restricted host '${host}' for ${label}`);
  }
  return parsed.href;
}

async function bodyToBuffer(body: any): Promise<Buffer> {
  if (!body) {
    throw new Error('Empty response body from Cloud Object Storage');
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
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

const defaultS3ClientFactory: S3ClientFactory = (cfg) =>
  new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    maxAttempts: 1,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

export class CloudObjectStorageService {
  private static clientFactory: S3ClientFactory = defaultS3ClientFactory;

  public static setClientFactoryForTesting(factory?: S3ClientFactory): void {
    CloudObjectStorageService.clientFactory = factory || defaultS3ClientFactory;
  }

  public static getConfigurationStatus(): CloudSecretsSnapshot & {
    s3Configured: boolean;
    bucket: string | null;
    region: string;
    endpoint: string | null;
    checkpointKey: string;
    forcePathStyle: boolean;
  } {
    const norm = hydrateCloudRuntimeEnv();
    const snapshot = getCloudSecretsSnapshot();
    const endpoint = norm.S3_ENDPOINT || null;
    return {
      ...snapshot,
      s3Configured: isCloudCheckpointStorageConfigured(),
      bucket: norm.S3_BUCKET || null,
      region: norm.S3_REGION || (endpoint ? 'auto' : 'us-east-1'),
      endpoint,
      checkpointKey: norm.S3_CHECKPOINT_KEY || 'checkpoints/model_checkpoint.pt',
      forcePathStyle: String(norm.S3_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true',
    };
  }

  public static configureConnection(updates: CloudStorageEndpointConfigInput): {
    updatedKeys: AllowedCloudConfigKey[];
    clearedKeys: AllowedCloudConfigKey[];
    snapshot: CloudSecretsSnapshot;
  } {
    const res = persistCloudSecretsToEnv({ ...updates });
    AuditLedger.append('SYSTEM', 'CLOUD_OBJECT_STORAGE_CONFIGURED', {
      updatedKeys: res.updatedKeys,
      clearedKeys: res.clearedKeys,
      provider: res.snapshot.provider,
      configValid: res.snapshot.configValid,
    });
    return res;
  }

  public static async testBucketConnection(opts?: {
    verifyReadWrite?: boolean;
    objectKey?: string;
    overrides?: CloudStorageEndpointConfigInput;
    listPrefix?: string;
  }): Promise<CloudStorageConnectionTestResult> {
    const started = Date.now();
    const norm = hydrateCloudRuntimeEnv();
    const pick = (overrideVal: string | boolean | undefined, envKey: AllowedCloudConfigKey): string => {
      if (overrideVal !== undefined) {
        const cleaned = cleanValue(overrideVal);
        if (cleaned && !cleaned.includes('••••')) {
          return cleaned;
        }
      }
      return cleanValue(norm[envKey] ?? process.env[envKey]);
    };

    const bucket = pick(opts?.overrides?.S3_BUCKET, 'S3_BUCKET');
    const endpointRaw = pick(opts?.overrides?.S3_ENDPOINT, 'S3_ENDPOINT');
    const region = pick(opts?.overrides?.S3_REGION, 'S3_REGION') || (endpointRaw ? 'auto' : 'us-east-1');
    const accessKeyId = pick(opts?.overrides?.S3_ACCESS_KEY_ID, 'S3_ACCESS_KEY_ID');
    const secretAccessKey = pick(opts?.overrides?.S3_SECRET_ACCESS_KEY, 'S3_SECRET_ACCESS_KEY');
    const checkpointKey =
      cleanValue(opts?.objectKey) ||
      pick(opts?.overrides?.S3_CHECKPOINT_KEY, 'S3_CHECKPOINT_KEY') ||
      'checkpoints/model_checkpoint.pt';
    const forcePathStyleRaw =
      opts?.overrides?.S3_FORCE_PATH_STYLE !== undefined
        ? String(opts.overrides.S3_FORCE_PATH_STYLE)
        : norm.S3_FORCE_PATH_STYLE || process.env.S3_FORCE_PATH_STYLE || 'false';
    const forcePathStyle = forcePathStyleRaw.toLowerCase() === 'true';

    const missing: string[] = [];
    if (!bucket) missing.push('S3_BUCKET');
    if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID');
    if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');

    AuditLedger.emitWorkflowEvent({
      source: 'cloud_preflight',
      tag: 'INIT',
      goal: `Production Integration · ${checkpointKey}`,
      resetLogs: true,
      isRunning: true,
      message: `Cloud Preflight: checking bucket '${bucket || 'UNSET'}', credentials, checkpoint '${checkpointKey}' & R/W permissions`,
    });

    let validatedEndpoint: string | undefined;
    if (endpointRaw) {
      try {
        validatedEndpoint = validateSafeExternalUrl('S3_ENDPOINT', endpointRaw);
      } catch (err: any) {
        const errMsg = err?.message || 'Invalid S3_ENDPOINT URL';
        AuditLedger.emitWorkflowEvent({
          source: 'cloud_preflight',
          tag: 'ERROR',
          isRunning: false,
          message: `FAIL_CLOSED: Cloud Preflight invalid S3_ENDPOINT — ${errMsg}`,
        });
        return {
          success: false,
          preflightReady: false,
          validConfig: false,
          bucketReachable: false,
          readVerified: false,
          writeVerified: false,
          cleanupVerified: false,
          roundtripSha256Match: false,
          objectExists: null,
          objectSizeBytes: null,
          bucket: bucket || null,
          region,
          endpoint: endpointRaw,
          checkpointKey,
          forcePathStyle,
          httpStatusCode: null,
          latencyMs: Math.max(1, Date.now() - started),
          probeKey: null,
          probeSha256: null,
          artifacts: [],
          errorCode: 'INVALID_ENDPOINT',
          errorMessage: errMsg,
          checkedAt: new Date().toISOString(),
        };
      }
    }

    if (missing.length > 0) {
      const errMsg = `Missing required Cloud Object Storage credentials: ${missing.join(', ')}`;
      AuditLedger.emitWorkflowEvent({
        source: 'cloud_preflight',
        tag: 'ERROR',
        isRunning: false,
        message: `FAIL_CLOSED: Cloud Preflight blocked — ${errMsg}`,
      });
      return {
        success: false,
        preflightReady: false,
        validConfig: false,
        bucketReachable: false,
        readVerified: false,
        writeVerified: false,
        cleanupVerified: false,
        roundtripSha256Match: false,
        objectExists: null,
        objectSizeBytes: null,
        bucket: bucket || null,
        region,
        endpoint: validatedEndpoint || null,
        checkpointKey,
        forcePathStyle,
        httpStatusCode: null,
        latencyMs: Math.max(1, Date.now() - started),
        probeKey: null,
        probeSha256: null,
        artifacts: [],
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: errMsg,
        checkedAt: new Date().toISOString(),
      };
    }

    const client = CloudObjectStorageService.clientFactory({
      region,
      endpoint: validatedEndpoint,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
    });

    let httpStatusCode: number | null = null;
    let objectExists: boolean | null = null;
    let objectSizeBytes: number | null = null;
    let readVerified = false;
    let writeVerified = false;
    let cleanupVerified = false;
    let roundtripSha256Match = false;
    let probeKey: string | null = null;
    let probeSha256: string | null = null;
    const artifacts: BucketArtifactSummary[] = [];

    try {
      const headBucketRes = await client.send(new HeadBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(6000),
      });
      httpStatusCode = headBucketRes?.$metadata?.httpStatusCode ?? 200;

      // Stat target checkpoint object (read check #1)
      try {
        const headObjRes = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: checkpointKey }),
          { abortSignal: AbortSignal.timeout(5000) }
        );
        objectExists = true;
        objectSizeBytes = typeof headObjRes?.ContentLength === 'number' ? headObjRes.ContentLength : null;
        readVerified = true;
      } catch (headErr: any) {
        const st = headErr?.$metadata?.httpStatusCode;
        if (st === 404 || headErr?.name === 'NotFound') {
          objectExists = false;
        } else {
          objectExists = null;
        }
      }

      // List checkpoint objects (up to 10)
      try {
        const listRes = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: opts?.listPrefix ?? 'checkpoints/',
            MaxKeys: 10,
          }),
          { abortSignal: AbortSignal.timeout(5000) }
        );
        if (Array.isArray(listRes?.Contents)) {
          for (const item of listRes.Contents) {
            if (!item?.Key) continue;
            artifacts.push({
              key: String(item.Key),
              sizeBytes: Number(item.Size ?? 0),
              lastModified: item.LastModified ? new Date(item.LastModified).toISOString() : null,
              etag: item.ETag ? String(item.ETag) : null,
            });
          }
          readVerified = true;
        }
      } catch {
        // ListObjectsV2 is diagnostic; continue to explicit read/write probe
      }

      // Read/write/delete roundtrip probe
      if (opts?.verifyReadWrite !== false) {
        const nonce = crypto.randomUUID();
        probeKey = `.zyntheor-probes/rw-probe-${nonce}.bin`;
        const probePayload = Buffer.from(
          JSON.stringify({
            service: 'zyntheor-storage-probe',
            nonce,
            ts: new Date().toISOString(),
          }),
          'utf8'
        );
        probeSha256 = crypto.createHash('sha256').update(probePayload).digest('hex');

        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: probeKey,
            Body: probePayload,
            ContentType: 'application/octet-stream',
            Metadata: { 'zyntheor-probe-sha256': probeSha256 },
          }),
          { abortSignal: AbortSignal.timeout(6000) }
        );
        writeVerified = true;

        const getRes = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: probeKey,
          }),
          { abortSignal: AbortSignal.timeout(6000) }
        );
        const downloaded = await bodyToBuffer(getRes?.Body);
        const downloadedSha = crypto.createHash('sha256').update(downloaded).digest('hex');
        readVerified = true;
        roundtripSha256Match = downloadedSha === probeSha256 && Buffer.compare(downloaded, probePayload) === 0;

        try {
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: probeKey,
            }),
            { abortSignal: AbortSignal.timeout(5000) }
          );
          cleanupVerified = true;
        } catch {
          cleanupVerified = false;
        }

        if (!roundtripSha256Match) {
          AuditLedger.emitWorkflowEvent({
            source: 'cloud_preflight',
            tag: 'ERROR',
            isRunning: false,
            message: `FAIL_CLOSED: Cloud Preflight write/read SHA-256 mismatch on bucket '${bucket}'`,
          });
          return {
            success: false,
            preflightReady: false,
            validConfig: true,
            bucketReachable: true,
            readVerified,
            writeVerified,
            cleanupVerified,
            roundtripSha256Match: false,
            objectExists,
            objectSizeBytes,
            bucket,
            region,
            endpoint: validatedEndpoint || null,
            checkpointKey,
            forcePathStyle,
            httpStatusCode,
            latencyMs: Math.max(1, Date.now() - started),
            probeKey,
            probeSha256,
            artifacts,
            errorCode: 'PROBE_SHA256_MISMATCH',
            errorMessage: `Write/Read probe SHA-256 mismatch on bucket '${bucket}'`,
            checkedAt: new Date().toISOString(),
          };
        }
      }

      const overallSuccess =
        opts?.verifyReadWrite === false ? true : Boolean(writeVerified && readVerified && roundtripSha256Match);
      const preflightReady = Boolean(overallSuccess && objectExists === true);
      const latencyMs = Math.max(1, Date.now() - started);

      AuditLedger.append('SYSTEM', 'CLOUD_OBJECT_STORAGE_CONNECTION_TESTED', {
        bucket,
        region,
        endpoint: validatedEndpoint || null,
        bucketReachable: true,
        readVerified,
        writeVerified,
        roundtripSha256Match,
        objectExists,
        preflightReady,
        latencyMs,
      });

      AuditLedger.emitWorkflowEvent({
        source: 'cloud_preflight',
        tag: preflightReady ? 'INIT' : 'PLANNER',
        isRunning: false,
        message: preflightReady
          ? `Cloud Preflight passed (${latencyMs} ms): bucket '${bucket}' R/W SHA-256 verified and checkpoint '${checkpointKey}' ready (${objectSizeBytes ?? 0} bytes)`
          : `Cloud Preflight R/W probe passed (${latencyMs} ms), but checkpoint '${checkpointKey}' is not present in bucket '${bucket}' yet (objectExists=${String(objectExists)})`,
      });

      return {
        success: overallSuccess,
        preflightReady,
        validConfig: true,
        bucketReachable: true,
        readVerified,
        writeVerified,
        cleanupVerified,
        roundtripSha256Match,
        objectExists,
        objectSizeBytes,
        bucket,
        region,
        endpoint: validatedEndpoint || null,
        checkpointKey,
        forcePathStyle,
        httpStatusCode,
        latencyMs,
        probeKey,
        probeSha256,
        artifacts,
        errorCode: null,
        errorMessage:
          objectExists === false
            ? `Bucket '${bucket}' read/write verified, but target checkpoint '${checkpointKey}' does not exist yet (404).`
            : null,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode ?? httpStatusCode;
      const errCode = String(err?.name || err?.Code || err?.code || 'S3_CONNECTION_ERROR');
      const errMsg = String(err?.message || err);
      const bucketReachable = Boolean(httpStatusCode && httpStatusCode < 400);
      const formattedErr = bucketReachable
        ? `Bucket '${bucket}' reachable, but read/write probe failed (${errCode}): ${errMsg}`
        : status
          ? `Bucket '${bucket}' failed with HTTP ${status} (${errCode}): ${errMsg}`
          : `Bucket '${bucket}' connection error (${errCode}): ${errMsg}`;

      AuditLedger.append('SYSTEM', 'CLOUD_OBJECT_STORAGE_CONNECTION_FAILED', {
        bucket,
        region,
        endpoint: validatedEndpoint || null,
        bucketReachable,
        readVerified,
        writeVerified,
        errorCode: errCode,
        httpStatusCode: status,
      });

      AuditLedger.emitWorkflowEvent({
        source: 'cloud_preflight',
        tag: 'ERROR',
        isRunning: false,
        message: `FAIL_CLOSED: Cloud Preflight failed — ${formattedErr}`,
      });

      return {
        success: false,
        preflightReady: false,
        validConfig: true,
        bucketReachable,
        readVerified,
        writeVerified,
        cleanupVerified,
        roundtripSha256Match: false,
        objectExists,
        objectSizeBytes,
        bucket,
        region,
        endpoint: validatedEndpoint || null,
        checkpointKey,
        forcePathStyle,
        httpStatusCode: status,
        latencyMs: Math.max(1, Date.now() - started),
        probeKey,
        probeSha256,
        artifacts,
        errorCode: errCode,
        errorMessage: formattedErr,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      if (typeof client.destroy === 'function') {
        client.destroy();
      }
    }
  }

  public static async readCheckpointArtifact(opts?: {
    objectKey?: string;
    presignedUrl?: string;
    timeoutMs?: number;
  }): Promise<CloudCheckpointArtifactReadResult> {
    const started = Date.now();
    const norm = hydrateCloudRuntimeEnv();
    const presignedUrl = cleanValue(opts?.presignedUrl) || norm.CHECKPOINT_PRESIGNED_URL || '';
    const objectKey = cleanValue(opts?.objectKey) || norm.S3_CHECKPOINT_KEY || 'checkpoints/model_checkpoint.pt';
    const timeoutMs = opts?.timeoutMs ?? 60_000;

    // Prefer explicit presignedUrl if passed, otherwise S3 if configured, otherwise env CHECKPOINT_PRESIGNED_URL
    if (cleanValue(opts?.presignedUrl) || (!isCloudCheckpointStorageConfigured() && presignedUrl)) {
      const safeUrl = validateSafeExternalUrl('CHECKPOINT_PRESIGNED_URL', presignedUrl);
      const res = await fetch(safeUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'ZYNTHEOR-CloudObjectStorage/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`FAIL_CLOSED: Cloud checkpoint GET failed with HTTP ${res.status} ${res.statusText}`);
      }
      const arr = await res.arrayBuffer();
      const buffer = Buffer.from(arr);
      return {
        buffer,
        sourceUri: safeUrl,
        provider: 'presigned_url',
        byteSize: buffer.length,
        fetchLatencyMs: Math.max(1, Date.now() - started),
        httpStatusCode: res.status,
        etag: res.headers.get('etag'),
      };
    }

    const bucket = norm.S3_BUCKET || '';
    const accessKeyId = norm.S3_ACCESS_KEY_ID || '';
    const secretAccessKey = norm.S3_SECRET_ACCESS_KEY || '';
    if (!bucket || !accessKeyId || !secretAccessKey) {
      const cfg = validateCloudRuntimeConfig();
      throw new Error(
        `FAIL_CLOSED: Cloud Object Storage not configured (${cfg.missingKeys.join(', ') || 'missing bucket/credentials'}).`
      );
    }

    const endpointRaw = norm.S3_ENDPOINT || '';
    const validatedEndpoint = endpointRaw ? validateSafeExternalUrl('S3_ENDPOINT', endpointRaw) : undefined;
    const region = norm.S3_REGION || (validatedEndpoint ? 'auto' : 'us-east-1');
    const forcePathStyle = String(norm.S3_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true';

    const client = CloudObjectStorageService.clientFactory({
      region,
      endpoint: validatedEndpoint,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
    });

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
        }),
        { abortSignal: AbortSignal.timeout(timeoutMs) }
      );
      const buffer = await bodyToBuffer(response?.Body);
      return {
        buffer,
        sourceUri: `s3://${bucket}/${objectKey}`,
        provider: 's3',
        byteSize: buffer.length,
        fetchLatencyMs: Math.max(1, Date.now() - started),
        httpStatusCode: response?.$metadata?.httpStatusCode ?? 200,
        etag: response?.ETag ? String(response.ETag) : null,
      };
    } finally {
      if (typeof client.destroy === 'function') {
        client.destroy();
      }
    }
  }

  public static async writeCheckpointArtifact(
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
    containerSha256: string;
    totalParams: number;
    byteSize: number;
    httpStatus?: number;
  }> {
    const parsed: ParsedCloudCheckpoint = parseCheckpointBuffer(buffer, opts?.objectKey || 'memory-buffer');
    const res = await publishCheckpointBufferToCloud(buffer, opts);
    return {
      ...res,
      containerSha256: parsed.containerSha256,
    };
  }

  public static async uploadTrainingTelemetryObject(
    objectKey: string,
    payload: string | Buffer,
    contentType: string = 'application/json'
  ): Promise<{
    sourceUri: string;
    sha256: string;
    byteSize: number;
    httpStatusCode: number | null;
  }> {
    const norm = hydrateCloudRuntimeEnv();
    const bucket = norm.S3_BUCKET || '';
    const accessKeyId = norm.S3_ACCESS_KEY_ID || '';
    const secretAccessKey = norm.S3_SECRET_ACCESS_KEY || '';
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('FAIL_CLOSED: S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required for cloud telemetry sync.');
    }
    const endpointRaw = norm.S3_ENDPOINT || '';
    const validatedEndpoint = endpointRaw ? validateSafeExternalUrl('S3_ENDPOINT', endpointRaw) : undefined;
    const region = norm.S3_REGION || (validatedEndpoint ? 'auto' : 'us-east-1');
    const forcePathStyle = String(norm.S3_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true';
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');

    const client = CloudObjectStorageService.clientFactory({
      region,
      endpoint: validatedEndpoint,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
    });
    try {
      const putRes = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
          Metadata: { 'zyntheor-sha256': sha256 },
        }),
        { abortSignal: AbortSignal.timeout(10_000) }
      );
      return {
        sourceUri: `s3://${bucket}/${objectKey}`,
        sha256,
        byteSize: body.length,
        httpStatusCode: putRes?.$metadata?.httpStatusCode ?? 200,
      };
    } finally {
      if (typeof client.destroy === 'function') {
        client.destroy();
      }
    }
  }

  public static async listCheckpointArtifacts(prefix = 'checkpoints/', maxKeys = 50): Promise<BucketArtifactSummary[]> {
    const norm = hydrateCloudRuntimeEnv();
    const bucket = norm.S3_BUCKET || '';
    const accessKeyId = norm.S3_ACCESS_KEY_ID || '';
    const secretAccessKey = norm.S3_SECRET_ACCESS_KEY || '';
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('FAIL_CLOSED: S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required to list bucket artifacts.');
    }
    const endpointRaw = norm.S3_ENDPOINT || '';
    const validatedEndpoint = endpointRaw ? validateSafeExternalUrl('S3_ENDPOINT', endpointRaw) : undefined;
    const region = norm.S3_REGION || (validatedEndpoint ? 'auto' : 'us-east-1');
    const forcePathStyle = String(norm.S3_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true';

    const client = CloudObjectStorageService.clientFactory({
      region,
      endpoint: validatedEndpoint,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
    });

    try {
      const listRes = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        }),
        { abortSignal: AbortSignal.timeout(8000) }
      );
      const out: BucketArtifactSummary[] = [];
      for (const item of listRes?.Contents || []) {
        if (!item?.Key) continue;
        out.push({
          key: String(item.Key),
          sizeBytes: Number(item.Size ?? 0),
          lastModified: item.LastModified ? new Date(item.LastModified).toISOString() : null,
          etag: item.ETag ? String(item.ETag) : null,
        });
      }
      return out;
    } finally {
      if (typeof client.destroy === 'function') {
        client.destroy();
      }
    }
  }

  /**
   * Dedicated Cloud Preflight gate executed prior to initiating training:
   * 1. Validates AWS S3 storage credentials & endpoint configuration.
   * 2. Verifies S3 bucket availability (HeadBucket).
   * 3. Verifies target checkpoint object exists (HeadObject) and is actively readable (Range GetObject).
   * 4. Optionally verifies bucket read/write permissions (PutObject -> GetObject SHA-256 -> DeleteObject).
   */
  public static async runCloudPreflight(opts?: {
    objectKey?: string;
    verifyReadWrite?: boolean;
    overrides?: CloudStorageEndpointConfigInput;
    silent?: boolean;
  }): Promise<CloudPreflightReport> {
    const started = Date.now();
    const silent = Boolean(opts?.silent);
    const norm = hydrateCloudRuntimeEnv();
    const pick = (overrideVal: string | boolean | undefined, envKey: AllowedCloudConfigKey): string => {
      if (overrideVal !== undefined) {
        const cleaned = cleanValue(overrideVal);
        if (cleaned && !cleaned.includes('••••')) {
          return cleaned;
        }
      }
      return cleanValue(norm[envKey] ?? process.env[envKey]);
    };

    const bucket = pick(opts?.overrides?.S3_BUCKET, 'S3_BUCKET');
    const endpointRaw = pick(opts?.overrides?.S3_ENDPOINT, 'S3_ENDPOINT');
    const region = pick(opts?.overrides?.S3_REGION, 'S3_REGION') || (endpointRaw ? 'auto' : 'us-east-1');
    const accessKeyId = pick(opts?.overrides?.S3_ACCESS_KEY_ID, 'S3_ACCESS_KEY_ID');
    const secretAccessKey = pick(opts?.overrides?.S3_SECRET_ACCESS_KEY, 'S3_SECRET_ACCESS_KEY');
    const checkpointKey =
      cleanValue(opts?.objectKey) ||
      pick(opts?.overrides?.S3_CHECKPOINT_KEY, 'S3_CHECKPOINT_KEY') ||
      'checkpoints/model_checkpoint.pt';
    const forcePathStyleRaw =
      opts?.overrides?.S3_FORCE_PATH_STYLE !== undefined
        ? String(opts.overrides.S3_FORCE_PATH_STYLE)
        : norm.S3_FORCE_PATH_STYLE || process.env.S3_FORCE_PATH_STYLE || 'false';
    const forcePathStyle = forcePathStyleRaw.toLowerCase() === 'true';

    const missingCredentials: string[] = [];
    if (!bucket) missingCredentials.push('S3_BUCKET');
    if (!accessKeyId) missingCredentials.push('S3_ACCESS_KEY_ID');
    if (!secretAccessKey) missingCredentials.push('S3_SECRET_ACCESS_KEY');
    if (!region) missingCredentials.push('S3_REGION');

    if (!silent) {
      AuditLedger.emitWorkflowEvent({
        source: 'cloud_preflight',
        tag: 'INIT',
        goal: `Production Integration · Cloud Preflight (${checkpointKey})`,
        resetLogs: true,
        isRunning: true,
        message: `Cloud Preflight: validating AWS S3 credentials, bucket '${bucket || 'UNSET'}', and checkpoint '${checkpointKey}' accessibility`,
      });
    }

    let validatedEndpoint: string | undefined;
    if (endpointRaw) {
      try {
        validatedEndpoint = validateSafeExternalUrl('S3_ENDPOINT', endpointRaw);
      } catch (err: any) {
        const errMsg = err?.message || 'Invalid S3_ENDPOINT URL';
        if (!silent) {
          AuditLedger.append('SYSTEM', 'CLOUD_PREFLIGHT_BLOCKED', {
            bucket: bucket || null,
            checkpointKey,
            reason: errMsg,
          });
          AuditLedger.emitWorkflowEvent({
            source: 'cloud_preflight',
            tag: 'ERROR',
            isRunning: false,
            message: `FAIL_CLOSED: Cloud Preflight invalid S3 endpoint — ${errMsg}`,
          });
        }
        return {
          passed: false,
          status: 'PREFLIGHT_BLOCKED',
          checks: {
            credentialsValid: false,
            bucketAvailable: false,
            checkpointExists: false,
            checkpointAccessible: false,
            readWriteVerified: false,
          },
          bucket: bucket || null,
          region,
          endpoint: endpointRaw,
          checkpointKey,
          checkpointSizeBytes: null,
          checkpointETag: null,
          checkpointLastModified: null,
          headerMagicValid: null,
          httpStatusCode: null,
          missingCredentials,
          blockers: ['invalid_s3_endpoint'],
          error: errMsg,
          latencyMs: Math.max(1, Date.now() - started),
          checkedAt: new Date().toISOString(),
        };
      }
    }

    if (missingCredentials.length > 0) {
      const errMsg = `Missing required AWS S3 storage credentials: ${missingCredentials.join(', ')}`;
      if (!silent) {
        AuditLedger.append('SYSTEM', 'CLOUD_PREFLIGHT_BLOCKED', {
          bucket: bucket || null,
          checkpointKey,
          missingCredentials,
        });
        AuditLedger.emitWorkflowEvent({
          source: 'cloud_preflight',
          tag: 'ERROR',
          isRunning: false,
          message: `FAIL_CLOSED: Cloud Preflight blocked — ${errMsg}`,
        });
      }
      return {
        passed: false,
        status: 'PREFLIGHT_BLOCKED',
        checks: {
          credentialsValid: false,
          bucketAvailable: false,
          checkpointExists: false,
          checkpointAccessible: false,
          readWriteVerified: false,
        },
        bucket: bucket || null,
        region,
        endpoint: validatedEndpoint || null,
        checkpointKey,
        checkpointSizeBytes: null,
        checkpointETag: null,
        checkpointLastModified: null,
        headerMagicValid: null,
        httpStatusCode: null,
        missingCredentials,
        blockers: ['missing_s3_credentials'],
        error: errMsg,
        latencyMs: Math.max(1, Date.now() - started),
        checkedAt: new Date().toISOString(),
      };
    }

    const client = CloudObjectStorageService.clientFactory({
      region,
      endpoint: validatedEndpoint,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
    });

    let bucketAvailable = false;
    let checkpointExists = false;
    let checkpointAccessible = false;
    let readWriteVerified = opts?.verifyReadWrite === false;
    let checkpointSizeBytes: number | null = null;
    let checkpointETag: string | null = null;
    let checkpointLastModified: string | null = null;
    let headerMagicValid: boolean | null = null;
    let httpStatusCode: number | null = null;
    const blockers: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Validate Bucket Availability
      try {
        const headBucketRes = await client.send(new HeadBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(6000),
        });
        httpStatusCode = headBucketRes?.$metadata?.httpStatusCode ?? 200;
        bucketAvailable = true;
      } catch (bucketErr: any) {
        httpStatusCode = bucketErr?.$metadata?.httpStatusCode ?? null;
        const msg = String(bucketErr?.message || bucketErr);
        blockers.push('s3_bucket_unavailable');
        errors.push(`Bucket '${bucket}' unavailable (${bucketErr?.name || 'HeadBucketError'}): ${msg}`);
      }

      // 2. Verify Checkpoint File Exists & Is Accessible
      if (bucketAvailable) {
        try {
          const headObjRes = await client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: checkpointKey }),
            { abortSignal: AbortSignal.timeout(5000) }
          );
          checkpointExists = true;
          checkpointSizeBytes = typeof headObjRes?.ContentLength === 'number' ? headObjRes.ContentLength : null;
          checkpointETag = headObjRes?.ETag ? String(headObjRes.ETag) : null;
          checkpointLastModified = headObjRes?.LastModified ? new Date(headObjRes.LastModified).toISOString() : null;
        } catch (headErr: any) {
          const st = headErr?.$metadata?.httpStatusCode;
          if (st === 404 || headErr?.name === 'NotFound' || headErr?.name === 'NoSuchKey') {
            blockers.push(`checkpoint_object_not_found:${checkpointKey}`);
            errors.push(`Checkpoint object '${checkpointKey}' does not exist in bucket '${bucket}' (404).`);
          } else {
            blockers.push(`checkpoint_head_failed:${checkpointKey}`);
            errors.push(`Checkpoint stat failed for '${checkpointKey}': ${headErr?.message || headErr}`);
          }
        }

        if (checkpointExists) {
          if (checkpointSizeBytes !== null && checkpointSizeBytes <= 0) {
            blockers.push(`checkpoint_object_empty:${checkpointKey}`);
            errors.push(`Checkpoint object '${checkpointKey}' is empty (0 bytes).`);
          } else {
            try {
              const rangeGetRes = await client.send(
                new GetObjectCommand({
                  Bucket: bucket,
                  Key: checkpointKey,
                  Range: 'bytes=0-20',
                }),
                { abortSignal: AbortSignal.timeout(6000) }
              );
              const sampleBytes = await bodyToBuffer(rangeGetRes?.Body);
              if (sampleBytes.length > 0) {
                checkpointAccessible = true;
                if (sampleBytes.length >= 17) {
                  headerMagicValid = sampleBytes.subarray(0, 17).toString('utf8') === 'ZYNTHEOR_QPLUS_PT';
                }
              } else {
                blockers.push(`checkpoint_not_accessible:${checkpointKey}`);
                errors.push(`Checkpoint '${checkpointKey}' returned 0 readable bytes.`);
              }
            } catch (getErr: any) {
              blockers.push(`checkpoint_not_accessible:${checkpointKey}`);
              errors.push(`Checkpoint '${checkpointKey}' is not readable/accessible: ${getErr?.message || getErr}`);
            }
          }
        }

        // 3. Optional Read/Write Probe (verifies training can persist checkpoint artifacts back to bucket)
        if (opts?.verifyReadWrite !== false) {
          const nonce = crypto.randomUUID();
          const probeKey = `.zyntheor-probes/preflight-rw-${nonce}.bin`;
          const probePayload = Buffer.from(
            JSON.stringify({ service: 'zyntheor-cloud-preflight', nonce, ts: new Date().toISOString() }),
            'utf8'
          );
          const expectedSha = crypto.createHash('sha256').update(probePayload).digest('hex');
          try {
            await client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: probeKey,
                Body: probePayload,
                ContentType: 'application/octet-stream',
              }),
              { abortSignal: AbortSignal.timeout(6000) }
            );
            const getProbe = await client.send(
              new GetObjectCommand({ Bucket: bucket, Key: probeKey }),
              { abortSignal: AbortSignal.timeout(6000) }
            );
            const downloaded = await bodyToBuffer(getProbe?.Body);
            const actualSha = crypto.createHash('sha256').update(downloaded).digest('hex');
            readWriteVerified = actualSha === expectedSha && Buffer.compare(downloaded, probePayload) === 0;
            if (!readWriteVerified) {
              blockers.push('s3_rw_probe_sha256_mismatch');
              errors.push(`Bucket '${bucket}' R/W probe SHA-256 mismatch.`);
            }
          } catch (rwErr: any) {
            readWriteVerified = false;
            blockers.push('s3_rw_probe_failed');
            errors.push(`Bucket '${bucket}' read/write probe failed: ${rwErr?.message || rwErr}`);
          } finally {
            await client
              .send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey }), {
                abortSignal: AbortSignal.timeout(5000),
              })
              .catch(() => null);
          }
        }
      }

      const passed = Boolean(
        bucketAvailable &&
          checkpointExists &&
          checkpointAccessible &&
          (opts?.verifyReadWrite === false || readWriteVerified) &&
          blockers.length === 0
      );
      const latencyMs = Math.max(1, Date.now() - started);
      const errorMsg = errors.length > 0 ? errors.join(' | ') : null;

      if (!silent) {
        AuditLedger.append('SYSTEM', passed ? 'CLOUD_PREFLIGHT_VERIFIED' : 'CLOUD_PREFLIGHT_BLOCKED', {
          bucket,
          region,
          endpoint: validatedEndpoint || null,
          checkpointKey,
          passed,
          bucketAvailable,
          checkpointExists,
          checkpointAccessible,
          readWriteVerified,
          checkpointSizeBytes,
          headerMagicValid,
          blockers,
          latencyMs,
        });

        AuditLedger.emitWorkflowEvent({
          source: 'cloud_preflight',
          tag: passed ? 'INIT' : 'ERROR',
          isRunning: false,
          message: passed
            ? `Cloud Preflight PASSED (${latencyMs} ms): AWS S3 credentials valid, bucket '${bucket}' available, checkpoint '${checkpointKey}' accessible (${checkpointSizeBytes ?? '—'} bytes)`
            : `FAIL_CLOSED: Cloud Preflight blocked — ${errorMsg || blockers.join(', ')}`,
        });
      }

      return {
        passed,
        status: passed ? 'PREFLIGHT_PASS' : 'PREFLIGHT_BLOCKED',
        checks: {
          credentialsValid: true,
          bucketAvailable,
          checkpointExists,
          checkpointAccessible,
          readWriteVerified,
        },
        bucket,
        region,
        endpoint: validatedEndpoint || null,
        checkpointKey,
        checkpointSizeBytes,
        checkpointETag,
        checkpointLastModified,
        headerMagicValid,
        httpStatusCode,
        missingCredentials: [],
        blockers,
        error: errorMsg,
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      if (typeof client.destroy === 'function') {
        client.destroy();
      }
    }
  }
}

export async function runCloudPreflight(opts?: {
  objectKey?: string;
  verifyReadWrite?: boolean;
  overrides?: CloudStorageEndpointConfigInput;
  silent?: boolean;
}): Promise<CloudPreflightReport> {
  return CloudObjectStorageService.runCloudPreflight(opts);
}
