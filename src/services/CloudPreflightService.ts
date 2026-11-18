import { apiUrl } from '../lib/apiClient';
import type { CloudPreflightReport, StatusLevel } from '../types';

export type { CloudPreflightReport };

export interface CommandCenterPreflightStatus {
  name: string;
  detail: string;
  status: StatusLevel;
  evidence: string;
  report: CloudPreflightReport | null;
}

export interface RunCloudPreflightOptions {
  objectKey?: string;
  verifyReadWrite?: boolean;
  headers?: Record<string, string>;
  fetcher?: typeof fetch;
}

export class CloudPreflightService {
  private static instance: CloudPreflightService | null = null;
  private lastReport: CloudPreflightReport | null = null;
  private listeners = new Set<(report: CloudPreflightReport | null) => void>();

  private constructor() {}

  public static getInstance(): CloudPreflightService {
    if (!CloudPreflightService.instance) {
      CloudPreflightService.instance = new CloudPreflightService();
    }
    return CloudPreflightService.instance;
  }

  public getLastReport(): CloudPreflightReport | null {
    return this.lastReport;
  }

  public syncFromSystemStatus(report?: CloudPreflightReport | null): void {
    if (!report) return;
    if (!this.lastReport || report.checkedAt >= this.lastReport.checkedAt) {
      this.lastReport = report;
      this.emit();
    }
  }

  public subscribe(listener: (report: CloudPreflightReport | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.lastReport);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.lastReport);
    }
  }

  /**
   * Validates AWS S3 storage credentials, bucket availability, and 41.5M checkpoint existence
   * via backend Cloud Object Storage preflight endpoints (fail-closed; zero client-side secrets).
   */
  public async runPreflightCheck(opts: RunCloudPreflightOptions = {}): Promise<CloudPreflightReport> {
    const doFetch = opts.fetcher || fetch;
    const hasAuthHeader = Boolean(
      opts.headers && Object.keys(opts.headers).some((k) => k.toLowerCase() === 'authorization' && opts.headers![k])
    );

    try {
      let res: Response;
      if (hasAuthHeader) {
        res = await doFetch(apiUrl('/api/storage/preflight'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...opts.headers,
          },
          body: JSON.stringify({
            objectKey: opts.objectKey?.trim() || undefined,
            verifyReadWrite: opts.verifyReadWrite !== false,
          }),
          cache: 'no-store',
        });
      } else {
        const qs = opts.objectKey?.trim()
          ? `?objectKey=${encodeURIComponent(opts.objectKey.trim())}`
          : '';
        res = await doFetch(apiUrl(`/api/storage/preflight${qs}`), {
          method: 'GET',
          cache: 'no-store',
        });
      }

      const data = await res.json().catch(() => ({}));
      if (data?.report) {
        this.lastReport = data.report as CloudPreflightReport;
        this.emit();
        return this.lastReport;
      }

      const failReport: CloudPreflightReport = {
        passed: false,
        status: 'PREFLIGHT_BLOCKED',
        checks: {
          credentialsValid: false,
          bucketAvailable: false,
          checkpointExists: false,
          checkpointAccessible: false,
          readWriteVerified: false,
        },
        bucket: null,
        region: 'us-east-1',
        endpoint: null,
        checkpointKey: opts.objectKey?.trim() || 'checkpoints/model_checkpoint.pt',
        checkpointSizeBytes: null,
        checkpointETag: null,
        checkpointLastModified: null,
        headerMagicValid: null,
        httpStatusCode: res.status || null,
        missingCredentials: [],
        blockers: ['preflight_endpoint_error'],
        error: data?.error || `Cloud Preflight check failed (HTTP ${res.status})`,
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      };
      this.lastReport = failReport;
      this.emit();
      return failReport;
    } catch (err: any) {
      const failReport: CloudPreflightReport = {
        passed: false,
        status: 'PREFLIGHT_BLOCKED',
        checks: {
          credentialsValid: false,
          bucketAvailable: false,
          checkpointExists: false,
          checkpointAccessible: false,
          readWriteVerified: false,
        },
        bucket: null,
        region: 'us-east-1',
        endpoint: null,
        checkpointKey: opts.objectKey?.trim() || 'checkpoints/model_checkpoint.pt',
        checkpointSizeBytes: null,
        checkpointETag: null,
        checkpointLastModified: null,
        headerMagicValid: null,
        httpStatusCode: null,
        missingCredentials: [],
        blockers: ['preflight_network_unreachable'],
        error: err?.message || 'Unable to contact Cloud Preflight endpoint',
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      };
      this.lastReport = failReport;
      this.emit();
      return failReport;
    }
  }

  public static toCommandCenterCheck(report?: CloudPreflightReport | null): CommandCenterPreflightStatus {
    if (!report) {
      return {
        name: 'Cloud Preflight (S3 & 41.5M Checkpoint)',
        detail: 'Awaiting Cloud Preflight check',
        status: 'UNVERIFIED',
        evidence: 'Run /api/system/status or Cloud Preflight to validate AWS S3 credentials, bucket, and 41.5M checkpoint file.',
        report: null,
      };
    }

    const { checks } = report;
    const summaryParts = [
      `Creds: ${checks.credentialsValid ? 'OK' : 'MISSING'}`,
      `Bucket: ${checks.bucketAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`,
      `41.5M File: ${checks.checkpointExists && checks.checkpointAccessible ? 'EXISTS & READABLE' : checks.checkpointExists ? 'UNREADABLE' : 'MISSING'}`,
    ];

    return {
      name: 'Cloud Preflight (S3 & 41.5M Checkpoint)',
      detail: `${report.status} · ${summaryParts.join(' · ')}`,
      status: report.passed ? 'VERIFIED' : 'BLOCKED',
      evidence: report.passed
        ? `s3://${report.bucket}/${report.checkpointKey} (${report.checkpointSizeBytes ?? '—'} bytes, magic=${String(report.headerMagicValid)}, ${report.latencyMs}ms)`
        : report.error ||
          (report.missingCredentials.length > 0
            ? `Missing AWS S3 credentials: ${report.missingCredentials.join(', ')}`
            : `Blocked: ${report.blockers.join(', ') || 'preflight_failed'}`),
      report,
    };
  }
}

export const cloudPreflightService = CloudPreflightService.getInstance();
