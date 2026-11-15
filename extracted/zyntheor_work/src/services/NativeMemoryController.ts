/**
 * ZYNTHEOR Sovereign NativeMemoryController Service
 * Handles episodic memory storage in native_data/memory_store.json.
 * Provides complete CRUD methods for memory retrieval, creation, update, and deletion.
 * Every write operation is permanently recorded as a transaction in the SystemAuditLedger with SHA-256 digests.
 */

import { getStoredAuthHeaders } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';

export interface EpisodicMemoryItem {
  key: string;
  value: any;
  category: 'episodic' | 'semantic' | 'user_preference' | 'reasoning_trace' | string;
  createdAt: string;
  updatedAt: string;
  readCount: number;
  tenantId?: string;
  ownerUserId?: string;
  version?: number;
  ttlSeconds?: number;
  expiresAt?: string;
  history?: Array<{ version: number; updatedAt: string; contentDigest: string }>;
  metadata?: Record<string, any>;
  contentDigest: string; // SHA-256 digest of value
}

export interface MemoryStats {
  totalItems: number;
  totalCategories: Record<string, number>;
  storeSizeBytes: number;
  lastPersisted: string;
}

export interface MemoryIntegrityReport {
  valid: boolean;
  totalItems: number;
  corruptedKeys: string[];
  expiredPurgedCount: number;
  storeSha256: string;
  checkedAt: string;
}

export class NativeMemoryControllerService {
  private static instance: NativeMemoryControllerService | null = null;

  public static getInstance(): NativeMemoryControllerService {
    if (!NativeMemoryControllerService.instance) {
      NativeMemoryControllerService.instance = new NativeMemoryControllerService();
    }
    return NativeMemoryControllerService.instance;
  }

  /**
   * CREATE: Stores a new episodic memory item in native_data/memory_store.json.
   * Records a MEMORY_WRITE_OP transaction into SystemAuditLedger.
   */
  public async createMemory(
    key: string,
    value: any,
    category: string = 'episodic',
    metadata?: Record<string, any>,
    ttlSeconds?: number
  ): Promise<EpisodicMemoryItem> {
    const res = await fetch(apiUrl('/api/memory/episodic'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({ key, value, category, metadata, ttlSeconds })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to create episodic memory');
    }
    return data.item;
  }

  /**
   * READ: Retrieves an episodic memory item by key.
   * Increments readCount and records a MEMORY_READ_OP audit event.
   */
  public async retrieveMemory(key: string): Promise<EpisodicMemoryItem | null> {
    const res = await fetch(apiUrl(`/api/memory/episodic/${encodeURIComponent(key)}`), {
      headers: getStoredAuthHeaders()
    });
    if (res.status === 404) return null;
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to retrieve episodic memory');
    }
    return data.item;
  }

  /**
   * UPDATE: Updates an existing episodic memory item.
   * Computes new SHA-256 digest and records a MEMORY_UPDATE_OP transaction into SystemAuditLedger.
   */
  public async updateMemory(
    key: string,
    value: any,
    category?: string,
    metadata?: Record<string, any>,
    ttlSeconds?: number
  ): Promise<EpisodicMemoryItem> {
    const res = await fetch(apiUrl(`/api/memory/episodic/${encodeURIComponent(key)}`), {
      method: 'PUT',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({ value, category, metadata, ttlSeconds })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to update episodic memory');
    }
    return data.item;
  }

  /**
   * DELETE: Removes an episodic memory key from disk.
   * Records a MEMORY_DELETE_OP transaction into SystemAuditLedger.
   */
  public async deleteMemory(key: string): Promise<boolean> {
    const res = await fetch(apiUrl(`/api/memory/episodic/${encodeURIComponent(key)}`), {
      method: 'DELETE',
      headers: getStoredAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to delete episodic memory');
    }
    return Boolean(data.deleted);
  }

  /**
   * LIST: Lists all persisted episodic memory entries.
   */
  public async listAll(): Promise<EpisodicMemoryItem[]> {
    const res = await fetch(apiUrl('/api/memory/episodic'), {
      headers: getStoredAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to list episodic memories');
    }
    return data.items || [];
  }

  /**
   * STATS: Returns storage health, item counts, and disk size metrics.
   */
  public async getStats(): Promise<MemoryStats> {
    const res = await fetch(apiUrl('/api/memory/episodic'), {
      headers: getStoredAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to get episodic memory stats');
    }
    return data.stats || {
      totalItems: 0,
      totalCategories: {},
      storeSizeBytes: 0,
      lastPersisted: new Date().toISOString()
    };
  }

  /**
   * INTEGRITY: Verifies SHA-256 digests and expired TTL purge state on the backend store.
   */
  public async verifyIntegrity(): Promise<MemoryIntegrityReport> {
    const res = await fetch(apiUrl('/api/memory/verify-integrity'), {
      headers: getStoredAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to verify memory store integrity');
    }
    return data.integrity;
  }

  /**
   * QUERY: Filters episodic memories client-side by search query and category.
   */
  public async queryMemories(query: string, category?: string): Promise<EpisodicMemoryItem[]> {
    const all = await this.listAll();
    const qLower = query.toLowerCase().trim();
    return all.filter((item) => {
      if (category && item.category !== category) return false;
      if (!qLower) return true;
      const keyMatch = item.key.toLowerCase().includes(qLower);
      const valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
      const valMatch = valStr.toLowerCase().includes(qLower);
      return keyMatch || valMatch;
    });
  }
}

export const NativeMemoryController = NativeMemoryControllerService.getInstance();
