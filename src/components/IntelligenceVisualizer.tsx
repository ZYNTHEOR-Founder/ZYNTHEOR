import React, { useState, useEffect } from 'react';
import { VividCard } from './ui/VividCard';
import { useLanguage } from '../context/LanguageContext';
import {
  Brain,
  Cpu,
  Layers,
  Activity,
  HardDrive,
  Languages,
  ShieldCheck,
  Zap,
  Sparkles,
  Database,
  ArrowRight
} from 'lucide-react';

interface IntelligenceVisualizerProps {
  weightsLoaded?: boolean;
  totalParams?: number;
  tokensPerSec?: number;
  checkpointHash?: string;
  onNavigate?: (module: any) => void;
}

export const IntelligenceVisualizer: React.FC<IntelligenceVisualizerProps> = ({
  weightsLoaded = false,
  totalParams = 0,
  tokensPerSec = 0,
  checkpointHash = '',
  onNavigate
}) => {
  const { lang, formatNumber } = useLanguage();
  const [pulseIndex, setPulseIndex] = useState(0);
  const [activeLayer, setActiveLayer] = useState(4);

  // Dynamic neural synaptic pulse connected to live timer
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseIndex((prev) => (prev + 1) % 10);
      setActiveLayer((prev) => (prev + 1) % 10);
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  const layers = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    name: `Layer ${i + 1}`,
    heads: 8,
    dim: 512,
    active: i === activeLayer
  }));

  return (
    <VividCard
      title={lang === 'th' ? 'การแสดงผลการประมวลผลสมองประสาทเทียมสด (Live Neural Engine)' : 'Native Architecture Illustration'}
      subtitle={
        lang === 'th'
          ? 'ภาพประกอบสเปกเป้าหมาย 10 ชั้น, 8 หัว attention และมิติ 512 — ไม่ใช่ trace การอนุมานสด'
          : 'Illustration of the 10-layer target specification, 8 attention heads and 512-dimensional width; this is not a live inference trace.'
      }
      gradientAccent="cyan"
      className="!p-6"
    >
      <div className="space-y-6">
        {/* Top Intelligence Telemetry Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-2xl bg-[var(--app-surface-elevated)] dark:bg-[var(--app-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              <span>{lang === 'th' ? 'สถาปัตยกรรมโมเดล' : 'Model Architecture'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--app-text-primary)] mt-1 font-mono">
              10L · 8H · 512D
            </div>
            <div className="text-[10px] text-[var(--z-ok)] font-bold mt-0.5">
              {formatNumber(totalParams)} active params
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--app-surface-elevated)] dark:bg-[var(--app-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              <span>{lang === 'th' ? 'ความเร็วประมวลผล' : 'Token Throughput'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--app-text-primary)] mt-1 font-mono">
              {tokensPerSec > 0 ? `${formatNumber(tokensPerSec)} t/s` : '—'}
            </div>
            <div className="text-[10px] text-[var(--app-accent)] font-bold mt-0.5">
              Measured runtime throughput
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--app-surface-elevated)] dark:bg-[var(--app-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              <span>{lang === 'th' ? 'ระบบสองภาษา' : 'Dual Vocabulary'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--app-text-primary)] mt-1 font-mono">
              16,384 Subwords
            </div>
            <div className="text-[10px] text-[var(--app-accent)] font-bold mt-0.5">
              Tokenizer evaluation pending
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--app-surface-elevated)] dark:bg-[var(--app-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)]" />
              <span>{lang === 'th' ? 'การรันแบบเอกเทศ' : 'Sovereignty'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--z-ok)] mt-1 font-mono">
              CLOUD RUNTIME
            </div>
            <div className="text-[10px] text-[var(--z-ok)] font-bold mt-0.5">
              Online checkpoint verification required
            </div>
          </div>
        </div>

        {/* Live SVG Neural Transformer Architecture Visualizer */}
        <div className="relative p-5 rounded-2xl bg-[var(--app-accent)] border border-[var(--app-card-border)] overflow-hidden shadow-inner">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-[var(--app-accent)] animate-pulse" />
              <span className="text-xs font-bold text-[var(--app-text-primary)]">
                {lang === 'th' ? 'โครงข่ายการประมวลผลหมอกเวกเตอร์ (Latent Manifold Projection)' : '10-Layer Transformer & Synaptic Attention Manifold'}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_80%,transparent)] text-[var(--app-accent)] text-[10px] font-mono border border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] font-bold">
              {weightsLoaded ? 'CHECKPOINT LOADED' : 'TARGET SPECIFICATION'}
            </span>
          </div>

          {/* SVG Neural Layer Canvas */}
          <div className="w-full overflow-x-auto py-2">
            <svg viewBox="0 0 760 160" className="w-full min-w-[680px] h-36">
              <defs>
                <linearGradient id="synapseGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--app-accent)" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="var(--app-accent)" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="var(--app-accent)" stopOpacity="0.8" />
                </linearGradient>
                <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Input Embedding Node */}
              <g transform="translate(40, 80)">
                <circle r="22" fill="var(--app-accent)" stroke="var(--app-accent)" strokeWidth="2" filter="url(#glowEffect)" />
                <text textAnchor="middle" dy="4" fill="var(--app-accent)" fontSize="9" fontWeight="bold" fontFamily="monospace">
                  VOCAB
                </text>
                <text textAnchor="middle" dy="32" fill="var(--app-accent)" fontSize="8" fontFamily="monospace">
                  16,384
                </text>
              </g>

              {/* Synapses from Input to Layer 1 */}
              {[40, 60, 80, 100, 120].map((y, idx) => (
                <path
                  key={`in-${idx}`}
                  d={`M 62 80 C 85 80, 95 ${y}, 110 ${y}`}
                  fill="none"
                  stroke="url(#synapseGradient)"
                  strokeWidth="1.2"
                  strokeDasharray="4 2"
                  opacity={pulseIndex % 2 === 0 ? "0.9" : "0.4"}
                />
              ))}

              {/* 10 Transformer Block Columns */}
              {layers.map((layer, lIdx) => {
                const xPos = 110 + lIdx * 52;
                const isPulse = pulseIndex === lIdx;

                return (
                  <g key={layer.id} transform={`translate(${xPos}, 0)`}>
                    {/* Layer Header Label */}
                    <text textAnchor="middle" x="16" y="20" fill={isPulse ? "var(--app-accent)" : "#64748B"} fontSize="8" fontWeight="bold" fontFamily="monospace">
                      L{layer.id}
                    </text>

                    {/* Attention Head Nodes */}
                    {[40, 60, 80, 100, 120].map((yNode, nIdx) => (
                      <g key={nIdx}>
                        {/* Synapse to next layer */}
                        {lIdx < 9 && (
                          <line
                            x1="22"
                            y1={yNode}
                            x2="52"
                            y2={nIdx % 2 === 0 ? yNode - 5 : yNode + 5}
                            stroke={isPulse ? "var(--app-accent)" : "var(--app-accent)"}
                            strokeWidth={isPulse ? "1.5" : "0.8"}
                            opacity={isPulse ? "0.8" : "0.3"}
                          />
                        )}

                        <circle
                          cx="16"
                          cy={yNode}
                          r={isPulse ? "7" : "5.5"}
                          fill={isPulse ? "var(--app-accent)" : (lIdx % 2 === 0 ? "var(--app-accent)" : "var(--app-accent)")}
                          stroke={isPulse ? "#FFFFFF" : "var(--app-accent)"}
                          strokeWidth={isPulse ? "2" : "1"}
                          className="transition-all duration-300"
                        />
                      </g>
                    ))}

                    {/* SwiGLU FFN Pill */}
                    <rect
                      x="8"
                      y="138"
                      width="16"
                      height="8"
                      rx="3"
                      fill={isPulse ? "var(--app-accent-deep)" : "var(--app-accent)"}
                      stroke={isPulse ? "var(--z-danger)" : "var(--app-accent)"}
                      strokeWidth="1"
                    />
                  </g>
                );
              })}

              {/* Output Projection Node */}
              <g transform="translate(670, 80)">
                <path
                  d="M 628 80 L 648 80"
                  stroke="var(--app-accent-deep)"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                />
                <circle r="22" fill="var(--app-accent)" stroke="var(--app-accent-deep)" strokeWidth="2" filter="url(#glowEffect)" />
                <text textAnchor="middle" dy="4" fill="var(--app-accent-deep)" fontSize="9" fontWeight="bold" fontFamily="monospace">
                  LATENT
                </text>
                <text textAnchor="middle" dy="32" fill="var(--app-accent)" fontSize="8" fontFamily="monospace">
                  512-DIM
                </text>
              </g>
            </svg>
          </div>

          {/* Real-time State Readout Footer */}
          <div className="mt-3 pt-3 border-t border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
            <div className="flex items-center gap-2 text-[var(--app-text-secondary)]">
              <span className="w-2 h-2 rounded-full bg-[var(--z-ok)] animate-ping" />
              <span>Illustration: <span className="text-[var(--app-text-secondary)] font-bold">NOT LIVE INFERENCE</span></span>
            </div>
            <div className="text-[var(--app-text-secondary)]">
              Checkpoint SHA-256: <span className="text-[var(--app-accent)]">{checkpointHash ? `${checkpointHash.slice(0, 16)}…` : 'not loaded'}</span>
            </div>
            <div className="text-[var(--app-text-secondary)]">
              Rotary Embeddings: <span className="text-[var(--app-accent)] font-bold">RoPE + SwiGLU</span>
            </div>
          </div>
        </div>

        {/* 4 Interactive Intelligence Navigation Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => onNavigate && onNavigate('conversational_intelligence')}
            className="p-3.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)] transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--app-text-primary)] group-hover:text-[var(--app-accent)]">
                {lang === 'th' ? 'สนทนาแบบ Real-time' : 'Conversational Intelligence'}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--app-text-secondary)] group-hover:translate-x-1 transition-transform" />
            </div>
            <p className="text-[11px] text-[var(--app-text-secondary)] mt-1">
              {lang === 'th' ? 'สนทนาสองภาษาพร้อม Reasoning Chain' : 'Live streaming inference with verifiable reasoning'}
            </p>
          </button>

          <button
            onClick={() => onNavigate && onNavigate('knowledge_hub')}
            className="p-3.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)] transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--app-text-primary)] group-hover:text-[var(--app-accent)]">
                {lang === 'th' ? 'คลังความจำ Episodic Memory' : 'Persistent Episodic Memory'}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--app-text-secondary)] group-hover:translate-x-1 transition-transform" />
            </div>
            <p className="text-[11px] text-[var(--app-text-secondary)] mt-1">
              {lang === 'th' ? 'บันทึกและสืบค้นความจำพร้อม SHA-256 Digest' : 'Cross-session memory store with cryptographic audit'}
            </p>
          </button>

          <button
            onClick={() => onNavigate && onNavigate('governance_security')}
            className="p-3.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--z-ok)] transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--app-text-primary)] group-hover:text-[var(--z-ok)]">
                {lang === 'th' ? 'ทดสอบภาษาและ Sandbox' : 'Language & Security Proofs'}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--app-text-secondary)] group-hover:translate-x-1 transition-transform" />
            </div>
            <p className="text-[11px] text-[var(--app-text-secondary)] mt-1">
              {lang === 'th' ? 'ทดสอบ 5 Script Proofs และ Sandbox Tamper' : '5/5 Language proofs & sandbox runtime verification'}
            </p>
          </button>
        </div>
      </div>
    </VividCard>
  );
};
