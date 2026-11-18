/**
 * ZYNTHEOR Persistent Expense Ledger Service (Local SQLite)
 *
 * Implements durable expense & income tracking backed by Node's built-in
 * `node:sqlite` (`DatabaseSync`) for the expense ledger CLI module and server API.
 * Zero Simulation Policy: all balances, category breakdowns, timelines, and
 * records are computed directly from persisted SQLite rows.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LedgerRecordType = 'expense' | 'income';

export interface LedgerRecord {
  id: string;
  tenantId: string;
  type: LedgerRecordType;
  amount: number;
  currency: string;
  category: string;
  description: string;
  occurredAt: string;
  createdAt: string;
  entryHash: string;
}

export interface LedgerRecordInput {
  type: LedgerRecordType;
  amount: number;
  category: string;
  description?: string;
  currency?: string;
  occurredAt?: string;
  tenantId?: string;
}

export interface LedgerQueryFilter {
  tenantId?: string;
  type?: LedgerRecordType;
  currency?: string;
  category?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface LedgerBalanceSummary {
  tenantId: string;
  currency: string;
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  recordCount: number;
  incomeCount: number;
  expenseCount: number;
}

export interface LedgerCategoryBreakdown {
  category: string;
  type: LedgerRecordType;
  totalAmount: number;
  count: number;
  sharePct: number;
}

export interface LedgerTimelinePoint {
  date: string;
  income: number;
  expenses: number;
  net: number;
  cumulativeBalance: number;
  count: number;
}

export type LedgerCategorySort =
  | 'amount_desc'
  | 'amount_asc'
  | 'name_asc'
  | 'name_desc'
  | 'count_desc';

export type LedgerThresholdLevel = 'OK' | 'APPROACHING' | 'EXCEEDED';

export interface LedgerThresholdStatus {
  tenantId: string;
  currency: string;
  budgetLimit: number;
  warningRatio: number;
  totalExpenses: number;
  remainingBudget: number;
  utilizationPct: number;
  exceededBy: number;
  level: LedgerThresholdLevel;
  exceeded: boolean;
  warningTriggered: boolean;
  message: string;
  source: 'sqlite' | 'predefined_default';
  updatedAt: string | null;
}

export interface LedgerSummary {
  balance: LedgerBalanceSummary;
  threshold: LedgerThresholdStatus;
  categoryBreakdown: LedgerCategoryBreakdown[];
  timeline: LedgerTimelinePoint[];
  recentRecords: LedgerRecord[];
  totalRecords: number;
  filters: {
    fromDate: string | null;
    toDate: string | null;
    currency: string;
    sortBy: LedgerCategorySort;
  };
  dbPath: string;
  engine: 'node:sqlite';
  generatedAt: string;
}

export const DEFAULT_EXPENSE_BUDGET_LIMIT = (() => {
  const raw = Number(process.env.ZYNTHEOR_LEDGER_BUDGET_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Number(raw.toFixed(4)) : 1000;
})();

export const DEFAULT_BUDGET_WARNING_RATIO = 0.8;

interface SqlLedgerRow {
  id: string;
  tenant_id: string;
  type: LedgerRecordType;
  amount: number;
  currency: string;
  category: string;
  description: string;
  occurred_at: string;
  created_at: string;
  entry_hash: string;
}

function roundAmount(value: number): number {
  return Number(Number(value || 0).toFixed(4));
}

function mapRowToRecord(row: SqlLedgerRow): LedgerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    amount: roundAmount(row.amount),
    currency: row.currency,
    category: row.category,
    description: row.description,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    entryHash: row.entry_hash,
  };
}

export function resolveDefaultLedgerDbPath(): string {
  const configured = (process.env.ZYNTHEOR_LEDGER_DB_PATH || '').trim();
  if (configured) {
    return configured === ':memory:' ? ':memory:' : path.resolve(configured);
  }
  return path.resolve(process.cwd(), 'native_data', 'expense_ledger.sqlite');
}

export class LedgerService {
  private static instance: LedgerService | null = null;
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private closed = false;

  constructor(dbPath: string = resolveDefaultLedgerDbPath()) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const parentDir = path.dirname(dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
  }

  public static getInstance(dbPath?: string): LedgerService {
    if (!LedgerService.instance || LedgerService.instance.closed) {
      LedgerService.instance = new LedgerService(dbPath);
    }
    return LedgerService.instance;
  }

  public static resetInstance(): void {
    if (LedgerService.instance && !LedgerService.instance.closed) {
      LedgerService.instance.close();
    }
    LedgerService.instance = null;
  }

  private initializeSchema(): void {
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS ledger_records (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default-tenant',
        type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
        amount REAL NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        entry_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_tenant_occurred
        ON ledger_records (tenant_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_category
        ON ledger_records (category);
      CREATE TABLE IF NOT EXISTS ledger_budgets (
        tenant_id TEXT NOT NULL,
        budget_limit REAL NOT NULL CHECK (budget_limit > 0),
        warning_ratio REAL NOT NULL DEFAULT 0.8 CHECK (warning_ratio > 0 AND warning_ratio <= 1),
        currency TEXT NOT NULL DEFAULT 'USD',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, currency)
      );
    `);

    // Migrate the earlier tenant-only budget key to tenant+currency without
    // discarding existing limits. This keeps USD and THB budgets independent.
    const budgetColumns = this.db.prepare('PRAGMA table_info(ledger_budgets)').all() as Array<{ name: string; pk: number }>;
    const primaryKeyColumns = budgetColumns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    if (primaryKeyColumns.length === 1 && primaryKeyColumns[0] === 'tenant_id') {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE ledger_budgets_v2 (
          tenant_id TEXT NOT NULL,
          budget_limit REAL NOT NULL CHECK (budget_limit > 0),
          warning_ratio REAL NOT NULL DEFAULT 0.8 CHECK (warning_ratio > 0 AND warning_ratio <= 1),
          currency TEXT NOT NULL DEFAULT 'USD',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, currency)
        );
        INSERT OR IGNORE INTO ledger_budgets_v2 (tenant_id, budget_limit, warning_ratio, currency, updated_at)
          SELECT tenant_id, budget_limit, warning_ratio, currency, updated_at FROM ledger_budgets;
        DROP TABLE ledger_budgets;
        ALTER TABLE ledger_budgets_v2 RENAME TO ledger_budgets;
        COMMIT;
      `);
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('LedgerService SQLite connection is closed.');
    }
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Inserts a validated expense or income record into SQLite.
   */
  public insertRecord(input: LedgerRecordInput): LedgerRecord {
    this.ensureOpen();

    if (!input || (input.type !== 'expense' && input.type !== 'income')) {
      throw new Error("Invalid ledger record type: expected 'expense' or 'income'.");
    }

    const numericAmount = Number(input.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid ledger amount: must be a finite number greater than 0.');
    }
    const amount = roundAmount(numericAmount);

    const category = String(input.category || '').trim().slice(0, 64);
    if (!category) {
      throw new Error('Ledger category is required.');
    }

    const description = String(input.description || '').trim().slice(0, 256);
    const currencyRaw = String(input.currency || 'USD').trim().toUpperCase();
    const currency = /^[A-Z]{3,5}$/.test(currencyRaw) ? currencyRaw : 'USD';
    const tenantId = String(input.tenantId || 'default-tenant').trim() || 'default-tenant';

    let occurredAt: string;
    if (input.occurredAt) {
      const parsedDate = new Date(input.occurredAt);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new Error('Invalid occurredAt timestamp.');
      }
      occurredAt = parsedDate.toISOString();
    } else {
      occurredAt = new Date().toISOString();
    }

    const id = `ldg_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const entryHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          id,
          tenantId,
          type: input.type,
          amount,
          currency,
          category,
          description,
          occurredAt,
          createdAt,
        })
      )
      .digest('hex');

    const stmt = this.db.prepare(`
      INSERT INTO ledger_records (
        id, tenant_id, type, amount, currency, category, description, occurred_at, created_at, entry_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      tenantId,
      input.type,
      amount,
      currency,
      category,
      description,
      occurredAt,
      createdAt,
      entryHash
    );

    return {
      id,
      tenantId,
      type: input.type,
      amount,
      currency,
      category,
      description,
      occurredAt,
      createdAt,
      entryHash,
    };
  }

  /** Alias for insertRecord */
  public addRecord(input: LedgerRecordInput): LedgerRecord {
    return this.insertRecord(input);
  }

  /**
   * Computes exact income, expense, and net balance totals from SQLite (with optional date-range filters).
   */
  public getBalance(
    filter: { tenantId?: string; currency?: string; fromDate?: string; toDate?: string } = {}
  ): LedgerBalanceSummary {
    this.ensureOpen();

    const tenantId = (filter.tenantId || 'default-tenant').trim() || 'default-tenant';
    const currency = (filter.currency || 'USD').trim().toUpperCase();
    const clauses: string[] = ['tenant_id = ?', 'currency = ?'];
    const params: string[] = [tenantId, currency];

    if (filter.fromDate) {
      clauses.push('occurred_at >= ?');
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push('occurred_at <= ?');
      params.push(filter.toDate);
    }

    const row = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
          COUNT(*) AS record_count,
          COALESCE(SUM(CASE WHEN type = 'income' THEN 1 ELSE 0 END), 0) AS income_count,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END), 0) AS expense_count
        FROM ledger_records
        WHERE ${clauses.join(' AND ')}
        `
      )
      .get(...params) as {
      total_income: number;
      total_expenses: number;
      record_count: number;
      income_count: number;
      expense_count: number;
    };

    const totalIncome = roundAmount(row?.total_income ?? 0);
    const totalExpenses = roundAmount(row?.total_expenses ?? 0);
    const netBalance = roundAmount(totalIncome - totalExpenses);

    return {
      tenantId,
      currency,
      totalIncome,
      totalExpenses,
      netBalance,
      recordCount: Number(row?.record_count ?? 0),
      incomeCount: Number(row?.income_count ?? 0),
      expenseCount: Number(row?.expense_count ?? 0),
    };
  }

  /** Alias for getBalance */
  public calculateBalance(
    filter: { tenantId?: string; currency?: string; fromDate?: string; toDate?: string } = {}
  ): LedgerBalanceSummary {
    return this.getBalance(filter);
  }

  /**
   * Persists a tenant budget limit in SQLite for threshold monitoring.
   */
  public setBudgetLimit(
    budgetLimit: number,
    options: { tenantId?: string; warningRatio?: number; currency?: string } = {}
  ): LedgerThresholdStatus {
    this.ensureOpen();

    const numericLimit = Number(budgetLimit);
    if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
      throw new Error('Invalid budget limit: must be a finite number greater than 0.');
    }
    const normalizedLimit = roundAmount(numericLimit);

    const warningRatioRaw =
      options.warningRatio !== undefined ? Number(options.warningRatio) : DEFAULT_BUDGET_WARNING_RATIO;
    if (!Number.isFinite(warningRatioRaw) || warningRatioRaw <= 0 || warningRatioRaw > 1) {
      throw new Error('Invalid warning ratio: must be > 0 and <= 1.');
    }
    const warningRatio = Number(warningRatioRaw.toFixed(4));
    const tenantId = (options.tenantId || 'default-tenant').trim() || 'default-tenant';
    const currencyRaw = String(options.currency || 'USD').trim().toUpperCase();
    const currency = /^[A-Z]{3,5}$/.test(currencyRaw) ? currencyRaw : 'USD';
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO ledger_budgets (tenant_id, budget_limit, warning_ratio, currency, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, currency) DO UPDATE SET
          budget_limit = excluded.budget_limit,
          warning_ratio = excluded.warning_ratio,
          updated_at = excluded.updated_at
        `
      )
      .run(tenantId, normalizedLimit, warningRatio, currency, updatedAt);

    return this.checkBudgetThreshold({ tenantId, currency });
  }

  /**
   * Evaluates current SQLite expense totals against the configured or predefined budget limit.
   */
  public checkBudgetThreshold(
    filter: { tenantId?: string; currency?: string; fromDate?: string; toDate?: string } = {}
  ): LedgerThresholdStatus {
    this.ensureOpen();

    const tenantId = (filter.tenantId || 'default-tenant').trim() || 'default-tenant';
    const requestedCurrency = (filter.currency || 'USD').trim().toUpperCase();
    const budgetRow = this.db
      .prepare(
        `
        SELECT budget_limit, warning_ratio, currency, updated_at
        FROM ledger_budgets
        WHERE tenant_id = ? AND currency = ?
        LIMIT 1
        `
      )
      .get(tenantId, requestedCurrency) as
      | {
          budget_limit: number;
          warning_ratio: number;
          currency: string;
          updated_at: string;
        }
      | undefined;

    const budgetLimit = budgetRow
      ? roundAmount(budgetRow.budget_limit)
      : DEFAULT_EXPENSE_BUDGET_LIMIT;
    const warningRatio = budgetRow ? Number(budgetRow.warning_ratio) : DEFAULT_BUDGET_WARNING_RATIO;
    const currency = requestedCurrency;

    const balance = this.getBalance({
      tenantId,
      currency,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
    });

    const totalExpenses = balance.totalExpenses;
    const remainingBudget = roundAmount(Math.max(0, budgetLimit - totalExpenses));
    const exceededBy = roundAmount(Math.max(0, totalExpenses - budgetLimit));
    const utilizationPct =
      budgetLimit > 0 ? Number(((totalExpenses / budgetLimit) * 100).toFixed(1)) : 0;

    const exceeded = totalExpenses > budgetLimit;
    const approaching = !exceeded && totalExpenses >= budgetLimit * warningRatio;
    const level: LedgerThresholdLevel = exceeded
      ? 'EXCEEDED'
      : approaching
      ? 'APPROACHING'
      : 'OK';
    const warningTriggered = exceeded || approaching;

    const message = exceeded
      ? `Budget threshold exceeded by ${currency} ${exceededBy.toFixed(2)} (${utilizationPct}% of ${currency} ${budgetLimit.toFixed(2)} limit).`
      : approaching
      ? `Approaching budget threshold at ${utilizationPct}% (${currency} ${totalExpenses.toFixed(2)} / ${currency} ${budgetLimit.toFixed(2)}).`
      : `Expenses within budget (${utilizationPct}% of ${currency} ${budgetLimit.toFixed(2)} limit).`;

    return {
      tenantId,
      currency,
      budgetLimit,
      warningRatio,
      totalExpenses,
      remainingBudget,
      utilizationPct,
      exceededBy,
      level,
      exceeded,
      warningTriggered,
      message,
      source: budgetRow ? 'sqlite' : 'predefined_default',
      updatedAt: budgetRow?.updated_at ?? null,
    };
  }

  /**
   * Retrieves persisted ledger records matching the given filters.
   */
  public getRecords(filter: LedgerQueryFilter = {}): LedgerRecord[] {
    this.ensureOpen();

    const tenantId = (filter.tenantId || 'default-tenant').trim() || 'default-tenant';
    const clauses: string[] = ['tenant_id = ?'];
    const params: Array<string | number> = [tenantId];

    if (filter.currency) {
      clauses.push('currency = ?');
      params.push(filter.currency.trim().toUpperCase());
    }

    if (filter.type === 'expense' || filter.type === 'income') {
      clauses.push('type = ?');
      params.push(filter.type);
    }

    if (filter.category && filter.category.trim()) {
      clauses.push('LOWER(category) = LOWER(?)');
      params.push(filter.category.trim());
    }

    if (filter.fromDate) {
      clauses.push('occurred_at >= ?');
      params.push(filter.fromDate);
    }

    if (filter.toDate) {
      clauses.push('occurred_at <= ?');
      params.push(filter.toDate);
    }

    const limit =
      typeof filter.limit === 'number' && Number.isFinite(filter.limit)
        ? Math.min(Math.max(Math.floor(filter.limit), 1), 1000)
        : 100;
    const offset =
      typeof filter.offset === 'number' && Number.isFinite(filter.offset)
        ? Math.max(Math.floor(filter.offset), 0)
        : 0;

    params.push(limit, offset);

    const rows = this.db
      .prepare(
        `
        SELECT id, tenant_id, type, amount, currency, category, description, occurred_at, created_at, entry_hash
        FROM ledger_records
        WHERE ${clauses.join(' AND ')}
        ORDER BY occurred_at DESC, created_at DESC, rowid DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params) as unknown as SqlLedgerRow[];

    return rows.map(mapRowToRecord);
  }

  public getRecordById(id: string, tenantId: string = 'default-tenant'): LedgerRecord | null {
    this.ensureOpen();
    const row = this.db
      .prepare(
        `
        SELECT id, tenant_id, type, amount, currency, category, description, occurred_at, created_at, entry_hash
        FROM ledger_records
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
        `
      )
      .get(id, tenantId) as unknown as SqlLedgerRow | undefined;

    return row ? mapRowToRecord(row) : null;
  }

  public deleteRecord(id: string, tenantId: string = 'default-tenant'): boolean {
    this.ensureOpen();
    const result = this.db
      .prepare('DELETE FROM ledger_records WHERE id = ? AND tenant_id = ?')
      .run(id, tenantId);
    return Number(result.changes || 0) > 0;
  }

  public getCategoryBreakdown(
    filter: {
      tenantId?: string;
      type?: LedgerRecordType;
      currency?: string;
      fromDate?: string;
      toDate?: string;
      sortBy?: LedgerCategorySort;
    } = {}
  ): LedgerCategoryBreakdown[] {
    this.ensureOpen();

    const tenantId = (filter.tenantId || 'default-tenant').trim() || 'default-tenant';
    const clauses: string[] = ['tenant_id = ?'];
    const params: string[] = [tenantId];

    if (filter.currency) {
      clauses.push('currency = ?');
      params.push(filter.currency.trim().toUpperCase());
    }
    if (filter.type === 'expense' || filter.type === 'income') {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    if (filter.fromDate) {
      clauses.push('occurred_at >= ?');
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push('occurred_at <= ?');
      params.push(filter.toDate);
    }

    let orderBySql = 'total_amount DESC, category ASC';
    switch (filter.sortBy) {
      case 'amount_asc':
        orderBySql = 'total_amount ASC, category ASC';
        break;
      case 'name_asc':
        orderBySql = 'LOWER(category) ASC, total_amount DESC';
        break;
      case 'name_desc':
        orderBySql = 'LOWER(category) DESC, total_amount DESC';
        break;
      case 'count_desc':
        orderBySql = 'count DESC, total_amount DESC, category ASC';
        break;
      case 'amount_desc':
      default:
        orderBySql = 'total_amount DESC, category ASC';
        break;
    }

    const rows = this.db
      .prepare(
        `
        SELECT category, type, COALESCE(SUM(amount), 0) AS total_amount, COUNT(*) AS count
        FROM ledger_records
        WHERE ${clauses.join(' AND ')}
        GROUP BY category, type
        ORDER BY ${orderBySql}
        `
      )
      .all(...params) as Array<{
      category: string;
      type: LedgerRecordType;
      total_amount: number;
      count: number;
    }>;

    const expenseGrandTotal = rows
      .filter((r) => r.type === 'expense')
      .reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const incomeGrandTotal = rows
      .filter((r) => r.type === 'income')
      .reduce((sum, r) => sum + Number(r.total_amount || 0), 0);

    return rows.map((r) => {
      const totalAmount = roundAmount(r.total_amount);
      const denominator = r.type === 'expense' ? expenseGrandTotal : incomeGrandTotal;
      const sharePct =
        denominator > 0 ? Number(((totalAmount / denominator) * 100).toFixed(1)) : 0;
      return {
        category: r.category,
        type: r.type,
        totalAmount,
        count: Number(r.count),
        sharePct,
      };
    });
  }

  public getTimelineSeries(
    filter: { tenantId?: string; currency?: string; days?: number; fromDate?: string; toDate?: string } = {}
  ): LedgerTimelinePoint[] {
    this.ensureOpen();

    const tenantId = (filter.tenantId || 'default-tenant').trim() || 'default-tenant';
    const clauses: string[] = ['tenant_id = ?'];
    const params: string[] = [tenantId];
    if (filter.currency) {
      clauses.push('currency = ?');
      params.push(filter.currency.trim().toUpperCase());
    }

    if (filter.fromDate) {
      clauses.push('occurred_at >= ?');
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push('occurred_at <= ?');
      params.push(filter.toDate);
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          substr(occurred_at, 1, 10) AS day,
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses,
          COUNT(*) AS count
        FROM ledger_records
        WHERE ${clauses.join(' AND ')}
        GROUP BY day
        ORDER BY day ASC
        `
      )
      .all(...params) as Array<{
      day: string;
      income: number;
      expenses: number;
      count: number;
    }>;

    const maxDays =
      typeof filter.days === 'number' && Number.isFinite(filter.days) && filter.days > 0
        ? Math.floor(filter.days)
        : 0;

    let runningBalance = 0;
    const series = rows.map((row) => {
      const income = roundAmount(row.income);
      const expenses = roundAmount(row.expenses);
      const net = roundAmount(income - expenses);
      runningBalance = roundAmount(runningBalance + net);
      return {
        date: row.day,
        income,
        expenses,
        net,
        cumulativeBalance: runningBalance,
        count: Number(row.count),
      };
    });

    if (maxDays > 0 && series.length > maxDays) {
      return series.slice(series.length - maxDays);
    }
    return series;
  }

  public getSummary(
    filter: {
      tenantId?: string;
      currency?: string;
      limit?: number;
      fromDate?: string;
      toDate?: string;
      sortBy?: LedgerCategorySort;
    } = {}
  ): LedgerSummary {
    const tenantId = (filter.tenantId || 'default-tenant').trim() || 'default-tenant';
    const limit = filter.limit ?? 20;
    const sortBy: LedgerCategorySort = filter.sortBy || 'amount_desc';
    const currency = (filter.currency || 'USD').trim().toUpperCase();
    const fromDate = filter.fromDate || undefined;
    const toDate = filter.toDate || undefined;

    const balance = this.getBalance({ tenantId, currency, fromDate, toDate });
    const threshold = this.checkBudgetThreshold({ tenantId, currency, fromDate, toDate });
    const categoryBreakdown = this.getCategoryBreakdown({ tenantId, currency, fromDate, toDate, sortBy });
    const timeline = this.getTimelineSeries({ tenantId, currency, days: 30, fromDate, toDate });
    const recentRecords = this.getRecords({ tenantId, currency, limit, fromDate, toDate });

    return {
      balance,
      threshold,
      categoryBreakdown,
      timeline,
      recentRecords,
      totalRecords: balance.recordCount,
      filters: {
        fromDate: fromDate || null,
        toDate: toDate || null,
        currency,
        sortBy,
      },
      dbPath: this.dbPath,
      engine: 'node:sqlite',
      generatedAt: new Date().toISOString(),
    };
  }

  public close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
      if (LedgerService.instance === this) {
        LedgerService.instance = null;
      }
    }
  }
}

