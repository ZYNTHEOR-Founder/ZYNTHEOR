// ZYNTHEOR Sovereign Expense & Budget Ledger (ESM)
export class ExpenseLedger {
  constructor() { this.entries = []; }
  add(title, amount, category = 'general') {
    if (!title || amount < 0) throw new Error('Invalid expense entry');
    this.entries.push({ title, amount: Number(amount), category });
  }
  total() { return Number(this.entries.reduce((s, e) => s + e.amount, 0).toFixed(2)); }
  average() { return this.entries.length ? Number((this.total() / this.entries.length).toFixed(2)) : 0; }
}
const ledger = new ExpenseLedger();
ledger.add('Compute', 120.5, 'infra');
ledger.add('Storage', 29.5, 'infra');
if (ledger.total() !== 150 || ledger.average() !== 75) throw new Error('Ledger calculation invariant failed');
console.log('SUCCESS: ExpenseLedger verified:', JSON.stringify({ total: ledger.total(), average: ledger.average() }));