import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Activity,
  Zap,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Clock,
  Terminal,
  Brain,
  CheckCircle2,
  ShieldCheck,
  Cpu,
  Layers,
  ArrowRight
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface StreamingTokenDisplayProps {
  content: string;
  isStreaming: boolean;
  thoughtContent?: string;
  tokenCount: number;
  tokensPerSec: number;
  timeToFirstTokenMs?: number;
  onCopy?: () => void;
}

interface ReasoningStep {
  stepNumber: number;
  title: string;
  summary: string;
  status: 'VERIFIED' | 'COMPLETED' | 'IN_PROGRESS';
}

export const StreamingTokenDisplay: React.FC<StreamingTokenDisplayProps> = ({
  content,
  isStreaming,
  thoughtContent,
  tokenCount,
  tokensPerSec,
  timeToFirstTokenMs,
  onCopy
}) => {
  const { t, lang, formatNumber } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [showReasoningChain, setShowReasoningChain] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    if (onCopy) onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse thoughtContent into structured Reasoning Chain steps
  const reasoningSteps: ReasoningStep[] = useMemo(() => {
    if (!thoughtContent) return [];

    const lines = thoughtContent
      .split('\n')
      .map((l) => l.trim().replace(/^[-*›\d.)\s]+/, '').trim())
      .filter(Boolean);

    if (lines.length === 0) return [];

    return lines.map((line, idx) => {
      let title = '';
      let summary = line;

      if (line.includes(':')) {
        const parts = line.split(':');
        title = parts[0].trim();
        summary = parts.slice(1).join(':').trim();
      } else if (idx === 0) {
        title = lang === 'th' ? 'วิเคราะห์เจตนาและคำสำคัญ' : 'Input Intent & Token Decomposition';
      } else if (idx === 1) {
        title = lang === 'th' ? 'การฉายเวกเตอร์แฝง 512 มิติ' : 'Latent Vector Space Projection';
      } else if (idx === 2) {
        title = lang === 'th' ? 'ตรวจสอบบริบทความจำและ Sandbox' : 'Memory Context & Sandbox Validation';
      } else if (idx === 3) {
        title = lang === 'th' ? 'การสังเคราะห์คำตอบแบบสองภาษา' : 'Sovereign Dual-Language Synthesis';
      } else {
        title = `${lang === 'th' ? 'ขั้นตอนการให้เหตุผล' : 'Reasoning Step'} ${idx + 1}`;
      }

      return {
        stepNumber: idx + 1,
        title,
        summary: summary || line,
        status: isStreaming && idx === lines.length - 1 ? 'IN_PROGRESS' : 'COMPLETED'
      };
    });
  }, [thoughtContent, lang, isStreaming]);

  // Extract and format grounding sources if present
  const { cleanContent, groundingSources } = useMemo(() => {
    if (!content) return { cleanContent: '', groundingSources: [] };
    const match = content.match(/<grounding_sources>([\s\S]*?)<\/grounding_sources>/);
    if (!match) return { cleanContent: content, groundingSources: [] };

    const sourcesBlock = match[1].trim();
    const sources = sourcesBlock
      .split('\n')
      .map((s) => s.replace(/^[•*-]\s*/, '').trim())
      .filter(Boolean);

    const withoutSources = content.replace(/<grounding_sources>[\s\S]*?<\/grounding_sources>/, '').trim();
    return { cleanContent: withoutSources, groundingSources: sources };
  }, [content]);

  // Split tokens or parse code blocks
  const formattedSections = useMemo(() => {
    if (!cleanContent) return [];
    const parts = cleanContent.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3).trim().split('\n');
        const langHeader = lines[0].match(/^[a-z0-9_-]+$/i) ? lines[0] : '';
        const code = langHeader ? lines.slice(1).join('\n') : lines.join('\n');
        return { type: 'code' as const, lang: langHeader || 'javascript', code, id: idx };
      }
      return { type: 'text' as const, text: part, id: idx };
    });
  }, [cleanContent]);

  return (
    <div className="relative rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] shadow-sm overflow-hidden transition-all duration-200">
      {/* Top Telemetry & Status Bar */}
      <div className="px-4 py-2.5 bg-[color-mix(in_srgb,var(--app-surface-elevated)_90%,transparent)] dark:bg-[color-mix(in_srgb,var(--app-bg)_90%,transparent)] border-b border-[var(--app-card-border)] flex items-center justify-between gap-3 text-xs flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                isStreaming
                  ? 'bg-[var(--app-accent)] animate-ping'
                  : 'bg-[var(--z-ok)]'
              }`}
            />
            <span className="font-semibold text-[var(--app-text-primary)]">
              {isStreaming ? t('chat.thinking') : 'Native Model Runtime'}
            </span>
          </div>

          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--app-accent)] font-semibold animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              GENERATING OUTPUT
            </span>
          )}
        </div>

        {/* Telemetry Counters */}
        <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--app-text-secondary)]">
          <div className="flex items-center gap-1" title="Stream chunks received">
            <Zap className="w-3.5 h-3.5 text-[var(--z-warn)]" />
            <span>{formatNumber(tokenCount)} chunks</span>
          </div>

          <div className="flex items-center gap-1" title="Throughput">
            <Activity className="w-3.5 h-3.5 text-[var(--app-accent)]" />
            <span>{tokensPerSec > 0 ? `${tokensPerSec.toLocaleString()} t/s` : '—'}</span>
          </div>

          {timeToFirstTokenMs !== undefined && timeToFirstTokenMs > 0 && (
            <div className="hidden sm:flex items-center gap-1" title="Latency">
              <Clock className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              <span>{timeToFirstTokenMs}ms TTFT</span>
            </div>
          )}

          <button
            onClick={handleCopy}
            className="p-1 rounded-md text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_70%,transparent)] dark:hover:bg-[var(--app-surface)] transition-colors ml-1 cursor-pointer"
            title="Copy response"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--z-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Structured Reasoning Chain Display (Replacing raw thought dump) */}
      {reasoningSteps.length > 0 && (
        <div className="border-b border-[var(--app-accent)] dark:border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] dark:bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)]">
          <button
            onClick={() => setShowReasoningChain(!showReasoningChain)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)] flex items-center justify-center font-bold">
                <Brain className="w-3.5 h-3.5" />
              </div>
              <span className="font-bold">
                {lang === 'th' ? 'ลำดับการให้เหตุผลของสมองโมเดล (Reasoning Chain)' : 'Native Model Reasoning Chain'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] text-[10px] font-mono text-[var(--app-accent)] font-bold">
                {reasoningSteps.length} {lang === 'th' ? 'ขั้นตอน' : 'Steps'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-[color-mix(in_srgb,var(--app-accent)_80%,transparent)]">
              <span>{showReasoningChain ? (lang === 'th' ? 'ย่อสรุป' : 'Collapse') : (lang === 'th' ? 'ดูขั้นตอนคิด' : 'Expand')}</span>
              {showReasoningChain ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

          {showReasoningChain && (
            <div className="px-4 py-3 bg-[color-mix(in_srgb,var(--app-surface)_70%,transparent)] border-t border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] dark:border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] space-y-2.5">
              <div className="grid grid-cols-1 gap-2">
                {reasoningSteps.map((step) => (
                  <div
                    key={step.stepNumber}
                    className="flex items-start gap-3 p-2.5 rounded-xl bg-[var(--app-card)] border border-[var(--app-card-border)] shadow-2xs transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-[var(--app-accent)] dark:text-[var(--app-accent)] font-mono text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 border border-[color-mix(in_srgb,var(--app-accent)_20%,transparent)]">
                      {step.stepNumber}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[var(--app-text-primary)]">
                          {step.title}
                        </span>
                        <span className="text-[10px] font-mono font-semibold text-[var(--app-text-secondary)] bg-[var(--app-surface-elevated)] px-1.5 py-0.5 rounded border border-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] shrink-0">
                          {step.status === 'VERIFIED' ? 'VERIFIED' : step.status === 'COMPLETED' ? 'COMPLETED' : 'IN PROGRESS'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--app-text-secondary)] mt-0.5 leading-relaxed font-sans">
                        {step.summary}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Knowledge Grounding Citations */}
      {groundingSources.length > 0 && (
        <div className="px-4 py-3 bg-[color-mix(in_srgb,var(--app-surface-elevated)_60%,transparent)] border-b border-[var(--app-card-border)] flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-accent)]">
            <Layers className="w-3.5 h-3.5 text-[var(--app-amber)]" />
            <span>{lang === 'th' ? 'แหล่งข้อมูลอ้างอิงจาก Knowledge Workspace (Grounding)' : 'Knowledge Grounded Citations'}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)]">
              {groundingSources.length} {lang === 'th' ? 'แหล่งอ้างอิง' : 'Sources'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {groundingSources.map((source, sIdx) => (
              <div
                key={sIdx}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[11px] text-[var(--app-text-secondary)] max-w-full font-mono"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-accent)] shrink-0" />
                <span className="truncate">{source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Streamed Output Display */}
      <div
        ref={scrollRef}
        className="p-4 md:p-6 text-sm text-[var(--app-text-primary)] leading-relaxed font-sans max-h-[500px] overflow-y-auto space-y-3"
      >
        {formattedSections.length === 0 && !isStreaming ? (
          <div className="text-[var(--app-text-secondary)] italic text-xs">Waiting for model input...</div>
        ) : (
          formattedSections.map((section) => {
            if (section.type === 'code') {
              return (
                <div
                  key={section.id}
                  className="rounded-xl overflow-hidden border border-[var(--app-card-border)] bg-[var(--app-bg)] text-[var(--app-text-primary)] my-2"
                >
                  <div className="px-4 py-1.5 bg-[var(--app-surface)] border-b border-[var(--app-card-border)] flex items-center justify-between text-[11px] font-mono text-[var(--app-text-secondary)]">
                    <span className="flex items-center gap-1.5 text-[var(--app-accent)]">
                      <Terminal className="w-3.5 h-3.5" />
                      {section.lang}
                    </span>
                    <button
                      onClick={() => navigator.clipboard.writeText(section.code)}
                      className="hover:text-[var(--app-text-primary)] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t('btn.copy')}</span>
                    </button>
                  </div>
                  <pre className="p-4 overflow-x-auto text-xs font-mono leading-relaxed text-[var(--z-ok)]">
                    <code>{section.code}</code>
                  </pre>
                </div>
              );
            }
            return (
              <div key={section.id} className="whitespace-pre-wrap">
                {section.text}
              </div>
            );
          })
        )}

        {/* Dynamic Vivid Streaming Cursor */}
        {isStreaming && (
          <span className="inline-flex items-center ml-1">
            <span className="w-2.5 h-4 rounded-sm bg-[var(--app-accent)] animate-pulse inline-block shadow-sm shadow-[var(--app-accent)]" />
          </span>
        )}
      </div>
    </div>
  );
};
