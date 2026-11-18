import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Activity, Clock, Play, TrendingUp, Zap } from 'lucide-react';

export interface StepLatencyPoint {
  step: number;
  latencyMs: number;
  elapsedMs: number;
  tag: string;
  message: string;
  raw: string;
  timestamp: string;
}

interface PerformanceTrendsChartProps {
  points: StepLatencyPoint[];
  isRunning?: boolean;
  lang?: 'th' | 'en';
  compact?: boolean;
  onOpenQuickTask?: () => void;
  onNavigateCommandCenter?: () => void;
}

function getTagColor(tag: string): string {
  const upper = tag.toUpperCase();
  if (upper === 'ERROR' || upper === 'FAIL' || upper === 'FATAL') return 'var(--z-danger)';
  if (upper === 'DONE' || upper === 'VERIFIED' || upper === 'SUCCESS') return 'var(--z-ok)';
  if (upper === 'TESTER' || upper === 'WARN') return 'var(--app-amber)';
  return 'var(--app-accent)';
}

export const PerformanceTrendsChart: React.FC<PerformanceTrendsChartProps> = ({
  points,
  isRunning = false,
  lang = 'en',
  compact = false,
  onOpenQuickTask,
  onNavigateCommandCenter,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredStep, setHoveredStep] = useState<StepLatencyPoint | null>(null);
  const [showMovingAvg, setShowMovingAvg] = useState(true);

  const stats = useMemo(() => {
    if (points.length === 0) {
      return {
        latestMs: 0,
        avgMs: 0,
        maxMs: 0,
        minMs: 0,
        totalMs: 0,
      };
    }
    const latencies = points.map((p) => p.latencyMs);
    return {
      latestMs: latencies[latencies.length - 1] ?? 0,
      avgMs: Math.round(d3.mean(latencies) ?? 0),
      maxMs: d3.max(latencies) ?? 0,
      minMs: d3.min(latencies) ?? 0,
      totalMs: d3.sum(latencies),
    };
  }, [points]);

  const movingAvgPoints = useMemo(() => {
    if (points.length === 0) return [];
    return points.map((pt, idx) => {
      const start = Math.max(0, idx - 2);
      const windowSlice = points.slice(start, idx + 1).map((p) => p.latencyMs);
      return {
        step: pt.step,
        avgMs: d3.mean(windowSlice) ?? pt.latencyMs,
      };
    });
  }, [points]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (points.length === 0) return;

    const width = 680;
    const height = compact ? 180 : 250;
    const margin = {
      top: 16,
      right: 20,
      bottom: 30,
      left: 48,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const defs = svg.append('defs');
    const areaGrad = defs
      .append('linearGradient')
      .attr('id', compact ? 'perf-area-grad-compact' : 'perf-area-grad-full')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--app-accent)')
      .attr('stop-opacity', 0.34);
    areaGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--app-accent)')
      .attr('stop-opacity', 0.02);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xMin = points.length === 1 ? 0 : 1;
    const xMax = points.length === 1 ? 2 : points.length;
    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);

    const rawMaxY = d3.max(points, (d) => d.latencyMs) ?? 10;
    const yMax = Math.max(10, Math.ceil(rawMaxY * 1.18));
    const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

    // Horizontal gridlines
    const yGrid = d3
      .axisLeft(yScale)
      .ticks(4)
      .tickSize(-innerWidth)
      .tickFormat(() => '');

    g.append('g')
      .attr('class', 'grid-lines')
      .call(yGrid)
      .call((sel) => sel.select('.domain').remove())
      .call((sel) =>
        sel
          .selectAll('line')
          .attr('stroke', 'var(--app-card-border)')
          .attr('stroke-dasharray', '3,3')
          .attr('stroke-opacity', 0.6)
      );

    // X Axis
    const tickCount = Math.min(points.length, 8);
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(tickCount)
      .tickFormat((d) => {
        const val = Number(d);
        return Number.isInteger(val) && val >= 1 ? `#${val}` : '';
      });

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .call((sel) =>
        sel.select('.domain').attr('stroke', 'var(--app-card-border)')
      )
      .call((sel) =>
        sel.selectAll('line').attr('stroke', 'var(--app-card-border)')
      )
      .call((sel) =>
        sel
          .selectAll('text')
          .attr('fill', 'var(--app-text-secondary)')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    // Y Axis
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(4)
      .tickFormat((d) => `${Number(d)}ms`);

    g.append('g')
      .call(yAxis)
      .call((sel) => sel.select('.domain').remove())
      .call((sel) => sel.selectAll('line').remove())
      .call((sel) =>
        sel
          .selectAll('text')
          .attr('fill', 'var(--app-text-secondary)')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    // Area under latency line
    const areaGen = d3
      .area<StepLatencyPoint>()
      .x((d) => xScale(d.step))
      .y0(innerHeight)
      .y1((d) => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', `url(#${compact ? 'perf-area-grad-compact' : 'perf-area-grad-full'})`)
      .attr('d', areaGen);

    // Primary D3 Line Chart
    const lineGen = d3
      .line<StepLatencyPoint>()
      .x((d) => xScale(d.step))
      .y((d) => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', 'var(--app-accent)')
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', lineGen);

    // Optional Moving Average Trend Line
    if (showMovingAvg && movingAvgPoints.length >= 2) {
      const avgLineGen = d3
        .line<{ step: number; avgMs: number }>()
        .x((d) => xScale(d.step))
        .y((d) => yScale(d.avgMs))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(movingAvgPoints)
        .attr('fill', 'none')
        .attr('stroke', 'var(--app-amber)')
        .attr('stroke-width', 1.6)
        .attr('stroke-dasharray', '4,4')
        .attr('stroke-opacity', 0.9)
        .attr('d', avgLineGen);
    }

    // Data point nodes with accessible hit targets
    const nodes = g
      .selectAll<SVGGElement, StepLatencyPoint>('g.latency-node')
      .data(points)
      .enter()
      .append('g')
      .attr('class', 'latency-node')
      .attr('transform', (d) => `translate(${xScale(d.step)},${yScale(d.latencyMs)})`)
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => setHoveredStep(d))
      .on('mouseleave', () => setHoveredStep(null))
      .on('click', (_event, d) => setHoveredStep(d));

    nodes.append('circle').attr('r', 10).attr('fill', 'transparent');

    nodes
      .append('circle')
      .attr('r', (d) => (hoveredStep?.step === d.step ? 5.5 : 3.8))
      .attr('fill', (d) => getTagColor(d.tag))
      .attr('stroke', 'var(--app-bg)')
      .attr('stroke-width', 1.5);
  }, [points, movingAvgPoints, showMovingAvg, compact, hoveredStep]);

  return (
    <div
      data-testid="performance-trends-view"
      className="space-y-3"
    >
      {/* Header & KPI Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] flex items-center justify-center text-[var(--app-accent)]">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs sm:text-sm font-bold text-[var(--app-text-primary)]">
                {lang === 'th' ? 'แนวโน้มประสิทธิภาพ (Performance Trends)' : 'Performance Trends'}
              </h4>
              {isRunning && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-[color-mix(in_srgb,var(--z-ok)_18%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--z-ok)] animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <p className="text-[10px] text-[var(--app-text-secondary)]">
              {lang === 'th'
                ? 'แผนภูมิเส้น D3 แสดงความหน่วงของขั้นตอนเอเจนต์ (ms) ตามลำดับบันทึกแบบเรียลไทม์'
                : 'D3 line chart visualizing real-time agent step latency (ms) across the log sequence'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
          <button
            type="button"
            onClick={() => setShowMovingAvg((prev) => !prev)}
            aria-pressed={showMovingAvg}
            className={`px-2 py-1 rounded-md border transition-colors cursor-pointer ${
              showMovingAvg
                ? 'bg-[color-mix(in_srgb,var(--app-amber)_16%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_45%,transparent)] font-bold'
                : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
            }`}
          >
            {lang === 'th' ? 'ค่าเฉลี่ยเคลื่อนที่ (3-Step)' : '3-Step Moving Avg'}
          </button>
          {onOpenQuickTask && (
            <button
              type="button"
              onClick={onOpenQuickTask}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-bold bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_26%,transparent)] cursor-pointer"
            >
              <Play className="w-3 h-3" />
              {lang === 'th' ? 'เปิด Execution Terminal' : 'Open Terminal'}
            </button>
          )}
        </div>
      </div>

      {/* Stat Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
        <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="text-[10px] text-[var(--app-text-secondary)] flex items-center gap-1">
            <Zap className="w-3 h-3 text-[var(--app-accent)]" />
            <span>{lang === 'th' ? 'ความหน่วงล่าสุด' : 'Latest Step'}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-[var(--app-text-primary)] tabular-nums">
            {points.length > 0 ? `${stats.latestMs} ms` : '—'}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="text-[10px] text-[var(--app-text-secondary)] flex items-center gap-1">
            <Activity className="w-3 h-3 text-[var(--app-amber)]" />
            <span>{lang === 'th' ? 'ค่าเฉลี่ย/ขั้นตอน' : 'Mean Latency'}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-[var(--app-amber)] tabular-nums">
            {points.length > 0 ? `${stats.avgMs} ms` : '—'}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="text-[10px] text-[var(--app-text-secondary)] flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-[var(--z-danger)]" />
            <span>{lang === 'th' ? 'ความหน่วงสูงสุด' : 'Peak Latency'}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-[var(--z-danger)] tabular-nums">
            {points.length > 0 ? `${stats.maxMs} ms` : '—'}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="text-[10px] text-[var(--app-text-secondary)] flex items-center gap-1">
            <Clock className="w-3 h-3 text-[var(--z-ok)]" />
            <span>{lang === 'th' ? 'เวลารวมทั้งหมด' : 'Cumulative'}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-[var(--z-ok)] tabular-nums">
            {points.length > 0 ? `${stats.totalMs} ms (${points.length})` : '0 steps'}
          </div>
        </div>
      </div>

      {/* D3 Chart Canvas */}
      <div className="relative rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] p-3">
        {points.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center text-center gap-3 text-xs text-[var(--app-text-secondary)] ${
              compact ? 'h-36' : 'h-52'
            }`}
          >
            <TrendingUp className="w-6 h-6 text-[var(--app-accent)] opacity-70" />
            <span className="font-semibold text-[var(--app-text-primary)]">
              {lang === 'th'
                ? 'เริ่มต้นสั่งงานแรกของคุณใน Command Center'
                : 'Start your first task'}
            </span>
            {(onNavigateCommandCenter || onOpenQuickTask) && (
              <button
                type="button"
                onClick={onNavigateCommandCenter || onOpenQuickTask}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--app-accent)] text-slate-950 text-xs font-bold hover:opacity-95 cursor-pointer"
              >
                <Play className="w-3 h-3" />
                <span>{lang === 'th' ? 'ไปที่ Command Center' : 'Go to Command Center'}</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              data-testid="d3-performance-trends-chart"
              role="img"
              aria-label="Performance Trends D3 Line Chart"
              className={`w-full ${compact ? 'h-44' : 'h-60'} overflow-visible`}
            />
            {hoveredStep && (
              <div
                data-testid="perf-trends-tooltip"
                className="mt-2 px-3 py-2 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] text-[10px] font-mono flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="px-1.5 py-0.5 rounded font-bold border"
                    style={{
                      color: getTagColor(hoveredStep.tag),
                      borderColor: getTagColor(hoveredStep.tag),
                    }}
                  >
                    Step #{hoveredStep.step} · [{hoveredStep.tag}]
                  </span>
                  <span className="text-[var(--app-text-primary)] truncate max-w-[360px]">
                    {hoveredStep.message || hoveredStep.raw}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 tabular-nums">
                  <span className="text-[var(--app-accent)] font-bold">
                    Latency: {hoveredStep.latencyMs} ms
                  </span>
                  <span className="text-[var(--app-text-secondary)]">
                    Elapsed: {hoveredStep.elapsedMs} ms
                  </span>
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-mono text-[var(--app-text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-[var(--app-accent)] inline-block" />
                {lang === 'th' ? 'ความหน่วงต่อขั้นตอน (ms)' : 'Step Latency (ms)'}
              </span>
              {showMovingAvg && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t border-dashed border-[var(--app-amber)] inline-block" />
                  {lang === 'th' ? 'ค่าเฉลี่ยเคลื่อนที่' : '3-Step Moving Avg'}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[var(--z-ok)]" /> DONE
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[var(--app-amber)]" /> TESTER
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[var(--z-danger)]" /> ERROR
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
