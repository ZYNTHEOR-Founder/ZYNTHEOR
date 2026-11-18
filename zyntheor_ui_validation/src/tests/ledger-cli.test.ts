/**
 * ZYNTHEOR Expense Ledger CLI & SQLite Service Unit Tests
 *
 * Verifies real SQLite persistence via LedgerService (`node:sqlite`):
 *   1. Record insertion, validation, SHA-256 entry hashes, and disk persistence across reopen
 *   2. Balance calculation (income, expenses, net balance, counts, decimal precision, tenant isolation)
 *   3. Data retrieval (filtering by type/category/date range, pagination, category breakdown, timeline, deletion)
 *   4. CLI command execution (`add`, `balance`, `list`, `summary`, `delete`)
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LedgerService, runLedgerCli } from '../services/LedgerService.ts';

let passed = 0;
let failed = 0;

async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`✖ ${name}: ${err?.message || err}`);
    failed++;
  }
}

console.log('\n======================================================');
console.log('  ZYNTHEOR EXPENSE LEDGER SQLITE & CLI UNIT TESTS     ');
console.log('======================================================\n');

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-ledger-test-'));

  try {
    await runCase('1. Inserts income & expense records and persists them across SQLite reopen', () => {
      const dbFile = path.join(tmpDir, 'persisted.sqlite');
      const ledger1 = new LedgerService(dbFile);

      const income = ledger1.insertRecord({
        type: 'income',
        amount: 2500.5,
        category: 'Retainer',
        description: 'Client engineering retainer',
        occurredAt: '2026-11-10T10:00:00.000Z',
      });
      const expense = ledger1.insertRecord({
        type: 'expense',
        amount: 420.75,
        category: 'Compute',
        description: 'GPU training cluster',
        occurredAt: '2026-11-11T12:00:00.000Z',
      });

      assert.ok(income.id.startsWith('ldg_'));
      assert.equal(income.entryHash.length, 64);
      assert.equal(expense.amount, 420.75);
      ledger1.close();

      // Reopen the exact same SQLite file to verify durable disk persistence
      const ledger2 = new LedgerService(dbFile);
      const records = ledger2.getRecords();
      assert.equal(records.length, 2);
      assert.equal(records[0].id, expense.id);
      assert.equal(records[1].id, income.id);
      assert.equal(ledger2.getRecordById(income.id)?.category, 'Retainer');
      ledger2.close();
    });

    await runCase('2. Rejects invalid record inputs fail-closed (amount <= 0, empty category, invalid type)', () => {
      const ledger = new LedgerService(':memory:');
      assert.throws(
        () => ledger.insertRecord({ type: 'expense', amount: 0, category: 'Compute' }),
        /amount/i
      );
      assert.throws(
        () => ledger.insertRecord({ type: 'expense', amount: -50, category: 'Compute' }),
        /amount/i
      );
      assert.throws(
        () => ledger.insertRecord({ type: 'expense', amount: Number.NaN, category: 'Compute' }),
        /amount/i
      );
      assert.throws(
        () => ledger.insertRecord({ type: 'expense', amount: 15, category: '   ' }),
        /category/i
      );
      assert.throws(
        () => ledger.insertRecord({ type: 'transfer' as any, amount: 15, category: 'Compute' }),
        /type/i
      );
      ledger.close();
    });

    await runCase('3. Calculates exact income, expense, net balance, and tenant-isolated totals', () => {
      const ledger = new LedgerService(':memory:');

      // Empty ledger starts at zero
      const emptyBalance = ledger.getBalance();
      assert.equal(emptyBalance.totalIncome, 0);
      assert.equal(emptyBalance.totalExpenses, 0);
      assert.equal(emptyBalance.netBalance, 0);
      assert.equal(emptyBalance.recordCount, 0);

      ledger.insertRecord({ type: 'income', amount: 1200.1, category: 'Sales' });
      ledger.insertRecord({ type: 'income', amount: 300.2, category: 'Consulting' });
      ledger.insertRecord({ type: 'expense', amount: 199.95, category: 'Hosting' });
      ledger.insertRecord({ type: 'expense', amount: 50.35, category: 'Storage' });

      // Other tenant should not pollute default-tenant balance
      ledger.insertRecord({
        type: 'expense',
        amount: 9999,
        category: 'Compute',
        tenantId: 'tenant-beta',
      });

      const balance = ledger.calculateBalance();
      assert.equal(balance.totalIncome, 1500.3);
      assert.equal(balance.totalExpenses, 250.3);
      assert.equal(balance.netBalance, 1250);
      assert.equal(balance.incomeCount, 2);
      assert.equal(balance.expenseCount, 2);
      assert.equal(balance.recordCount, 4);

      const betaBalance = ledger.getBalance({ tenantId: 'tenant-beta' });
      assert.equal(betaBalance.totalExpenses, 9999);
      assert.equal(betaBalance.netBalance, -9999);
      ledger.close();
    });

    await runCase('4. Retrieves filtered records, category breakdown, timeline series, and deletes records', () => {
      const ledger = new LedgerService(':memory:');
      const r1 = ledger.insertRecord({
        type: 'income',
        amount: 1000,
        category: 'Revenue',
        description: 'Day 1 milestone',
        occurredAt: '2026-11-01T08:00:00.000Z',
      });
      const r2 = ledger.insertRecord({
        type: 'expense',
        amount: 250,
        category: 'Compute',
        description: 'Day 1 GPU',
        occurredAt: '2026-11-01T14:00:00.000Z',
      });
      const r3 = ledger.insertRecord({
        type: 'expense',
        amount: 150,
        category: 'Storage',
        description: 'Day 2 S3',
        occurredAt: '2026-11-02T09:00:00.000Z',
      });
      const r4 = ledger.insertRecord({
        type: 'expense',
        amount: 100,
        category: 'Compute',
        description: 'Day 2 inference',
        occurredAt: '2026-11-02T16:00:00.000Z',
      });

      // Filter by type and category
      const expenses = ledger.getRecords({ type: 'expense' });
      assert.equal(expenses.length, 3);
      const computeExpenses = ledger.getRecords({ category: 'compute' });
      assert.equal(computeExpenses.length, 2);

      // Date range & pagination
      const day2Only = ledger.getRecords({
        fromDate: '2026-11-02T00:00:00.000Z',
        toDate: '2026-11-02T23:59:59.999Z',
      });
      assert.equal(day2Only.length, 2);
      assert.equal(day2Only[0].id, r4.id);

      const paged = ledger.getRecords({ limit: 2, offset: 1 });
      assert.equal(paged.length, 2);
      assert.equal(paged[0].id, r3.id);
      assert.equal(paged[1].id, r2.id);

      // Category breakdown
      const breakdown = ledger.getCategoryBreakdown({ type: 'expense' });
      assert.equal(breakdown.length, 2);
      assert.equal(breakdown[0].category, 'Compute');
      assert.equal(breakdown[0].totalAmount, 350);
      assert.equal(breakdown[0].sharePct, 70);
      assert.equal(breakdown[1].category, 'Storage');
      assert.equal(breakdown[1].totalAmount, 150);
      assert.equal(breakdown[1].sharePct, 30);

      // Timeline series & cumulative balance
      const timeline = ledger.getTimelineSeries();
      assert.equal(timeline.length, 2);
      assert.deepEqual(timeline[0], {
        date: '2026-11-01',
        income: 1000,
        expenses: 250,
        net: 750,
        cumulativeBalance: 750,
        count: 2,
      });
      assert.deepEqual(timeline[1], {
        date: '2026-11-02',
        income: 0,
        expenses: 250,
        net: -250,
        cumulativeBalance: 500,
        count: 2,
      });

      // Delete record and verify balance updates
      assert.equal(ledger.deleteRecord(r2.id), true);
      assert.equal(ledger.deleteRecord('ldg_nonexistent'), false);
      const summary = ledger.getSummary();
      assert.equal(summary.balance.totalExpenses, 250);
      assert.equal(summary.balance.netBalance, 750);
      assert.equal(summary.recentRecords.some((r) => r.id === r1.id), true);
      assert.equal(summary.recentRecords.some((r) => r.id === r2.id), false);

      ledger.close();
    });

    await runCase('5. CLI runner executes add, balance, list, summary, and delete commands against SQLite', () => {
      const cliDbPath = path.join(tmpDir, 'cli.sqlite');
      const cliService = new LedgerService(cliDbPath);

      const addOut1 = JSON.parse(
        runLedgerCli(['add', 'income', '500', 'Grant', 'Cloud credits'], cliService)
      );
      assert.equal(addOut1.ok, true);
      assert.equal(addOut1.record.amount, 500);

      const addOut2 = JSON.parse(
        runLedgerCli(['add', 'expense', '125.5', 'API', 'Gateway usage'], cliService)
      );
      assert.equal(addOut2.ok, true);

      const balOut = JSON.parse(runLedgerCli(['balance'], cliService));
      assert.equal(balOut.balance.netBalance, 374.5);

      const listOut = JSON.parse(runLedgerCli(['list', '10'], cliService));
      assert.equal(listOut.count, 2);

      const sumOut = JSON.parse(runLedgerCli(['summary'], cliService));
      assert.equal(sumOut.summary.engine, 'node:sqlite');
      assert.equal(sumOut.summary.totalRecords, 2);

      const delOut = JSON.parse(runLedgerCli(['delete', addOut2.record.id], cliService));
      assert.equal(delOut.deleted, true);

      cliService.close();
    });

    await runCase('6. Threshold monitoring detects OK, APPROACHING, and EXCEEDED states and persists limits in SQLite', () => {
      const dbFile = path.join(tmpDir, 'threshold.sqlite');
      const ledger1 = new LedgerService(dbFile);

      // Set a $500 limit with 80% warning threshold ($400)
      const initial = ledger1.setBudgetLimit(500);
      assert.equal(initial.budgetLimit, 500);
      assert.equal(initial.level, 'OK');
      assert.equal(initial.warningTriggered, false);
      assert.equal(initial.exceeded, false);

      ledger1.insertRecord({ type: 'expense', amount: 410, category: 'Compute' });
      const approaching = ledger1.checkBudgetThreshold();
      assert.equal(approaching.level, 'APPROACHING');
      assert.equal(approaching.warningTriggered, true);
      assert.equal(approaching.exceeded, false);
      assert.equal(approaching.utilizationPct, 82);

      ledger1.insertRecord({ type: 'expense', amount: 150, category: 'Storage' });
      const exceeded = ledger1.checkBudgetThreshold();
      assert.equal(exceeded.level, 'EXCEEDED');
      assert.equal(exceeded.warningTriggered, true);
      assert.equal(exceeded.exceeded, true);
      assert.equal(exceeded.totalExpenses, 560);
      assert.equal(exceeded.exceededBy, 60);
      assert.equal(exceeded.remainingBudget, 0);
      ledger1.close();

      // Reopen SQLite file and confirm budget limit & exceeded alert persist
      const ledger2 = new LedgerService(dbFile);
      const persistedSummary = ledger2.getSummary();
      assert.equal(persistedSummary.threshold.source, 'sqlite');
      assert.equal(persistedSummary.threshold.budgetLimit, 500);
      assert.equal(persistedSummary.threshold.exceeded, true);
      assert.throws(() => ledger2.setBudgetLimit(0), /budget limit/i);
      ledger2.close();
    });

    await runCase('7. Supports date-range filtering and category-based sorting across getSummary & getCategoryBreakdown', () => {
      const ledger = new LedgerService(':memory:');
      ledger.setBudgetLimit(300);

      ledger.insertRecord({
        type: 'expense',
        amount: 250,
        category: 'Storage',
        occurredAt: '2026-11-01T10:00:00.000Z',
      });
      ledger.insertRecord({
        type: 'expense',
        amount: 90,
        category: 'Compute',
        occurredAt: '2026-11-05T10:00:00.000Z',
      });
      ledger.insertRecord({
        type: 'expense',
        amount: 120,
        category: 'API',
        occurredAt: '2026-11-10T10:00:00.000Z',
      });
      ledger.insertRecord({
        type: 'expense',
        amount: 30,
        category: 'Compute',
        occurredAt: '2026-11-12T10:00:00.000Z',
      });

      // Date range excluding Nov 1 ($250) leaves $240 total (below $300 limit, exactly 80% -> APPROACHING)
      const rangedSummary = ledger.getSummary({
        fromDate: '2026-11-05T00:00:00.000Z',
        toDate: '2026-11-12T23:59:59.999Z',
        sortBy: 'name_asc',
      });
      assert.equal(rangedSummary.balance.totalExpenses, 240);
      assert.equal(rangedSummary.threshold.exceeded, false);
      assert.equal(rangedSummary.threshold.level, 'APPROACHING');
      assert.deepEqual(
        rangedSummary.categoryBreakdown.map((c) => c.category),
        ['API', 'Compute']
      );

      // Sort by amount_asc across full range
      const ascBreakdown = ledger.getCategoryBreakdown({ type: 'expense', sortBy: 'amount_asc' });
      assert.deepEqual(
        ascBreakdown.map((c) => c.category),
        ['API', 'Compute', 'Storage']
      );

      // Sort by count_desc puts Compute (2 entries) first
      const countBreakdown = ledger.getCategoryBreakdown({ type: 'expense', sortBy: 'count_desc' });
      assert.equal(countBreakdown[0].category, 'Compute');
      assert.equal(countBreakdown[0].count, 2);

      // CLI budget subcommand
      const cliBudget = JSON.parse(runLedgerCli(['budget', 'check'], ledger));
      assert.equal(cliBudget.threshold.exceeded, true);

      ledger.close();
    });


    await runCase('8. Keeps balances, category totals, timelines, and records isolated by currency', () => {
      const ledger = new LedgerService(':memory:');
      ledger.insertRecord({ type: 'income', amount: 1000, category: 'Sales', currency: 'USD', occurredAt: '2026-11-14T08:00:00.000Z' });
      ledger.insertRecord({ type: 'expense', amount: 250, category: 'Compute', currency: 'USD', occurredAt: '2026-11-14T09:00:00.000Z' });
      ledger.insertRecord({ type: 'income', amount: 35000, category: 'Sales', currency: 'THB', occurredAt: '2026-11-14T08:00:00.000Z' });
      ledger.insertRecord({ type: 'expense', amount: 9000, category: 'Compute', currency: 'THB', occurredAt: '2026-11-14T09:00:00.000Z' });

      const usd = ledger.getBalance({ currency: 'USD' });
      const thb = ledger.getBalance({ currency: 'THB' });
      assert.equal(usd.totalIncome, 1000);
      assert.equal(usd.totalExpenses, 250);
      assert.equal(usd.netBalance, 750);
      assert.equal(usd.recordCount, 2);
      assert.equal(thb.totalIncome, 35000);
      assert.equal(thb.totalExpenses, 9000);
      assert.equal(thb.netBalance, 26000);
      assert.equal(thb.recordCount, 2);

      assert.equal(ledger.getRecords({ currency: 'THB' }).length, 2);
      assert.equal(ledger.getCategoryBreakdown({ currency: 'USD', type: 'expense' })[0].totalAmount, 250);
      assert.equal(ledger.getCategoryBreakdown({ currency: 'THB', type: 'expense' })[0].totalAmount, 9000);
      assert.equal(ledger.getTimelineSeries({ currency: 'USD' })[0].expenses, 250);
      assert.equal(ledger.getTimelineSeries({ currency: 'THB' })[0].expenses, 9000);

      const usdBudget = ledger.setBudgetLimit(500, { currency: 'USD' });
      const thbBudget = ledger.setBudgetLimit(10000, { currency: 'THB' });
      assert.equal(usdBudget.level, 'OK');
      assert.equal(thbBudget.level, 'APPROACHING');
      assert.equal(ledger.checkBudgetThreshold({ currency: 'USD' }).budgetLimit, 500);
      assert.equal(ledger.checkBudgetThreshold({ currency: 'THB' }).budgetLimit, 10000);

      const usdSummary = ledger.getSummary({ currency: 'USD' });
      assert.equal(usdSummary.balance.recordCount, 2);
      assert.equal(usdSummary.recentRecords.every((record) => record.currency === 'USD'), true);
      assert.equal(usdSummary.filters.currency, 'USD');
      ledger.close();
    });



    await runCase('9. Migrates legacy tenant-only budget rows without losing configured limits', () => {
      const dbFile = path.join(tmpDir, 'legacy-budget.sqlite');
      const legacyDb = new DatabaseSync(dbFile);
      legacyDb.exec(`
        CREATE TABLE ledger_budgets (
          tenant_id TEXT PRIMARY KEY,
          budget_limit REAL NOT NULL CHECK (budget_limit > 0),
          warning_ratio REAL NOT NULL DEFAULT 0.8 CHECK (warning_ratio > 0 AND warning_ratio <= 1),
          currency TEXT NOT NULL DEFAULT 'USD',
          updated_at TEXT NOT NULL
        );
        INSERT INTO ledger_budgets (tenant_id, budget_limit, warning_ratio, currency, updated_at)
        VALUES ('legacy-tenant', 750, 0.75, 'USD', '2026-11-14T00:00:00.000Z');
      `);
      legacyDb.close();

      const ledger = new LedgerService(dbFile);
      const migrated = ledger.checkBudgetThreshold({ tenantId: 'legacy-tenant', currency: 'USD' });
      assert.equal(migrated.budgetLimit, 750);
      assert.equal(migrated.warningRatio, 0.75);
      ledger.setBudgetLimit(1200, { tenantId: 'legacy-tenant', currency: 'THB' });
      assert.equal(ledger.checkBudgetThreshold({ tenantId: 'legacy-tenant', currency: 'USD' }).budgetLimit, 750);
      assert.equal(ledger.checkBudgetThreshold({ tenantId: 'legacy-tenant', currency: 'THB' }).budgetLimit, 1200);
      ledger.close();
    });

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
