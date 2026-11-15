/**
 * ZYNTHEOR Sovereign Client-Side Audit Ledger
 * Universal browser/runtime immutable append-only event stream with SHA-256 chained hashing.
 * 
 * Adheres strictly to Zero-Fake Engineering & Sovereign Governance standards:
 * - Immutable blocks (Object.freeze)
 * - Cryptographic SHA-256 hash chaining
 * - Preimage structure: index|timestamp|prev_hash|eventType|payload_digest
 * - Persistent storage across sessions via localStorage with memory fallback
 */

export interface AuditBlock {
  readonly index: number;
  readonly timestamp: string;
  readonly prev_hash: string;
  readonly eventType: string;
  readonly payload_digest: string;
  readonly payload: Readonly<Record<string, any>>;
  readonly entry_hash: string;
}

export interface VerificationReport {
  readonly valid: boolean;
  readonly totalBlocks: number;
  readonly headHash: string;
  readonly brokenIndex?: number;
  readonly error?: string;
}

const GENESIS_PREV_HASH = '0'.repeat(64);
const STORAGE_KEY = 'zyntheor_client_audit_ledger_v1';

/**
 * Standard pure TypeScript SHA-256 implementation
 * Guarantees identical deterministic hashes in all environments (browser, SSR, Node)
 * without external dependencies.
 */
export function sha256Sync(ascii: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i: number, j: number;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  // Initial hash values: first 32 bits of the fractional parts of the square roots of the first 8 primes
  let hash: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  // Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes 2..311
  const k: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  // Convert string to UTF-8 byte array representation
  const utf8Bytes: number[] = [];
  for (i = 0; i < ascii.length; i++) {
    let charCode = ascii.charCodeAt(i);
    if (charCode < 0x80) {
      utf8Bytes.push(charCode);
    } else if (charCode < 0x800) {
      utf8Bytes.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
    } else if (charCode < 0xd800 || charCode >= 0xe000) {
      utf8Bytes.push(0xe0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3f), 0x80 | (charCode & 0x3f));
    } else {
      // surrogate pair
      i++;
      charCode = 0x10000 + (((charCode & 0x3ff) << 10) | (ascii.charCodeAt(i) & 0x3ff));
      utf8Bytes.push(
        0xf0 | (charCode >> 18),
        0x80 | ((charCode >> 12) & 0x3f),
        0x80 | ((charCode >> 6) & 0x3f),
        0x80 | (charCode & 0x3f)
      );
    }
  }

  const bitLength = utf8Bytes.length * 8;
  for (i = 0; i < utf8Bytes.length; i++) {
    words[i >> 2] |= utf8Bytes[i] << (24 - (i % 4) * 8);
  }

  words[bitLength >> 5] |= 0x80 << (24 - (bitLength % 32));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  const w: number[] = new Array(64);

  for (i = 0; i < words.length; i += 16) {
    let [a, b, c, d, e, f, g, h] = hash;

    for (j = 0; j < 64; j++) {
      if (j < 16) {
        w[j] = words[i + j] | 0;
      } else {
        const gamma0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const gamma1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (((w[j - 16] + gamma0) | 0) + ((w[j - 7] + gamma1) | 0)) | 0;
      }

      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (((((h + s1) | 0) + ch) | 0) + ((k[j] + w[j]) | 0)) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const byte = (hash[i] >> (j * 8)) & 255;
      result += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }

  return result;
}

/**
 * Structured Store for In-Memory & LocalStorage persistence
 */
