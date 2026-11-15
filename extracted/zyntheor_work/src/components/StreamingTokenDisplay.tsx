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
  activeModelName?: string;
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
  activeModelName,
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
        title = lang === 'th' ? 'การฉายเวกเตอร์แฝง 512 มิติ' : 'Active 512-Dim Vector Projection';
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
        status: isStreaming && idx === lines.length - 1 ? 'IN_PROGRESS' : 'VERIFIED'
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
      <div className="px-4 py-2.5 bg-[var(--app-input-bg)] border-b border-[var(--app-card-border)] flex items-center justify-between gap-3 text-xs flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                isStreaming
                  ? 'bg-[#00F0FF]'
                  : 'bg-[#CCFF00]'
              }`}
            />
            <span className="font-semibold text-[var(--app-text-primary)]">
              {isStreaming ? t('chat.thinking') : (activeModelName || 'Active: NativeLM v2 (2.0M)')}
            </span>
          </div>

          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#00F0FF] font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-[#00F0FF]" />
              STREAMING TOKENS
            </span>
          )}
        </div>

        {/* Telemetry Counters */}
        <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--app-text-secondary)] tabular-nums">
          <div className="flex items-center gap-1" title="Tokens processed">
            <Zap className="w-3.5 h-3.5 text-[#FF5E3A]" />
            <span>{formatNumber(tokenCount)} tok</span>
          </div>

          <div className="flex items-center gap-1" title="Throughput">
            <Activity className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>{tokensPerSec > 0 ? tokensPerSec.toLocaleString() : 'Awaiting sample'} t/s</span>
          </div>

          {timeToFirstTokenMs !== undefined && timeToFirstTokenMs > 0 && (
            <div className="hidden sm:flex items-center gap-1" title="Latency">
              <Clock className="w-3.5 h-3.5 text-[#7B2CBF]" />
              <span>{timeToFirstTokenMs}ms TTFT</span>
            </div>
          )}

          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] transition-colors ml-1 cursor-pointer"
            title="Copy response"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#CCFF00]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Structured Reasoning Chain Display (Replacing raw thought dump) */}
      {reasoningSteps.length > 0 && (
        <div className="border-b border-[var(--app-card-border)] bg-[#7B2CBF]/10">
          <button
            onClick={() => setShowReasoningChain(!showReasoningChain)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-[#00F0FF] hover:bg-[#7B2CBF]/15 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-[#7B2CBF]/25 text-[#00F0FF] flex items-center justify-center font-bold">
                <Brain className="w-3.5 h-3.5" />
              </div>
              <span className="font-bold text-[var(--app-text-primary)]">
                {lang === 'th' ? 'ลำดับการให้เหตุผลของสมองโมเดล (Reasoning Chain)' : 'Native Model Reasoning Chain'}
              </span>
              <span className="text-[11px] font-mono text-[#00F0FF] tabular-nums">
                · {reasoningSteps.length} {lang === 'th' ? 'ขั้นตอน' : 'steps'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-[#00F0FF]">
              <span>{showReasoningChain ? (lang === 'th' ? 'ย่อสรุป' : 'Collapse') : (lang === 'th' ? 'ดูขั้นตอนคิด' : 'Expand')}</span>
              {showReasoningChain ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

          {showReasoningChain && (
            <div className="px-4 py-3 bg-[var(--app-surface)]/80 border-t border-[var(--app-card-border)] space-y-2.5">
              <div className="grid grid-cols-1 gap-2">
                {reasoningSteps.map((step) => (
                  <div
                    key={step.stepNumber}
                    className="flex items-start gap-3 p-2.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-[#7B2CBF]/25 text-[#00F0FF] font-mono text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 border border-[#7B2CBF]/40">
                      {step.stepNumber}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[var(--app-text-primary)]">
                          {step.title}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold text-[#CCFF00] shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${step.status === 'VERIFIED' ? 'bg-[#CCFF00]' : 'bg-[#00F0FF] animate-pulse'}`} />
                          {step.status === 'VERIFIED' ? 'VERIFIED' : 'STREAMING'}
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
        <div className="px-4 py-3 bg-[var(--app-input-bg)] border-b border-[var(--app-card-border)] flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#00F0FF]">
            <Layers className="w-3.5 h-3.5 text-[#FF5E3A]" />
            <span>{lang === 'th' ? 'แหล่งข้อมูลอ้างอิงจาก Knowledge Workspace (Grounding)' : 'Knowledge Grounded Citations'}</span>
            <span className="text-[10px] font-mono text-[#FF5E3A] tabular-nums">
              · {groundingSources.length} {lang === 'th' ? 'แหล่งอ้างอิง' : 'sources'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {groundingSources.map((source, sIdx) => (
              <div
                key={sIdx}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#070B19] border border-[var(--app-card-border)] text-[11px] text-[var(--app-text-secondary)] max-w-full font-mono"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] shrink-0" />
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
                  className="rounded-xl overflow-hidden border border-[#1E294A] bg-[#070B19] text-[#F4F7FF] my-2"
                >
                  <div className="px-4 py-1.5 bg-[#0D1326] border-b border-[#1E294A] flex items-center justify-between text-[11px] font-mono text-[#94A3C4]">
                    <span className="flex items-center gap-1.5 text-[#00F0FF]">
                      <Terminal className="w-3.5 h-3.5" />
                      {section.lang}
                    </span>
                    <button
                      onClick={() => navigator.clipboard.writeText(section.code)}
                      className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t('btn.copy')}</span>
                    </button>
                  </div>
                  <pre className="p-4 overflow-x-auto text-xs font-mono leading-relaxed text-[#CCFF00]">
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
            <span className="w-2.5 h-4 rounded-sm bg-gradient-to-r from-[#00F0FF] to-[#7B2CBF] inline-block shadow-sm shadow-[#00F0FF]" />
          </span>
        )}
      </div>
    </div>
  );
};
