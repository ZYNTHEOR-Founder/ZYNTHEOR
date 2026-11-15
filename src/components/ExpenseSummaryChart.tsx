import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  Database,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  LedgerClient,
  type LedgerCategoryBreakdown,
  type LedgerCategorySort,
  type LedgerRecordType,
  type LedgerSummary,
  type LedgerSummaryQueryOptions,
  type LedgerTimelinePoint,
} from '../services/LedgerClient';
import { VividCard } from './ui/VividCard';
import { Button } from './ui/Button';
import { StatusDot } from './ui/StatusBadge';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

type ChartViewMode = 'categories' | 'timeline';
type CategoryTypeFilter = 'all' | 'expense';

const CATEGORY_PALETTE = [
  'var(--app-accent)', // Electric Cyan
  'var(--z-warn)', // Coral Orange
  'var(--app-accent-deep)', // Brilliant Violet
  'var(--z-danger)', // Vivid Magenta
  'var(--app-accent-deep)', // Neon Blue
  'var(--z-ok)', // Luminous Lime
];

function formatCurrency(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function toIsoBoundary(dateStr: string, boundary: 'start' | 'end'): string | undefined {
  if (!dateStr) return undefined;
  return boundary === 'start' ? `${dateStr}T00:00:00.000Z` : `${dateStr}T23:59:59.999Z`;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const ExpenseSummaryChart: React.FC = () => {
  const { lang } = useLanguage();
  const { isAuthenticated, token } = useAuth();
  const ledgerClient = useMemo(() => LedgerClient.getInstance(), []);

  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ChartViewMode>('categories');

  // Filter & Sorting State
  const [fromDateInput, setFromDateInput] = useState('');
  const [toDateInput, setToDateInput] = useState('');
  const [categorySort, setCategorySort] = useState<LedgerCategorySort>('amount_desc');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<CategoryTypeFilter>('expense');

  // Budget Threshold Config State
  const [budgetEditorOpen, setBudgetEditorOpen] = useState(false);
  const [budgetLimitInput, setBudgetLimitInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  // Form state for adding real SQLite ledger entries
  const [recordType, setRecordType] = useState<LedgerRecordType>('expense');
  const [amountInput, setAmountInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('Compute');
  const [descriptionInput, setDescriptionInput] = useState('');

  // D3 chart refs & responsive width
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(620);
  const [hoverInfo, setHoverInfo] = useState<{
    title: string;
    primary: string;
    secondary: string;
  } | null>(null);

  const activeQueryOptions = useMemo<LedgerSummaryQueryOptions>(
    () => ({
      limit: 12,
      fromDate: toIsoBoundary(fromDateInput, 'start'),
      toDate: toIsoBoundary(toDateInput, 'end'),
      sortBy: categorySort,
    }),
    [categorySort, fromDateInput, toDateInput]
  );

  const loadSummary = useCallback(async () => {
    try {
      setError(null);
      const data = await ledgerClient.getSummary(activeQueryOptions);
      setSummary(data);
      setBudgetLimitInput((prev) => (prev ? prev : String(data.threshold.budgetLimit)));
    } catch (err: any) {
      setError(err?.message || 'Unable to load SQLite ledger summary');
    } finally {
      setLoading(false);
    }
  }, [activeQueryOptions, ledgerClient]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, token]);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.clientWidth);
      if (next > 160) setChartWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const categories = useMemo<LedgerCategoryBreakdown[]>(() => {
    const raw = summary?.categoryBreakdown ?? [];
    if (categoryTypeFilter === 'expense') {
      return raw.filter((item) => item.type === 'expense');
    }
    return raw;
  }, [categoryTypeFilter, summary]);

  const timeline = useMemo<LedgerTimelinePoint[]>(
    () => summary?.timeline ?? [],
    [summary]
  );

  // D3 rendering for Category Breakdown and Cashflow Timeline
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const hasCategories = categories.length > 0;
    const hasTimeline = timeline.length > 0;
    if ((viewMode === 'categories' && !hasCategories) || (viewMode === 'timeline' && !hasTimeline)) {
      return;
    }

    const chartHeight =
      viewMode === 'categories'
        ? Math.max(210, Math.min(360, categories.slice(0, 8).length * 38 + 46))
        : 246;

    svg.attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`).attr('height', chartHeight);

    const axisTextColor = 'var(--app-text-secondary)';
    const gridColor = 'color-mix(in srgb, var(--app-accent) 14%, transparent)';

    if (viewMode === 'categories') {
      const topItems = categories.slice(0, 8);
      const margin = { top: 14, right: 86, bottom: 26, left: 118 };
      const innerW = Math.max(100, chartWidth - margin.left - margin.right);
      const innerH = Math.max(80, chartHeight - margin.top - margin.bottom);

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      const maxVal = d3.max(topItems, (d) => d.totalAmount) || 1;

      const xScale = d3.scaleLinear().domain([0, maxVal * 1.14]).range([0, innerW]);
      const yKey = (d: LedgerCategoryBreakdown) => `${d.category} (${d.type})`;
      const yScale = d3
        .scaleBand<string>()
        .domain(topItems.map(yKey))
        .range([0, innerH])
        .padding(0.28);

      const ticks = xScale.ticks(4);
      g.selectAll('.x-grid')
        .data(ticks)
        .enter()
        .append('line')
        .attr('x1', (d) => xScale(d))
        .attr('x2', (d) => xScale(d))
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', gridColor)
        .attr('stroke-dasharray', '3,3');

      g.append('g')
        .attr('transform', `translate(0,${innerH})`)
        .call(
          d3
            .axisBottom(xScale)
            .ticks(4)
            .tickFormat((v) => `$${d3.format('~s')(Number(v))}`)
        )
        .call((axisG) => axisG.select('.domain').attr('stroke', 'color-mix(in srgb, var(--app-accent) 90%, transparent)'))
        .call((axisG) => axisG.selectAll('.tick line').remove())
        .call((axisG) =>
          axisG
            .selectAll('text')
            .attr('fill', axisTextColor)
            .style('font-family', 'JetBrains Mono, monospace')
            .style('font-size', '10px')
        );

      g.append('g')
        .call(d3.axisLeft(yScale).tickSize(0))
        .call((axisG) => axisG.select('.domain').remove())
        .call((axisG) =>
          axisG
            .selectAll('text')
            .attr('fill', 'var(--app-text-primary)')
            .style('font-size', '11px')
            .style('font-weight', '600')
            .text((label) => {
              const s = String(label);
              return s.length > 17 ? `${s.slice(0, 16)}…` : s;
            })
        );

      g.selectAll('.bar-track')
        .data(topItems)
        .enter()
        .append('rect')
        .attr('x', 0)
        .attr('y', (d) => yScale(yKey(d)) ?? 0)
        .attr('width', innerW)
        .attr('height', yScale.bandwidth())
        .attr('rx', 6)
        .attr('fill', 'color-mix(in srgb, var(--app-accent) 72%, transparent)');

      g.selectAll('.bar-value')
        .data(topItems)
        .enter()
        .append('rect')
        .attr('x', 0)
        .attr('y', (d) => yScale(yKey(d)) ?? 0)
        .attr('width', (d) => Math.max(4, xScale(d.totalAmount)))
        .attr('height', yScale.bandwidth())
        .attr('rx', 6)
        .attr('fill', (d, idx) =>
          d.type === 'income' ? 'var(--z-ok)' : CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length]
        )
        .attr('fill-opacity', 0.9)
        .style('cursor', 'pointer')
        .on('mouseenter', (_event, d) => {
          setHoverInfo({
            title: `${d.category} · ${d.type.toUpperCase()}`,
            primary: formatCurrency(d.totalAmount, summary?.balance.currency || 'USD'),
            secondary: `${d.count} ${d.count === 1 ? 'record' : 'records'} · ${d.sharePct}% of ${d.type}`,
          });
        })
        .on('mouseleave', () => setHoverInfo(null));

      g.selectAll('.bar-label')
        .data(topItems)
        .enter()
        .append('text')
        .attr('x', (d) => xScale(d.totalAmount) + 8)
        .attr('y', (d) => (yScale(yKey(d)) ?? 0) + yScale.bandwidth() / 2 + 4)
        .attr('fill', 'var(--app-text-primary)')
        .style('font-family', 'JetBrains Mono, monospace')
        .style('font-size', '11px')
        .style('font-weight', '600')
        .text((d) => `${formatCurrency(d.totalAmount, summary?.balance.currency || 'USD')}`);

      return;
    }

    // Timeline mode
    const margin = { top: 18, right: 20, bottom: 30, left: 56 };
    const innerW = Math.max(120, chartWidth - margin.left - margin.right);
    const innerH = Math.max(100, chartHeight - margin.top - margin.bottom);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xBand = d3
      .scaleBand<string>()
      .domain(timeline.map((d) => d.date))
      .range([0, innerW])
      .padding(0.28);

    const yMin = Math.min(0, d3.min(timeline, (d) => d.cumulativeBalance) ?? 0);
    const yMax = Math.max(
      10,
      d3.max(timeline, (d) => Math.max(d.income, d.expenses, d.cumulativeBalance)) ?? 10
    );

    const yScale = d3
      .scaleLinear()
      .domain([yMin * 1.1, yMax * 1.15])
      .nice()
      .range([innerH, 0]);

    g.selectAll('.y-grid')
      .data(yScale.ticks(4))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', (d) => (d === 0 ? 'color-mix(in srgb, var(--app-accent) 35%, transparent)' : gridColor))
      .attr('stroke-dasharray', (d) => (d === 0 ? 'none' : '3,3'));

    const maxTicks = Math.max(2, Math.floor(innerW / 80));
    const step = Math.max(1, Math.ceil(timeline.length / maxTicks));
    const tickValues = timeline
      .filter((_, i) => i % step === 0 || i === timeline.length - 1)
      .map((d) => d.date);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xBand).tickValues(tickValues))
      .call((axisG) => axisG.select('.domain').attr('stroke', 'color-mix(in srgb, var(--app-accent) 90%, transparent)'))
      .call((axisG) => axisG.selectAll('.tick line').remove())
      .call((axisG) =>
        axisG
          .selectAll('text')
          .attr('fill', axisTextColor)
          .style('font-family', 'JetBrains Mono, monospace')
          .style('font-size', '10px')
          .text((val) => String(val).slice(5))
      );

    g.append('g')
      .call(
        d3
          .axisLeft(yScale)
          .ticks(4)
          .tickFormat((v) => `$${d3.format('~s')(Number(v))}`)
      )
      .call((axisG) => axisG.select('.domain').remove())
      .call((axisG) => axisG.selectAll('.tick line').remove())
      .call((axisG) =>
        axisG
          .selectAll('text')
          .attr('fill', axisTextColor)
          .style('font-family', 'JetBrains Mono, monospace')
          .style('font-size', '10px')
      );

    const zeroY = yScale(0);
    const subWidth = Math.max(4, Math.min(22, xBand.bandwidth() / 2.2));

    g.selectAll('.bar-income')
      .data(timeline)
      .enter()
      .append('rect')
      .attr('x', (d) => (xBand(d.date) ?? 0) + xBand.bandwidth() / 2 - subWidth - 1)
      .attr('y', (d) => yScale(d.income))
      .attr('width', subWidth)
      .attr('height', (d) => Math.max(0, zeroY - yScale(d.income)))
      .attr('rx', 3)
      .attr('fill', 'var(--z-ok)')
      .attr('fill-opacity', 0.85);

    g.selectAll('.bar-expense')
      .data(timeline)
      .enter()
      .append('rect')
      .attr('x', (d) => (xBand(d.date) ?? 0) + xBand.bandwidth() / 2 + 1)
      .attr('y', (d) => yScale(d.expenses))
      .attr('width', subWidth)
      .attr('height', (d) => Math.max(0, zeroY - yScale(d.expenses)))
      .attr('rx', 3)
      .attr('fill', 'var(--z-warn)')
      .attr('fill-opacity', 0.9);

    const lineGen = d3
      .line<LedgerTimelinePoint>()
      .x((d) => (xBand(d.date) ?? 0) + xBand.bandwidth() / 2)
      .y((d) => yScale(d.cumulativeBalance))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(timeline)
      .attr('fill', 'none')
      .attr('stroke', 'var(--app-accent)')
      .attr('stroke-width', 2.4)
      .attr('d', lineGen);

    g.selectAll('.balance-dot')
      .data(timeline)
      .enter()
      .append('circle')
      .attr('cx', (d) => (xBand(d.date) ?? 0) + xBand.bandwidth() / 2)
      .attr('cy', (d) => yScale(d.cumulativeBalance))
      .attr('r', 4.5)
      .attr('fill', 'var(--app-accent)')
      .attr('stroke', 'var(--app-accent)')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => {
        setHoverInfo({
          title: d.date,
          primary: `Net ${formatCurrency(d.cumulativeBalance, summary?.balance.currency || 'USD')}`,
          secondary: `+${formatCurrency(d.income)} in · -${formatCurrency(d.expenses)} out (${d.count})`,
        });
      })
      .on('mouseleave', () => setHoverInfo(null));
  }, [categories, chartWidth, summary?.balance.currency, timeline, viewMode]);

  const handleInsertRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setMutationError(null);
    const parsedAmount = Number(amountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setMutationError(lang === 'th' ? 'กรุณาระบุจำนวนเงินที่มากกว่า 0' : 'Amount must be greater than 0.');
      return;
    }
    if (!categoryInput.trim()) {
      setMutationError(lang === 'th' ? 'กรุณาระบุหมวดหมู่' : 'Category is required.');
      return;
    }
    if (!isAuthenticated) {
      setMutationError(
        lang === 'th'
          ? 'กรุณาเข้าสู่ระบบก่อนบันทึกรายการลง SQLite'
          : 'Sign in required before writing records to SQLite.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await ledgerClient.insertRecord(
        {
          type: recordType,
          amount: parsedAmount,
          category: categoryInput.trim(),
          description: descriptionInput.trim(),
        },
        activeQueryOptions
      );
      setSummary(result.summary);
      setAmountInput('');
      setDescriptionInput('');
    } catch (err: any) {
      setMutationError(err?.message || 'Failed to record ledger entry');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRecord = async (id: string) => {
    setMutationError(null);
    if (!isAuthenticated) {
      setMutationError(
        lang === 'th'
          ? 'กรุณาเข้าสู่ระบบก่อนลบรายการ'
          : 'Sign in required before deleting SQLite records.'
      );
      return;
    }
    setDeletingId(id);
    try {
      const result = await ledgerClient.deleteRecord(id, activeQueryOptions);
      setSummary(result.summary);
    } catch (err: any) {
      setMutationError(err?.message || 'Failed to delete ledger record');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveBudgetLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMutationError(null);
    const parsed = Number(budgetLimitInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMutationError(lang === 'th' ? 'วงเงินงบประมาณต้องมากกว่า 0' : 'Budget limit must be greater than 0.');
      return;
    }
    if (!isAuthenticated) {
      setMutationError(
        lang === 'th'
          ? 'กรุณาเข้าสู่ระบบก่อนอัปเดตวงเงินงบประมาณ'
          : 'Sign in required before updating the SQLite budget limit.'
      );
      return;
    }
    setSavingBudget(true);
    try {
      const result = await ledgerClient.setBudgetLimit(parsed, undefined, activeQueryOptions);
      setSummary(result.summary);
      setBudgetEditorOpen(false);
    } catch (err: any) {
      setMutationError(err?.message || 'Failed to update budget limit');
    } finally {
      setSavingBudget(false);
    }
  };

  const applyDatePreset = (preset: 'all' | '7d' | '30d' | 'month') => {
    if (preset === 'all') {
      setFromDateInput('');
      setToDateInput('');
      return;
    }
    const end = todayYmd();
    if (preset === '7d') {
      setFromDateInput(daysAgoYmd(6));
      setToDateInput(end);
    } else if (preset === '30d') {
      setFromDateInput(daysAgoYmd(29));
      setToDateInput(end);
    } else {
      setFromDateInput(`${end.slice(0, 7)}-01`);
      setToDateInput(end);
    }
  };

  const balance = summary?.balance;
  const threshold = summary?.threshold;
  const currency = balance?.currency || 'USD';
  const hasDateFilter = Boolean(fromDateInput || toDateInput);
  const hasChartData = viewMode === 'categories' ? categories.length > 0 : timeline.length > 0;
  const utilizationClamped = Math.min(100, Math.max(0, threshold?.utilizationPct ?? 0));

  return (
    <VividCard
      title={lang === 'th' ? 'สรุปค่าใช้จ่ายและงบดุลสด (SQLite Ledger · D3)' : 'Live Expense Ledger Summary (SQLite · D3)'}
      subtitle={
        lang === 'th'
          ? 'ดึงข้อมูลตรงจาก LedgerService บนฐานข้อมูล SQLite พร้อมระบบเตือนงบประมาณและตัวกรองวันที่'
          : 'Pulled directly from the persistent SQLite LedgerService with budget threshold monitoring, date filtering & sorting'
      }
      gradientAccent={threshold?.exceeded ? 'magenta' : threshold?.warningTriggered ? 'coral' : 'sunset'}
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('categories')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                viewMode === 'categories'
                  ? 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)]'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
              }`}
            >
              {lang === 'th' ? 'หมวดหมู่' : 'Categories'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                viewMode === 'timeline'
                  ? 'bg-[color-mix(in_srgb,var(--app-accent-deep)_25%,transparent)] text-[var(--app-accent)]'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
              }`}
            >
              {lang === 'th' ? 'กระแสเงินสด' : 'Cashflow'}
            </button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadSummary()}
            leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            {lang === 'th' ? 'รีเฟรช' : 'Refresh'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Threshold Monitoring Warning Banner */}
        {threshold && threshold.warningTriggered && (
          <div
            role="alert"
            className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              threshold.exceeded
                ? 'border-[color-mix(in_srgb,var(--z-danger)_65%,transparent)] bg-gradient-to-r from-[color-mix(in_srgb,var(--z-danger)_18%,transparent)] via-[color-mix(in_srgb,var(--app-accent-deep)_15%,transparent)] to-[var(--app-surface)]'
                : 'border-[color-mix(in_srgb,var(--z-warn)_60%,transparent)] bg-gradient-to-r from-[color-mix(in_srgb,var(--z-warn)_18%,transparent)] via-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] to-[var(--app-surface)]'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`mt-0.5 p-2 rounded-xl border shrink-0 ${
                  threshold.exceeded
                    ? 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] border-[color-mix(in_srgb,var(--z-danger)_50%,transparent)] text-[var(--z-danger)]'
                    : 'bg-[color-mix(in_srgb,var(--z-warn)_20%,transparent)] border-[color-mix(in_srgb,var(--z-warn)_50%,transparent)] text-[var(--z-warn)]'
                }`}
              >
                {threshold.exceeded ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs font-extrabold font-mono ${
                      threshold.exceeded ? 'text-[var(--z-danger)]' : 'text-[var(--z-warn)]'
                    }`}
                  >
                    {threshold.exceeded
                      ? lang === 'th'
                        ? 'แจ้งเตือน: รายจ่ายเกินงบประมาณที่กำหนด'
                        : 'BUDGET THRESHOLD EXCEEDED'
                      : lang === 'th'
                      ? 'แจ้งเตือน: รายจ่ายใกล้ถึงขีดจำกัดงบประมาณ'
                      : 'APPROACHING BUDGET THRESHOLD'}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--app-text-primary)]">
                    {threshold.utilizationPct}% ({formatCurrency(threshold.totalExpenses, threshold.currency)} /{' '}
                    {formatCurrency(threshold.budgetLimit, threshold.currency)})
                  </span>
                </div>
                <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--app-text-primary)_90%,transparent)]">{threshold.message}</p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBudgetEditorOpen((v) => !v)}
              leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            >
              {lang === 'th' ? 'ปรับวงเงิน' : 'Adjust Limit'}
            </Button>
          </div>
        )}

        {/* Live SQLite Balance & Budget KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--app-text-secondary)]">
              <span>{lang === 'th' ? 'ยอดคงเหลือสุทธิ' : 'Net Balance'}</span>
              <Wallet className="h-3.5 w-3.5 text-[var(--app-accent)]" />
            </div>
            <div
              className="mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums"
              style={{
                color:
                  (balance?.netBalance ?? 0) < 0
                    ? 'var(--z-danger)'
                    : (balance?.netBalance ?? 0) > 0
                    ? 'var(--z-ok)'
                    : 'var(--app-text-primary)',
              }}
            >
              {balance ? formatCurrency(balance.netBalance, currency) : '—'}
            </div>
            <div className="mt-1 text-[10px] font-mono text-[var(--app-text-secondary)]">
              {balance ? `${balance.recordCount} ${lang === 'th' ? 'รายการที่ตรงเงื่อนไข' : 'matching records'}` : 'Loading...'}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--app-text-secondary)]">
              <span>{lang === 'th' ? 'รายจ่ายรวม' : 'Total Expenses'}</span>
              <ArrowDownRight className="h-3.5 w-3.5 text-[var(--z-warn)]" />
            </div>
            <div className="mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums text-[var(--z-danger)]">
              {balance ? formatCurrency(balance.totalExpenses, currency) : '—'}
            </div>
            <div className="mt-1 text-[10px] font-mono text-[var(--app-text-secondary)]">
              {balance ? `${balance.expenseCount} ${lang === 'th' ? 'รายการจ่าย' : 'expense entries'}` : '—'}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--app-text-secondary)]">
              <span>{lang === 'th' ? 'รายรับรวม' : 'Total Income'}</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-[var(--z-ok)]" />
            </div>
            <div className="mt-1.5 font-mono text-lg sm:text-xl font-bold tabular-nums text-[var(--z-ok)]">
              {balance ? formatCurrency(balance.totalIncome, currency) : '—'}
            </div>
            <div className="mt-1 text-[10px] font-mono text-[var(--app-text-secondary)]">
              {balance ? `${balance.incomeCount} ${lang === 'th' ? 'รายการรับ' : 'income entries'}` : '—'}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--app-text-secondary)]">
              <span>{lang === 'th' ? 'วงเงินงบประมาณ' : 'Budget Monitor'}</span>
              <button
                type="button"
                onClick={() => setBudgetEditorOpen((v) => !v)}
                className="text-[var(--app-accent)] hover:underline font-mono text-[10px] cursor-pointer"
              >
                {budgetEditorOpen ? (lang === 'th' ? 'ปิด' : 'Close') : (lang === 'th' ? 'แก้ไข' : 'Edit')}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="font-mono text-sm sm:text-base font-bold text-[var(--app-text-primary)] tabular-nums">
                {threshold ? formatCurrency(threshold.budgetLimit, threshold.currency) : '—'}
              </span>
              <StatusDot
                status={
                  threshold?.exceeded
                    ? 'FAILED'
                    : threshold?.warningTriggered
                    ? 'PARTIAL'
                    : 'VERIFIED'
                }
                label={threshold?.level || 'OK'}
              />
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--app-surface-elevated)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${utilizationClamped}%`,
                  backgroundColor: threshold?.exceeded
                    ? 'var(--z-danger)'
                    : threshold?.warningTriggered
                    ? 'var(--z-warn)'
                    : 'var(--app-accent)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Inline SQLite Budget Limit Editor */}
        {budgetEditorOpen && (
          <form
            onSubmit={(e) => void handleSaveBudgetLimit(e)}
            className="rounded-xl border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--app-bg)_90%,transparent)] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="text-xs text-[var(--app-text-secondary)]">
              <span className="font-semibold text-[var(--app-text-primary)]">
                {lang === 'th' ? 'กำหนดเพดานงบประมาณรายจ่าย (SQLite):' : 'Configure Expense Budget Limit (SQLite):'}
              </span>{' '}
              <span className="font-mono text-[11px]">
                {lang === 'th' ? 'เตือนล่วงหน้าที่ 80% และแจ้งเตือนวิกฤตเมื่อเกินวงเงิน' : 'Warns at 80% utilization and triggers alert when exceeded.'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={budgetLimitInput}
                onChange={(e) => setBudgetLimitInput(e.target.value)}
                className="w-32 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-mono text-[var(--app-text-primary)]"
                aria-label="Budget Limit"
              />
              <Button type="submit" size="sm" variant="primary" loading={savingBudget}>
                {lang === 'th' ? 'บันทึกวงเงิน' : 'Save Limit'}
              </Button>
            </div>
          </form>
        )}

        {/* Date-Range Filter & Category Sorting Toolbar */}
        <div className="rounded-2xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--app-text-secondary)] mr-1">
              <Calendar className="h-3.5 w-3.5 text-[var(--app-accent)]" />
              {lang === 'th' ? 'ช่วงวันที่' : 'Date Range'}
            </span>
            <input
              type="date"
              value={fromDateInput}
              onChange={(e) => setFromDateInput(e.target.value)}
              aria-label="From date"
              className="rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] font-mono text-[var(--app-text-primary)]"
            />
            <span className="text-[11px] text-[var(--app-text-secondary)]">→</span>
            <input
              type="date"
              value={toDateInput}
              onChange={(e) => setToDateInput(e.target.value)}
              aria-label="To date"
              className="rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] font-mono text-[var(--app-text-primary)]"
            />
            <div className="inline-flex items-center gap-1 ml-1">
              {(
                [
                  { id: 'all', label: lang === 'th' ? 'ทั้งหมด' : 'All' },
                  { id: '7d', label: '7D' },
                  { id: '30d', label: '30D' },
                  { id: 'month', label: lang === 'th' ? 'เดือนนี้' : 'Month' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyDatePreset(preset.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono font-semibold border transition-colors cursor-pointer ${
                    preset.id === 'all' && !hasDateFilter
                      ? 'border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]'
                      : 'border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--app-text-secondary)]">
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--app-accent-deep)]" />
              {lang === 'th' ? 'เรียงหมวดหมู่' : 'Category Sort'}
            </span>
            <select
              value={categorySort}
              onChange={(e) => setCategorySort(e.target.value as LedgerCategorySort)}
              aria-label="Sort categories"
              className="rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-text-primary)]"
            >
              <option value="amount_desc">{lang === 'th' ? 'ยอดรวม: สูง → ต่ำ' : 'Amount: High → Low'}</option>
              <option value="amount_asc">{lang === 'th' ? 'ยอดรวม: ต่ำ → สูง' : 'Amount: Low → High'}</option>
              <option value="name_asc">{lang === 'th' ? 'ชื่อหมวดหมู่: A → Z' : 'Category: A → Z'}</option>
              <option value="name_desc">{lang === 'th' ? 'ชื่อหมวดหมู่: Z → A' : 'Category: Z → A'}</option>
              <option value="count_desc">{lang === 'th' ? 'จำนวนรายการมากสุด' : 'Entry Count: High → Low'}</option>
            </select>
            <div className="inline-flex rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] p-0.5">
              <button
                type="button"
                onClick={() => setCategoryTypeFilter('expense')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-md cursor-pointer ${
                  categoryTypeFilter === 'expense'
                    ? 'bg-[color-mix(in_srgb,var(--z-warn)_20%,transparent)] text-[var(--z-danger)]'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {lang === 'th' ? 'เฉพาะรายจ่าย' : 'Expenses'}
              </button>
              <button
                type="button"
                onClick={() => setCategoryTypeFilter('all')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-md cursor-pointer ${
                  categoryTypeFilter === 'all'
                    ? 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)]'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {lang === 'th' ? 'ทั้งหมด' : 'All Types'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] px-4 py-3 text-xs font-mono text-[var(--z-danger)]">
            {error}
          </div>
        )}

        {/* D3 Interactive Chart + Recent Records & Quick Entry Split */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* D3 Visualization Surface */}
          <div className="xl:col-span-7 rounded-2xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_80%,transparent)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[var(--app-accent)]" />
                <span className="text-xs font-semibold text-[var(--app-text-primary)]">
                  {viewMode === 'categories'
                    ? lang === 'th'
                      ? 'สัดส่วนค่าใช้จ่ายและรายรับตามหมวดหมู่ (D3)'
                      : 'Category Distribution (D3)'
                    : lang === 'th'
                    ? 'แนวโน้มรายรับ-รายจ่ายและยอดสุทธิรายวัน (D3)'
                    : 'Daily Cashflow & Net Balance Curve (D3)'}
                </span>
              </div>
              {hoverInfo ? (
                <div className="text-[11px] font-mono text-[var(--app-accent)] flex items-center gap-2">
                  <span className="font-bold">{hoverInfo.title}:</span>
                  <span className="text-[var(--app-text-primary)]">{hoverInfo.primary}</span>
                  <span className="text-[var(--app-text-secondary)]">({hoverInfo.secondary})</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--app-text-secondary)]">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[var(--z-warn)]" /> Expense
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[var(--z-ok)]" /> Income
                  </span>
                  {viewMode === 'timeline' && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" /> Net Curve
                    </span>
                  )}
                </div>
              )}
            </div>

            <div ref={chartContainerRef} className="w-full min-h-[210px]">
              {hasChartData ? (
                <svg
                  ref={svgRef}
                  className="w-full overflow-visible block"
                  role="img"
                  aria-label="Live SQLite Expense Ledger D3 Visualization"
                />
              ) : (
                <div className="flex min-h-[210px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--app-card-border)] p-6 text-center">
                  <Database className="h-7 w-7 text-[color-mix(in_srgb,var(--app-accent)_70%,transparent)] mb-2" />
                  <p className="text-sm font-semibold text-[var(--app-text-primary)]">
                    {hasDateFilter
                      ? lang === 'th'
                        ? 'ไม่พบรายการในช่วงวันที่ที่เลือก'
                        : 'No ledger records match the selected date range'
                      : lang === 'th'
                      ? 'ยังไม่มีข้อมูลในฐานข้อมูล SQLite Ledger'
                      : 'No ledger records stored in SQLite yet'}
                  </p>
                  <p className="mt-1 max-w-md text-xs text-[var(--app-text-secondary)]">
                    {hasDateFilter
                      ? lang === 'th'
                        ? 'ปรับช่วงวันที่หรือกดปุ่ม "ทั้งหมด" เพื่อดูข้อมูลทั้งหมด'
                        : 'Adjust the date range or select "All" to view all persisted records.'
                      : lang === 'th'
                      ? 'บันทึกรายการจริงทางด้านขวาหรือรันคำสั่งผ่าน CLI เพื่อแสดงกราฟ D3 จากข้อมูลจริงทันที'
                      : 'Add a real expense or income record on the right (or via the CLI module) to visualize live SQLite data with D3.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Real SQLite Entry Form + Recent Records */}
          <div className="xl:col-span-5 space-y-4">
            <form
              onSubmit={(e) => void handleInsertRecord(e)}
              className="rounded-2xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_80%,transparent)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--app-text-primary)]">
                  {lang === 'th' ? 'บันทึกรายการลง SQLite' : 'Record Ledger Entry'}
                </span>
                <div className="inline-flex rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setRecordType('expense')}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${
                      recordType === 'expense'
                        ? 'bg-[color-mix(in_srgb,var(--z-warn)_20%,transparent)] text-[var(--z-danger)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    {lang === 'th' ? 'รายจ่าย' : 'Expense'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordType('income')}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${
                      recordType === 'income'
                        ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    {lang === 'th' ? 'รายรับ' : 'Income'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder={lang === 'th' ? 'จำนวนเงิน (เช่น 45.50)' : 'Amount (e.g. 45.50)'}
                  className="w-full rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-2 text-xs font-mono text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]"
                />
                <input
                  type="text"
                  required
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  placeholder={lang === 'th' ? 'หมวดหมู่ (เช่น Compute)' : 'Category (e.g. Compute)'}
                  className="w-full rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder={lang === 'th' ? 'รายละเอียดเพิ่มเติม (ไม่บังคับ)' : 'Description (optional)'}
                  className="flex-1 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={submitting}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  {lang === 'th' ? 'บันทึก' : 'Add'}
                </Button>
              </div>

              {mutationError && (
                <p className="text-[11px] font-mono text-[var(--z-danger)]">{mutationError}</p>
              )}
            </form>

            {/* Recent Persisted Records */}
            <div className="rounded-2xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_80%,transparent)] p-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-[var(--app-text-primary)]">
                  {lang === 'th' ? 'รายการล่าสุดใน SQLite' : 'Recent SQLite Records'}
                </span>
                <span className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                  {summary?.recentRecords.length ?? 0} / {summary?.totalRecords ?? 0}
                </span>
              </div>
              {summary && summary.recentRecords.length > 0 ? (
                <div className="max-h-44 overflow-y-auto divide-y divide-[var(--app-card-border)]">
                  {summary.recentRecords.slice(0, 6).map((rec) => (
                    <div key={rec.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              rec.type === 'income' ? 'bg-[var(--z-ok)]' : 'bg-[var(--z-warn)]'
                            }`}
                          />
                          <span className="text-xs font-semibold text-[var(--app-text-primary)] truncate">
                            {rec.category}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                            {rec.occurredAt.slice(0, 10)}
                          </span>
                        </div>
                        {rec.description && (
                          <div className="text-[11px] text-[var(--app-text-secondary)] truncate pl-4">
                            {rec.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-mono text-xs font-bold tabular-nums ${
                            rec.type === 'income' ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
                          }`}
                        >
                          {rec.type === 'income' ? '+' : '-'}
                          {formatCurrency(rec.amount, rec.currency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteRecord(rec.id)}
                          disabled={deletingId === rec.id}
                          title={lang === 'th' ? 'ลบรายการ' : 'Delete record'}
                          className="p-1 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] hover:bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--app-text-secondary)]">
                  {hasDateFilter
                    ? lang === 'th'
                      ? 'ไม่พบรายการในช่วงวันที่ที่เลือก'
                      : 'No entries in selected date range.'
                    : lang === 'th'
                    ? 'ยังไม่มีรายการที่บันทึกไว้'
                    : 'No persisted entries found.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </VividCard>
  );
};
