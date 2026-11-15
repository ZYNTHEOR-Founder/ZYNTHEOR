import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Sovereign Cloud Users (linked to Firebase Auth UID)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('guest'),
  tenantId: text('tenant_id').notNull().default('default-tenant'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Cryptographic Append-Only Audit Ledger (replaces native_data/audit_log.jsonl)
export const auditLedger = pgTable('audit_ledger', {
  id: serial('id').primaryKey(),
  blockIndex: integer('block_index').notNull().unique(),
  timestamp: text('timestamp').notNull(),
  prevHash: text('prev_hash').notNull(),
  role: text('role').notNull(),
  action: text('action').notNull(),
  payloadDigest: text('payload_digest').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  payloadRaw: text('payload_raw'),
  entryHash: text('entry_hash').notNull(),
  tenantId: text('tenant_id'),
  userUid: text('user_uid').references(() => users.uid, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Server-Controlled Quick Log Seals (replaces native_data/quick_log_seals/*.json)
export const quickLogSeals = pgTable('quick_log_seals', {
  id: serial('id').primaryKey(),
  sealId: text('seal_id').notNull().unique(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  contentHash: text('content_hash').notNull(),
  entryHash: text('entry_hash').notNull(),
  logs: jsonb('logs').$type<string[]>().notNull(),
  sealedAt: timestamp('sealed_at').defaultNow().notNull(),
  restoredAt: timestamp('restored_at'),
});

// 4. Persistent Episodic & Semantic Memory Store (replaces native_data/memory_store.json)
export const memoryStore = pgTable(
  'memory_store',
  {
    id: serial('id').primaryKey(),
    memoryKey: text('memory_key').notNull(),
    tenantId: text('tenant_id').notNull().default('default-tenant'),
    userUid: text('user_uid').references(() => users.uid, { onDelete: 'set null' }),
    category: text('category').notNull().default('episodic'),
    value: jsonb('value').$type<unknown>().notNull(),
    readCount: integer('read_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    contentDigest: text('content_digest').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('memory_tenant_key_idx').on(table.tenantId, table.memoryKey)]
);

// 5. Knowledge Workspace Documents (replaces native_data/knowledge/documents.json)
export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  source: text('source').notNull(),
  format: text('format').notNull(),
  collection: text('collection').notNull().default('General'),
  tags: jsonb('tags').$type<string[]>().notNull(),
  language: text('language').notNull().default('mixed'),
  version: integer('version').notNull().default(1),
  contentHash: text('content_hash').notNull(),
  status: text('status').notNull().default('indexed'),
  chunksCount: integer('chunks_count').notNull().default(0),
  byteSize: integer('byte_size').notNull().default(0),
  provenance: text('provenance').notNull(),
  curatedForTraining: boolean('curated_for_training').notNull().default(false),
  tenantId: text('tenant_id').notNull().default('default-tenant'),
  readRoles: jsonb('read_roles').$type<string[]>(),
  parsedMetadata: jsonb('parsed_metadata').$type<Record<string, unknown>>(),
  userUid: text('user_uid').references(() => users.uid, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 6. Knowledge Workspace Retrieval Chunks (replaces native_data/knowledge/chunks.json)
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  documentTitle: text('document_title').notNull(),
  collection: text('collection').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  text: text('text').notNull(),
  language: text('language').notNull(),
  hash: text('hash').notNull(),
  tenantId: text('tenant_id').notNull().default('default-tenant'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Curated Training Datasets (replaces native_data/datasets/*.json)
export const curatedDatasets = pgTable('curated_datasets', {
  datasetId: text('dataset_id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull().default('1.0.0'),
  sourceDocIds: jsonb('source_doc_ids').$type<string[]>().notNull(),
  totalSamples: integer('total_samples').notNull().default(0),
  trainSamples: integer('train_samples').notNull().default(0),
  valSamples: integer('val_samples').notNull().default(0),
  evalSamples: integer('eval_samples').notNull().default(0),
  totalTokensEstimate: integer('total_tokens_estimate').notNull().default(0),
  thaiScriptRatio: real('thai_script_ratio').notNull().default(0),
  englishScriptRatio: real('english_script_ratio').notNull().default(0),
  datasetHash: text('dataset_hash').notNull(),
  syntheticCount: integer('synthetic_count').notNull().default(0),
  originalCount: integer('original_count').notNull().default(0),
  qualityScoreAvg: integer('quality_score_avg').notNull().default(0),
  status: text('status').notNull().default('NEEDS_REVIEW'),
  items: jsonb('items').$type<Array<Record<string, unknown>>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 8. Cloud Model Checkpoint Registry (pointers to S3/R2/GCS Object Storage .pt artifacts)
export const modelCheckpoints = pgTable('model_checkpoints', {
  id: serial('id').primaryKey(),
  modelKey: text('model_key').notNull().unique(),
  storageProvider: text('storage_provider').notNull().default('s3'),
  bucket: text('bucket').notNull(),
  objectKey: text('object_key').notNull(),
  sha256: text('sha256').notNull(),
  totalParams: integer('total_params').notNull(),
  architecture: text('architecture').notNull(),
  storageMode: text('storage_mode').notNull(),
  byteSize: integer('byte_size').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Drizzle Relations
export const usersRelations = relations(users, ({ many }) => ({
  memories: many(memoryStore),
  documents: many(knowledgeDocuments),
  auditEntries: many(auditLedger),
}));

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one, many }) => ({
  author: one(users, {
    fields: [knowledgeDocuments.userUid],
    references: [users.uid],
  }),
  chunks: many(knowledgeChunks),
}));

export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [knowledgeChunks.documentId],
    references: [knowledgeDocuments.id],
  }),
}));

export const memoryStoreRelations = relations(memoryStore, ({ one }) => ({
  owner: one(users, {
    fields: [memoryStore.userUid],
    references: [users.uid],
  }),
}));

export const auditLedgerRelations = relations(auditLedger, ({ one }) => ({
  actor: one(users, {
    fields: [auditLedger.userUid],
    references: [users.uid],
  }),
}));

// 9. Durable autonomous execution tasks (tenant + owner scoped).
// Mirrors src/db/migrations/0001_execution_tasks.sql
export const executionTasks = pgTable(
  'execution_tasks',
  {
    taskId: text('task_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    lifecycleStatus: text('lifecycle_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    task: jsonb('task').$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    tenantOwnerCreatedIdx: index('execution_tasks_tenant_owner_created_idx').on(
      table.tenantId,
      table.ownerUserId,
      table.createdAt,
    ),
    tenantStatusIdx: index('execution_tasks_tenant_status_idx').on(
      table.tenantId,
      table.lifecycleStatus,
    ),
  }),
);