class AuditLedgerStore {
  private static instance: AuditLedgerStore | null = null;
  private blocks: AuditBlock[] = [];

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): AuditLedgerStore {
    if (!AuditLedgerStore.instance) {
      AuditLedgerStore.instance = new AuditLedgerStore();
    }
    return AuditLedgerStore.instance;
  }

  private loadFromStorage(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.blocks = parsed.map((item) => Object.freeze({
              ...item,
              payload: Object.freeze({ ...item.payload })
            }));
            return;
          }
        }
      } catch (err) {
        console.warn('[AuditLedgerStore] Failed to read from localStorage:', err);
      }
    }

    // Initialize Genesis block if store is empty
    if (this.blocks.length === 0) {
      this.initGenesis();
    }
  }

  private persist(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.blocks));
      } catch (err) {
        console.warn('[AuditLedgerStore] Failed to write to localStorage:', err);
      }
    }
  }

  private initGenesis(): void {
    const timestamp = '2026-11-11T00:00:00.000Z';
    const eventType = 'GENESIS';
    const payload = Object.freeze({
      system: 'ZYNTHEOR Q+ Sovereign AI Client Engine',
      constitution: 'Zero-Fake Immutable Audit Trail',
      hashAlgorithm: 'SHA-256',
      airgapped: true
    });
    const payloadStr = JSON.stringify(payload);
    const payload_digest = sha256Sync(payloadStr);
    const preimage = `0|${timestamp}|${GENESIS_PREV_HASH}|${eventType}|${payload_digest}`;
    const entry_hash = sha256Sync(preimage);

    const genesisBlock: AuditBlock = Object.freeze({
      index: 0,
      timestamp,
      prev_hash: GENESIS_PREV_HASH,
      eventType,
      payload_digest,
      payload,
      entry_hash
    });

    this.blocks = [genesisBlock];
    this.persist();
  }

  public append(eventType: string, payload: Record<string, any>): AuditBlock {
    const prevBlock = this.blocks[this.blocks.length - 1];
    const index = prevBlock ? prevBlock.index + 1 : 0;
    const prev_hash = prevBlock ? prevBlock.entry_hash : GENESIS_PREV_HASH;
    const timestamp = new Date().toISOString();

    const frozenPayload = Object.freeze({ ...payload });
    const payloadStr = JSON.stringify(frozenPayload);
    const payload_digest = sha256Sync(payloadStr);

    const preimage = `${index}|${timestamp}|${prev_hash}|${eventType}|${payload_digest}`;
    const entry_hash = sha256Sync(preimage);

    const block: AuditBlock = Object.freeze({
      index,
      timestamp,
      prev_hash,
      eventType,
      payload_digest,
      payload: frozenPayload,
      entry_hash
    });

    this.blocks.push(block);
    this.persist();
    return block;
  }

  public getAll(): AuditBlock[] {
    return [...this.blocks];
  }

  public getRecent(limit: number = 50): AuditBlock[] {
    return this.blocks.slice(-limit).reverse();
  }

  public getHead(): AuditBlock | null {
    return this.blocks.length > 0 ? this.blocks[this.blocks.length - 1] : null;
  }

  public verifyIntegrity(): VerificationReport {
    if (this.blocks.length === 0) {
      return { valid: true, totalBlocks: 0, headHash: GENESIS_PREV_HASH };
    }

    let expectedPrevHash = GENESIS_PREV_HASH;

    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];

      // 1. Verify sequence
      if (block.index !== i) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          headHash: '',
          brokenIndex: i,
          error: `Block index sequence mismatch: expected ${i}, found ${block.index}`
        };
      }

      // 2. Verify hash pointer
      if (block.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          headHash: '',
          brokenIndex: i,
          error: `Broken chain link at block #${i}: previous hash does not match previous block entry_hash`
        };
      }

      // 3. Verify payload digest
      const payloadStr = JSON.stringify(block.payload);
      const computedDigest = sha256Sync(payloadStr);
      if (computedDigest !== block.payload_digest) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          headHash: '',
          brokenIndex: i,
          error: `Payload tampering detected at block #${i}: computed digest does not match recorded digest`
        };
      }

      // 4. Verify entry hash
      const preimage = `${block.index}|${block.timestamp}|${block.prev_hash}|${block.eventType}|${block.payload_digest}`;
      const computedEntryHash = sha256Sync(preimage);
      if (computedEntryHash !== block.entry_hash) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          headHash: '',
          brokenIndex: i,
          error: `Block entry hash invalid at block #${i}: cryptographic recalculation mismatch`
        };
      }

      expectedPrevHash = block.entry_hash;
    }

    return {
      valid: true,
      totalBlocks: this.blocks.length,
      headHash: this.blocks[this.blocks.length - 1].entry_hash
    };
  }
}

/**
 * Appends a new immutable event to the client-side audit ledger.
 * Calculates cryptographic SHA-256 hash chained to previous block.
 * 
 * @param eventType Identifier of event type (e.g., 'SYSTEM_BOOT', 'INFERENCE_CALL', 'USER_LOGIN')
 * @param payload Event data dictionary
 * @returns Frozen immutable AuditBlock
 */
export function appendEvent(eventType: string, payload: Record<string, any>): AuditBlock {
  return AuditLedgerStore.getInstance().append(eventType, payload);
}

/**
 * Retrieves all audit blocks currently stored.
 */
export function getAuditEvents(): AuditBlock[] {
  return AuditLedgerStore.getInstance().getAll();
}

/**
 * Retrieves the most recent audit blocks (newest first).
 */
export function getRecentAuditEvents(limit: number = 50): AuditBlock[] {
  return AuditLedgerStore.getInstance().getRecent(limit);
}

/**
 * Verifies the full cryptographic hash chain from Genesis to Head.
 */
export function verifyAuditLedgerIntegrity(): VerificationReport {
  return AuditLedgerStore.getInstance().verifyIntegrity();
}

/**
 * Default export wrapping the ledger capabilities
 */
export const clientAuditLedger = {
  appendEvent,
  getAuditEvents,
  getRecentAuditEvents,
  verifyAuditLedgerIntegrity,
  sha256Sync
};

export default clientAuditLedger;