/**
 * Expense Ledger CLI Runner
 * Usage:
 *   npx tsx src/services/LedgerService.ts add <expense|income> <amount> <category> [description]
 *   npx tsx src/services/LedgerService.ts balance
 *   npx tsx src/services/LedgerService.ts list [limit]
 *   npx tsx src/services/LedgerService.ts summary
 */
export function runLedgerCli(argv: string[], service: LedgerService = LedgerService.getInstance()): string {
  const [command = 'summary', ...args] = argv;
  switch (command) {
    case 'add':
    case 'insert': {
      const [typeArg, amountArg, categoryArg, ...descParts] = args;
      const record = service.insertRecord({
        type: typeArg as LedgerRecordType,
        amount: Number(amountArg),
        category: categoryArg || '',
        description: descParts.join(' '),
      });
      return JSON.stringify({ ok: true, record }, null, 2);
    }
    case 'balance': {
      const balance = service.getBalance();
      return JSON.stringify({ ok: true, balance }, null, 2);
    }
    case 'list': {
      const limit = args[0] ? Number(args[0]) : 50;
      const records = service.getRecords({ limit });
      return JSON.stringify({ ok: true, count: records.length, records }, null, 2);
    }
    case 'delete': {
      const id = args[0];
      if (!id) throw new Error('Record ID is required for delete.');
      const deleted = service.deleteRecord(id);
      return JSON.stringify({ ok: true, deleted, id }, null, 2);
    }
    case 'budget': {
      const [subCmd = 'check', valueArg] = args;
      if (subCmd === 'set') {
        const threshold = service.setBudgetLimit(Number(valueArg));
        return JSON.stringify({ ok: true, threshold }, null, 2);
      }
      const threshold = service.checkBudgetThreshold();
      return JSON.stringify({ ok: true, threshold }, null, 2);
    }
    case 'summary':
    default: {
      const summary = service.getSummary();
      return JSON.stringify({ ok: true, summary }, null, 2);
    }
  }
}

const isExecutedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isExecutedDirectly) {
  try {
    const output = runLedgerCli(process.argv.slice(2));
    console.log(output);
  } catch (err: any) {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    process.exit(1);
  }
}
