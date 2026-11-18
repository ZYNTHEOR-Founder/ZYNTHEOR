import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Activity, ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';
import { RollingIntegrityPoint } from '../utils/rollingIntegrity';
import { useLanguage } from '../context/LanguageContext';

export interface RollingIntegrityChartProps {
  points: RollingIntegrityPoint[];
  status?: 'INTACT' | 'TAMPERED' | 'UNSEALED' | 'EMPTY' | 'CHECKING';
  title?: string;
  subtitle?: string;
  theme?: 'dark' | 'light';
  height?: number;
  className?: string;
}

export const RollingIntegrityChart: React.FC<RollingIntegrityChartProps> = ({
  points,
  status = 'INTACT',
  title,
  subtitle,
  theme = 'dark',
  height = 148,
  className = ''
}) => {
  const { lang } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState<number>(560);
  const [hoveredPoint, setHoveredPoint] = useState<RollingIntegrityPoint | null>(null);

  const stats = useMemo(() => {
    if (points.length === 0) {
      return { latest: 0, avg: 0, min: 0, anomalies: 0 };
    }
    const scores = points.map((p) => p.score);
    const latest = scores[scores.length - 1];
    const sum = scores.reduce((acc, v) => acc + v, 0);
    const min = Math.min(...scores);
    const anomalies = points.filter((p) => p.severity !== 'intact').length;
    return {
      latest: Math.round(latest * 10) / 10,
      avg: Math.round((sum / scores.length) * 10) / 10,
      min: Math.round(min * 10) / 10,
      anomalies
    };
  }, [points]);

  const effectiveTone: 'emerald' | 'amber' | 'rose' = useMemo(() => {
    if (status === 'TAMPERED' || stats.latest < 60 || points.some((p) => p.severity === 'tampered')) {
      return 'rose';
    }
    if (status === 'UNSEALED' || stats.latest < 85 || stats.anomalies > 0) {
      return 'amber';
    }
    return 'emerald';
  }, [status, stats, points]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const next = Math.floor(el.clientWidth);
      if (next > 120) setWidth(next);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (points.length === 0) return;

    const margin = { top: 12, right: 14, bottom: 24, left: 36 };
    const innerW = Math.max(80, width - margin.left - margin.right);
    const innerH = Math.max(50, height - margin.top - margin.bottom);

    const strokeHex =
      effectiveTone === 'rose' ? 'var(--z-danger)' : effectiveTone === 'amber' ? 'var(--z-warn)' : 'var(--app-accent)';
    const gridStroke = theme === 'dark' ? 'color-mix(in srgb, var(--app-accent) 16%, transparent)' : 'color-mix(in srgb, var(--app-accent) 10%, transparent)';
    const axisColor = theme === 'dark' ? 'var(--app-text-secondary)' : 'var(--app-accent)';

    const defs = svg.append('defs');
    const gradId = `rolling-integrity-grad-${effectiveTone}-${theme}`;
    const grad = defs
      .append('linearGradient')
      .attr('id', gradId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', strokeHex).attr('stop-opacity', 0.34);
    grad.append('stop').attr('offset', '100%').attr('stop-color', strokeHex).attr('stop-opacity', 0.02);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xDomainMax = Math.max(1, points.length - 1);
    const xScale = d3.scaleLinear().domain([0, xDomainMax]).range([0, innerW]);
    const yScale = d3.scaleLinear().domain([0, 105]).range([innerH, 0]);

    // Horizontal gridlines (0, 50, 80, 100)
    const yTicks = [0, 50, 80, 100];
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', (d) => (d === 80 ? 'color-mix(in srgb, var(--z-warn) 38%, transparent)' : gridStroke))
      .attr('stroke-dasharray', (d) => (d === 80 || d === 50 ? '3,3' : 'none'))
      .attr('stroke-width', 1);

    // Y axis
    const yAxis = d3
      .axisLeft(yScale)
      .tickValues([0, 50, 100])
      .tickFormat((d) => `${d}%`)
      .tickSize(0);
    g.append('g')
      .call(yAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', axisColor)
      .attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace');

    // X axis showing entry indices
    const tickCount = Math.min(points.length, 6);
    const xTickIndices =
      points.length <= 1
        ? [0]
        : Array.from(new Set(d3.range(tickCount).map((i) => Math.round((i / (tickCount - 1)) * (points.length - 1)))));

    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(xTickIndices)
      .tickFormat((d) => {
        const pt = points[Number(d)];
        return pt ? `#${pt.index}` : '';
      })
      .tickSize(3);

    const xAxisGroup = g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis);
    xAxisGroup.select('.domain').attr('stroke', gridStroke);
    xAxisGroup.selectAll('line').attr('stroke', gridStroke);
    xAxisGroup
      .selectAll('text')
      .attr('fill', axisColor)
      .attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Area & Line
    const areaGen = d3
      .area<RollingIntegrityPoint>()
      .x((_, i) => (points.length === 1 ? innerW / 2 : xScale(i)))
      .y0(innerH)
      .y1((d) => yScale(d.score))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(points).attr('fill', `url(#${gradId})`).attr('d', areaGen);

    const lineGen = d3
      .line<RollingIntegrityPoint>()
      .x((_, i) => (points.length === 1 ? innerW / 2 : xScale(i)))
      .y((d) => yScale(d.score))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', strokeHex)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round')
      .attr('d', lineGen);

    // Anomaly + terminal dots
    g.selectAll('.integrity-dot')
      .data(
        points.map((pt, i) => ({ pt, i })).filter(({ pt, i }) => pt.severity !== 'intact' || i === points.length - 1)
      )
      .enter()
      .append('circle')
      .attr('cx', ({ i }) => (points.length === 1 ? innerW / 2 : xScale(i)))
      .attr('cy', ({ pt }) => yScale(pt.score))
      .attr('r', ({ pt, i }) => (pt.severity === 'tampered' ? 4.5 : i === points.length - 1 ? 3.5 : 3))
      .attr('fill', ({ pt }) =>
        pt.severity === 'tampered' || pt.severity === 'error'
          ? 'var(--z-danger)'
          : pt.severity === 'warning'
          ? 'var(--z-warn)'
          : strokeHex
      )
      .attr('stroke', theme === 'dark' ? 'var(--app-accent)' : '#FFFFFF')
      .attr('stroke-width', 1.5);

    // Hover focus indicator + overlay
    const hoverLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', axisColor)
      .attr('stroke-dasharray', '2,2')
      .attr('stroke-width', 1)
      .style('opacity', 0);

    const hoverDot = g
      .append('circle')
      .attr('r', 4)
      .attr('fill', strokeHex)
      .attr('stroke', theme === 'dark' ? '#F0F7F3' : 'var(--app-accent)')
      .attr('stroke-width', 1.5)
      .style('opacity', 0);

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const idx =
          points.length === 1 ? 0 : Math.max(0, Math.min(points.length - 1, Math.round(xScale.invert(mx))));
        const pt = points[idx];
        if (!pt) return;
        const cx = points.length === 1 ? innerW / 2 : xScale(idx);
        const cy = yScale(pt.score);
        hoverLine.attr('x1', cx).attr('x2', cx).style('opacity', 0.8);
        hoverDot.attr('cx', cx).attr('cy', cy).style('opacity', 1);
        setHoveredPoint(pt);
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0);
        hoverDot.style('opacity', 0);
        setHoveredPoint(null);
      });
  }, [points, width, height, effectiveTone, theme]);

  const isDark = theme === 'dark';
  const activePoint = hoveredPoint ?? (points.length > 0 ? points[points.length - 1] : null);

  return (
    <div
      className={`rounded-xl border font-mono ${
        isDark ? 'bg-[var(--app-surface)] border-[var(--app-card-border)] text-[var(--app-text-primary)]' : 'bg-[color-mix(in_srgb,var(--app-surface-elevated)_90%,transparent)] border-[var(--app-card-border)] text-[var(--app-text-primary)]'
      } ${className}`}
    >
      <div
        className={`px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 border-b ${
          isDark ? 'border-[var(--app-card-border)]' : 'border-[var(--app-card-border)]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {effectiveTone === 'rose' ? (
            <ShieldAlert className="w-4 h-4 text-[var(--z-danger)] shrink-0" />
          ) : effectiveTone === 'amber' ? (
            <AlertTriangle className="w-4 h-4 text-[var(--z-warn)] shrink-0" />
          ) : (
            <Activity className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-tight flex items-center gap-2">
              <span>
                {title ||
                  (lang === 'th'
                    ? 'Rolling Integrity (50 รายการล่าสุด)'
                    : 'Rolling Integrity (Last 50 Entries)')}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border tabular-nums ${
                  effectiveTone === 'rose'
                    ? 'bg-[color-mix(in_srgb,var(--z-danger)_15%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
                    : effectiveTone === 'amber'
                    ? 'bg-[color-mix(in_srgb,var(--z-warn)_15%,transparent)] text-[var(--z-warn)] border-[color-mix(in_srgb,var(--z-warn)_40%,transparent)]'
                    : 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                }`}
              >
                {points.length > 0 ? `${stats.latest}%` : 'EMPTY'}
              </span>
            </div>
            {subtitle && (
              <div className={`text-[10px] truncate ${isDark ? 'text-[var(--app-text-secondary)]' : 'text-[var(--app-text-secondary)]'}`}>{subtitle}</div>
            )}
          </div>
        </div>

        <div className={`flex flex-wrap items-center gap-3 text-[10px] tabular-nums ${isDark ? 'text-[var(--app-text-secondary)]' : 'text-[var(--app-text-primary)]'}`}>
          <span>
            {lang === 'th' ? 'หน้าต่าง' : 'Window'}:{' '}
            <strong className={isDark ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-primary)]'}>{points.length}/50</strong>
          </span>
          <span>
            {lang === 'th' ? 'เฉลี่ย' : 'Avg'}:{' '}
            <strong className={isDark ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-primary)]'}>
              {points.length > 0 ? `${stats.avg}%` : '—'}
            </strong>
          </span>
          <span>
            {lang === 'th' ? 'ต่ำสุด' : 'Min'}:{' '}
            <strong className={stats.min < 80 && points.length > 0 ? 'text-[var(--z-danger)]' : isDark ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-primary)]'}>
              {points.length > 0 ? `${stats.min}%` : '—'}
            </strong>
          </span>
          <span>
            {lang === 'th' ? 'จุดผิดปกติ' : 'Anomalies'}:{' '}
            <strong className={stats.anomalies > 0 ? 'text-[var(--z-warn)]' : 'text-[var(--z-ok)]'}>{stats.anomalies}</strong>
          </span>
        </div>
      </div>

      <div ref={containerRef} className="px-2 pt-2 pb-1">
        {points.length === 0 ? (
          <div
            style={{ height }}
            className={`flex items-center justify-center text-[11px] italic ${
              isDark ? 'text-[color-mix(in_srgb,var(--app-text-secondary)_70%,transparent)]' : 'text-[var(--app-text-secondary)]'
            }`}
          >
            {lang === 'th'
              ? 'ยังไม่มีบันทึกสำหรับสร้างกราฟ Rolling Integrity (รอรายการแรกจากรันไทม์จริง)'
              : 'No log entries available yet — Rolling Integrity chart populates from live entries'}
          </div>
        ) : (
          <svg ref={svgRef} width={width} height={height} className="block w-full overflow-visible" />
        )}
      </div>

      {activePoint && (
        <div
          className={`px-3.5 py-1.5 flex flex-wrap items-center justify-between gap-2 border-t text-[10px] ${
            isDark ? 'border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] text-[var(--app-text-secondary)]' : 'border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-text-primary)_70%,transparent)] text-[var(--app-text-primary)]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ShieldCheck
              className={`w-3.5 h-3.5 shrink-0 ${
                activePoint.severity === 'tampered' || activePoint.severity === 'error'
                  ? 'text-[var(--z-danger)]'
                  : activePoint.severity === 'warning'
                  ? 'text-[var(--z-warn)]'
                  : 'text-[var(--z-ok)]'
              }`}
            />
            <span className={`font-bold shrink-0 tabular-nums ${isDark ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-primary)]'}`}>
              {activePoint.label} ({activePoint.score}%)
            </span>
            <span className="truncate">{activePoint.summary}</span>
          </div>
          <span className="font-mono text-[10px] opacity-80 shrink-0">SHA-256: {activePoint.hashDigest}</span>
        </div>
      )}
    </div>
  );
};
