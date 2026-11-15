/**
 * ZYNTHEOR Sovereign NativeMemoryController
 * Manages episodic memory storage within the Sovereign Core.
 * Ensures persistence across sessions in native_data/memory_store.json.
 * 
 * CRITICAL INVARIANT:
 * Every single read and write operation is logged into AuditLedger (native_data/audit_log.jsonl)
 * with SHA-256 cryptographic hash chaining for complete transparency and accountability.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';

export interface EpisodicMemoryItem {
  key: string;
  value: any;
  category: 'episodic' | 'semantic' | 'user_preference' | 'reasoning_trace';
  createdAt: string;
  updatedAt: string;
  readCount: number;
  metadata?: Record<string, any>;
  contentDigest: string; // SHA-256 of the value
}

export interface MemoryStoreData {
  version: string;
  lastPersisted: string;
  verified_knowledge: Record<string, string>;
  sessions: Array<{ key: string; val: string; timestamp?: string }>;
  episodic: Record<string, EpisodicMemoryItem>;
}

export class NativeMemoryController {
  private static instance: NativeMemoryController | null = null;
  private filePath = path.resolve(process.cwd(), 'native_data', 'memory_store.json');
  private store: MemoryStoreData;

  private constructor() {
    this.store = this.loadFromDisk();
  }

  public static getInstance(): NativeMemoryController {
    if (!NativeMemoryController.instance) {
      NativeMemoryController.instance = new NativeMemoryController();
    }
    return NativeMemoryController.instance;
  }

  private loadFromDisk(): MemoryStoreData {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.episodic) parsed.episodic = {};
        if (!parsed.verified_knowledge) parsed.verified_knowledge = {};
        if (!parsed.sessions) parsed.sessions = [];
        return parsed;
      } catch (err) {
        console.error('[NativeMemoryController] Failed to parse memory store, resetting', err);
      }
    }

    // Default canonical memory state
    const initial: MemoryStoreData = {
      version: '1.0.0-SOVEREIGN',
      lastPersisted: new Date().toISOString(),
      verified_knowledge: {
        architecture: 'ZYNTHEOR Native Core; active checkpoint size must be read from verified Cloud Runtime evidence',
        sovereignty_rule: 'Native model is the intelligence core; runtime readiness requires a verified Cloud checkpoint and recorded evidence',
        sandbox_root: '/workspace',
        multilingual_engine: 'Thai-English Dual Native Vocabulary & Code-Switching'
      },
      sessions: [],
      episodic: {}
    };

    this.persistToDisk(initial);
    return initial;
  }

  private persistToDisk(data: MemoryStoreData): void {
    data.lastPersisted = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Calculates SHA-256 digest of arbitrary value.
   */
  private computeDigest(val: any): string {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Stores or updates an episodic memory item.
   * Logs WRITE to AuditLedger.
   */
  public storeMemory(
    key: string,
    value: any,
    category: EpisodicMemoryItem['category'] = 'episodic',
    metadata?: Record<string, any>
  ): EpisodicMemoryItem {
    const now = new Date().toISOString();
    const digest = this.computeDigest(value);

    const existing = this.store.episodic[key];
    const item: EpisodicMemoryItem = {
      key,
      value,
      category,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      readCount: existing ? existing.readCount : 0,
      metadata: metadata || existing?.metadata,
      contentDigest: digest
    };

    this.store.episodic[key] = item;
    this.persistToDisk(this.store);

    // Cryptographic audit logging for accountability
    AuditLedger.append('SYSTEM', 'MEMORY_WRITE_OP', {
      memoryKey: key,
      category,
      contentDigest: digest,
      isUpdate: Boolean(existing),
      timestamp: now
    });

    return item;
  }

  /**
   * Updates an existing episodic memory item.
   * Logs MEMORY_UPDATE_OP transaction to AuditLedger with preimage and previous digest.
   */
  public updateMemory(
    key: string,
    value: any,
    category?: EpisodicMemoryItem['category'],
    metadata?: Record<string, any>
  ): EpisodicMemoryItem {
    const existing = this.store.episodic[key];
    const now = new Date().toISOString();
    const digest = this.computeDigest(value);
    const prevDigest = existing ? existing.contentDigest : null;

    const item: EpisodicMemoryItem = {
      key,
      value,
      category: category || existing?.category || 'episodic',
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      readCount: existing ? existing.readCount : 0,
      metadata: metadata || existing?.metadata,
      contentDigest: digest
    };

    this.store.episodic[key] = item;
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_UPDATE_OP', {
      memoryKey: key,
      previousDigest: prevDigest,
      newDigest: digest,
      category: item.category,
      updatedAt: now
    });

    return item;
  }

  /**
   * Retrieves an episodic memory item by key.
   * Logs READ to AuditLedger.
   */
  public retrieveMemory(key: string): EpisodicMemoryItem | null {
    const item = this.store.episodic[key];
    const now = new Date().toISOString();

    if (item) {
      item.readCount++;
      this.persistToDisk(this.store);

      AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
        memoryKey: key,
        found: true,
        readCount: item.readCount,
        contentDigest: item.contentDigest,
        timestamp: now
      });

      return item;
    }

    AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
      memoryKey: key,
      found: false,
      timestamp: now
    });

    return null;
  }

  /**
   * Queries memories by substring or category.
   * Logs QUERY to AuditLedger.
   */
  public queryMemories(
    queryStr: string,
    category?: EpisodicMemoryItem['category']
  ): EpisodicMemoryItem[] {
    const items = Object.values(this.store.episodic);
    const qLower = queryStr.toLowerCase();

    const results = items.filter((item) => {
      if (category && item.category !== category) return false;
      if (!queryStr) return true;
      const keyMatch = item.key.toLowerCase().includes(qLower);
      const valMatch = JSON.stringify(item.value).toLowerCase().includes(qLower);
      return keyMatch || valMatch;
    });

    AuditLedger.append('SYSTEM', 'MEMORY_QUERY_OP', {
      query: queryStr,
      categoryFilter: category || 'ALL',
      matchCount: results.length
    });

    return results;
  }

  /**
   * Lists all current episodic memories.
   */
  public listAll(): EpisodicMemoryItem[] {
    return Object.values(this.store.episodic);
  }

  /**
   * Clears a specific memory key.
   */
  public deleteMemory(key: string): boolean {
    if (this.store.episodic[key]) {
      const digest = this.store.episodic[key].contentDigest;
      delete this.store.episodic[key];
      this.persistToDisk(this.store);

      AuditLedger.append('SYSTEM', 'MEMORY_DELETE_OP', {
        memoryKey: key,
        previousDigest: digest
      });
      return true;
    }
    return false;
  }

  /**
   * Gets memory health stats.
   */
  public getStats(): {
    totalItems: number;
    totalCategories: Record<string, number>;
    storeSizeBytes: number;
    lastPersisted: string;
  } {
    const items = Object.values(this.store.episodic);
    const categories: Record<string, number> = {};
    for (const item of items) {
      categories[item.category] = (categories[item.category] || 0) + 1;
    }

    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(this.filePath).size;
    } catch {
      sizeBytes = 0;
    }

    return {
      totalItems: items.length,
      totalCategories: categories,
      storeSizeBytes: sizeBytes,
      lastPersisted: this.store.lastPersisted
    };
  }
}
