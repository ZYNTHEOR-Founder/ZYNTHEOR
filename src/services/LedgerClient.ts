/**
 * ZYNTHEOR LedgerClient Service
 *
 * Browser-safe client communicating directly with the server's SQLite-backed
 * `LedgerService` instance via `/api/ledger/*` endpoints.
 * Shares exact TypeScript contracts with `src/services/LedgerService.ts`.
 */

import { getStoredAuthHeaders } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';
import type {
  LedgerBalanceSummary,
  LedgerCategorySort,
  LedgerQueryFilter,
  LedgerRecord,
  LedgerRecordInput,
  LedgerSummary,
  LedgerThresholdStatus,
} from './LedgerService';

export type {
  LedgerBalanceSummary,
  LedgerCategoryBreakdown,
  LedgerCategorySort,
  LedgerQueryFilter,
  LedgerRecord,
  LedgerRecordInput,
  LedgerRecordType,
  LedgerSummary,
  LedgerThresholdLevel,
  LedgerThresholdStatus,
  LedgerTimelinePoint,
} from './LedgerService';

export interface LedgerSummaryQueryOptions {
  limit?: number;
  currency?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: LedgerCategorySort;
}

export class LedgerClient {
  private static instance: LedgerClient | null = null;

  public static getInstance(): LedgerClient {
    if (!LedgerClient.instance) {
      LedgerClient.instance = new LedgerClient();
    }
    return LedgerClient.instance;
  }

  public async getSummary(options: LedgerSummaryQueryOptions | number = 20): Promise<LedgerSummary> {
    const opts: LedgerSummaryQueryOptions =
      typeof options === 'number' ? { limit: options } : options;
    const qs = new URLSearchParams();
    qs.set('limit', String(opts.limit ?? 20));
    if (opts.currency) qs.set('currency', opts.currency);
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    if (opts.sortBy) qs.set('sortBy', opts.sortBy);

    const res = await fetch(apiUrl(`/api/ledger/summary?${qs.toString()}`), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.summary) {
      throw new Error(data.error || `Failed to load ledger summary (HTTP ${res.status})`);
    }
    return data.summary as LedgerSummary;
  }

  public async getBalance(options: { currency?: string; fromDate?: string; toDate?: string } = {}): Promise<LedgerBalanceSummary> {
    const qs = new URLSearchParams();
    if (options.currency) qs.set('currency', options.currency);
    if (options.fromDate) qs.set('fromDate', options.fromDate);
    if (options.toDate) qs.set('toDate', options.toDate);
    const query = qs.toString();
    const res = await fetch(apiUrl(`/api/ledger/balance${query ? `?${query}` : ''}`), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.balance) {
      throw new Error(data.error || `Failed to load ledger balance (HTTP ${res.status})`);
    }
    return data.balance as LedgerBalanceSummary;
  }

  public async getRecords(filter: LedgerQueryFilter = {}): Promise<LedgerRecord[]> {
    const qs = new URLSearchParams();
    if (filter.type) qs.set('type', filter.type);
    if (filter.currency) qs.set('currency', filter.currency);
    if (filter.category) qs.set('category', filter.category);
    if (filter.fromDate) qs.set('fromDate', filter.fromDate);
    if (filter.toDate) qs.set('toDate', filter.toDate);
    if (filter.limit) qs.set('limit', String(filter.limit));
    if (filter.offset) qs.set('offset', String(filter.offset));
    const query = qs.toString();
    const res = await fetch(apiUrl(`/api/ledger/records${query ? `?${query}` : ''}`), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load ledger records (HTTP ${res.status})`);
    }
    return (data.records || []) as LedgerRecord[];
  }

  public async insertRecord(
    input: LedgerRecordInput,
    refreshOptions?: LedgerSummaryQueryOptions
  ): Promise<{ record: LedgerRecord; summary: LedgerSummary }> {
    const qs = new URLSearchParams();
    if (refreshOptions?.currency) qs.set('currency', refreshOptions.currency);
    if (refreshOptions?.fromDate) qs.set('fromDate', refreshOptions.fromDate);
    if (refreshOptions?.toDate) qs.set('toDate', refreshOptions.toDate);
    if (refreshOptions?.sortBy) qs.set('sortBy', refreshOptions.sortBy);
    const query = qs.toString();

    const res = await fetch(apiUrl(`/api/ledger/records${query ? `?${query}` : ''}`), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.record) {
      throw new Error(data.error || `Failed to insert ledger record (HTTP ${res.status})`);
    }
    return {
      record: data.record as LedgerRecord,
      summary: data.summary as LedgerSummary,
    };
  }

  public async deleteRecord(
    id: string,
    refreshOptions?: LedgerSummaryQueryOptions
  ): Promise<{ deleted: boolean; summary: LedgerSummary }> {
    const qs = new URLSearchParams();
    if (refreshOptions?.currency) qs.set('currency', refreshOptions.currency);
    if (refreshOptions?.fromDate) qs.set('fromDate', refreshOptions.fromDate);
    if (refreshOptions?.toDate) qs.set('toDate', refreshOptions.toDate);
    if (refreshOptions?.sortBy) qs.set('sortBy', refreshOptions.sortBy);
    const query = qs.toString();

    const res = await fetch(apiUrl(`/api/ledger/records/${encodeURIComponent(id)}${query ? `?${query}` : ''}`), {
      method: 'DELETE',
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to delete ledger record (HTTP ${res.status})`);
    }
    return {
      deleted: Boolean(data.deleted),
      summary: data.summary as LedgerSummary,
    };
  }

  public async setBudgetLimit(
    budgetLimit: number,
    warningRatio?: number,
    refreshOptions?: LedgerSummaryQueryOptions
  ): Promise<{ threshold: LedgerThresholdStatus; summary: LedgerSummary }> {
    const qs = new URLSearchParams();
    if (refreshOptions?.currency) qs.set('currency', refreshOptions.currency);
    if (refreshOptions?.fromDate) qs.set('fromDate', refreshOptions.fromDate);
    if (refreshOptions?.toDate) qs.set('toDate', refreshOptions.toDate);
    if (refreshOptions?.sortBy) qs.set('sortBy', refreshOptions.sortBy);
    const query = qs.toString();

    const res = await fetch(apiUrl(`/api/ledger/threshold${query ? `?${query}` : ''}`), {
      method: 'PUT',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({ budgetLimit, warningRatio }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.threshold) {
      throw new Error(data.error || `Failed to update budget threshold (HTTP ${res.status})`);
    }
    return {
      threshold: data.threshold as LedgerThresholdStatus,
      summary: data.summary as LedgerSummary,
    };
  }
}
