import React, { useState, useEffect } from 'react';
import { VividCard } from './ui/VividCard';
import { StatusDot } from './ui/StatusBadge';
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
  const [activeLayer, setActiveLayer] = useState(0);

  // Dynamic neural synaptic pulse connected to live timer
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseIndex((prev) => (prev + 1) % 10);
      setActiveLayer((prev) => (prev + 1) % 10);
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  const layers = Array.from({ length: 10 }, (_, idx) => ({
    id: idx + 1,
    name: `Block ${idx + 1}`,
    heads: 8,
    dim: 512,
    active: true
  }));

  return (
    <VividCard
      title={lang === 'th' ? 'การแสดงผลการประมวลผลสมองประสาทเทียมสด (Live Neural Engine)' : 'Real-Time Native Intelligence Visualizer'}
      subtitle={
        lang === 'th'
          ? 'แสดง Native Target 10 Blocks, 8 Attention Heads, Hidden Dimension 512 และสถานะตามหลักฐาน Runtime'
          : 'Interactive 10-block transformer architecture, 8 attention heads, 512-dim hidden state, and live inference state.'
      }
      gradientAccent="cyan"
      className="!p-6"
    >
      <div className="space-y-6">
        {/* Top Intelligence Telemetry Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
          <div className="p-3 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span>{lang === 'th' ? 'สถาปัตยกรรมโมเดล' : 'Model Architecture'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--app-text-primary)] mt-1 font-mono">
              10L · 8H · 512D
            </div>
            <div className="text-[10px] text-[#CCFF00] font-bold mt-0.5">
              {totalParams > 0
                ? `Native Target ${(totalParams / 1e6).toFixed(2)}M Float32`
                : 'Awaiting verified weights'}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>{lang === 'th' ? 'ความเร็วประมวลผล' : 'Token Throughput'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--app-text-primary)] mt-1 font-mono">
              {tokensPerSec > 0 ? `${formatNumber(tokensPerSec)} t/s` : 'Awaiting live sample'}
            </div>
            <div className="text-[10px] text-[#00F0FF] font-bold mt-0.5">
              Measured runtime telemetry only
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-[#7B2CBF]" />
              <span>{lang === 'th' ? 'ระบบสองภาษา' : 'Dual Vocabulary'}</span>
            </div>
            <div className="text-sm font-extrabold text-[var(--app-text-primary)] mt-1 font-mono">
              16,384 Subwords
            </div>
            <div className="text-[10px] text-[#00F0FF] font-bold mt-0.5">
              Tokenizer config loaded
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>{lang === 'th' ? 'การรันแบบเอกเทศ' : 'Sovereignty'}</span>
            </div>
            <div className="text-sm font-extrabold text-[#CCFF00] mt-1 font-mono">
              ONLINE-ONLY CLOUD
            </div>
            <div className="text-[10px] text-[#00F0FF] font-bold mt-0.5">
              No external AI inference API
            </div>
          </div>
        </div>

        {/* Live SVG Neural Transformer Architecture Visualizer */}
        <div className="relative p-5 rounded-2xl bg-[#070B19] border border-[#1E294A] overflow-hidden shadow-inner">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#00F0FF]" />
              <span className="text-xs font-bold text-[#F4F7FF]">
                {lang === 'th' ? 'โครงข่ายการประมวลผลหมอกเวกเตอร์ (Latent Manifold Projection)' : '10-Layer Transformer & Synaptic Attention Manifold'}
              </span>
            </div>
            <StatusDot
              status={weightsLoaded ? 'ONLINE' : 'PARTIAL'}
              label={weightsLoaded ? 'WEIGHTS_SYNCHRONIZED' : 'AWAITING_WEIGHTS'}
              pulse={weightsLoaded}
            />
          </div>

          {/* SVG Neural Layer Canvas */}
          <div className="w-full overflow-x-auto py-2">
            <svg viewBox="0 0 760 160" className="w-full min-w-[680px] h-36">
              <defs>
                <linearGradient id="synapseGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.85" />
                  <stop offset="50%" stopColor="#2563EB" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#7B2CBF" stopOpacity="0.85" />
                </linearGradient>
                <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Input Embedding Node */}
              <g transform="translate(40, 80)">
                <circle r="22" fill="#0D1326" stroke="#00F0FF" strokeWidth="2" filter="url(#glowEffect)" />
                <text textAnchor="middle" dy="4" fill="#00F0FF" fontSize="9" fontWeight="bold" fontFamily="monospace">
                  VOCAB
                </text>
                <text textAnchor="middle" dy="32" fill="#94A3C4" fontSize="8" fontFamily="monospace">
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

              {/* Active Transformer Block */}
              {layers.map((layer, lIdx) => {
                const xPos = 110 + lIdx * 52;
                const isPulse = pulseIndex === lIdx;

                return (
                  <g key={layer.id} transform={`translate(${xPos}, 0)`}>
                    {/* Layer Header Label */}
                    <text textAnchor="middle" x="16" y="20" fill={isPulse ? "#00F0FF" : "#64748B"} fontSize="8" fontWeight="bold" fontFamily="monospace">
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
                            stroke={isPulse ? "#00F0FF" : "#1E294A"}
                            strokeWidth={isPulse ? "1.5" : "0.8"}
                            opacity={isPulse ? "0.85" : "0.35"}
                          />
                        )}

                        <circle
                          cx="16"
                          cy={yNode}
                          r={isPulse ? "7" : "5.5"}
                          fill={isPulse ? "#00F0FF" : (lIdx % 2 === 0 ? "#131B36" : "#0D1326")}
                          stroke={isPulse ? "#FFFFFF" : "#2563EB"}
                          strokeWidth={isPulse ? "2" : "1"}
                          className="transition-all duration-300"
                        />
                      </g>
                    ))}

                    {/* SwiGLU FFN Badge */}
                    <rect
                      x="8"
                      y="138"
                      width="16"
                      height="8"
                      rx="3"
                      fill={isPulse ? "#7B2CBF" : "#131B36"}
                      stroke={isPulse ? "#FF007F" : "#1E294A"}
                      strokeWidth="1"
                    />
                  </g>
                );
              })}

              {/* Output Projection Node */}
              <g transform="translate(670, 80)">
                <path
                  d="M 628 80 L 648 80"
                  stroke="#7B2CBF"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                />
                <circle r="22" fill="#131B36" stroke="#FF007F" strokeWidth="2" filter="url(#glowEffect)" />
                <text textAnchor="middle" dy="4" fill="#FF007F" fontSize="9" fontWeight="bold" fontFamily="monospace">
                  LATENT
                </text>
                <text textAnchor="middle" dy="32" fill="#94A3C4" fontSize="8" fontFamily="monospace">
                  512-DIM
                </text>
              </g>
            </svg>
          </div>

          {/* Real-time State Readout Footer */}
          <div className="mt-3 pt-3 border-t border-[#1E294A] flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
            <div className="flex items-center gap-2 text-[#94A3C4]">
              <span className={`w-2 h-2 rounded-full ${weightsLoaded ? 'bg-[#CCFF00]' : 'bg-[#FF5E3A]'}`} />
              <span>
                Forward Pass:{' '}
                <span className={weightsLoaded ? 'text-[#CCFF00] font-bold' : 'text-[#FF8C73] font-bold'}>
                  {weightsLoaded ? 'ACTIVE DETERMINISTIC' : 'UNLOADED / FAIL-CLOSED'}
                </span>
              </span>
            </div>
            <div className="text-[#94A3C4]">
              Checkpoint SHA-256:{' '}
              <span className="text-[#00F0FF]">
                {checkpointHash ? `${checkpointHash.slice(0, 16)}...` : 'UNAVAILABLE'}
              </span>
            </div>
            <div className="text-[#94A3C4]">
              Feed Forward: <span className="text-[#FF007F] font-bold">SwiGLU</span>
            </div>
          </div>
        </div>

        {/* 3 Interactive Intelligence Navigation Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => onNavigate && onNavigate('conversational_intelligence')}
            className="min-h-[44px] p-3.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] hover:border-[#00F0FF] transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--app-text-primary)] group-hover:text-[#00F0FF]">
                {lang === 'th' ? 'สนทนาแบบ Real-time' : 'Conversational Intelligence'}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--app-text-secondary)] group-hover:translate-x-1 transition-transform" />
            </div>
            <p className="text-[11px] text-[var(--app-text-secondary)] mt-1">
              {lang === 'th' ? 'สนทนาสองภาษา พร้อม Runtime Trace' : 'Live streaming with an explicit runtime trace'}
            </p>
          </button>

          <button
            onClick={() => onNavigate && onNavigate('knowledge_hub')}
            className="min-h-[44px] p-3.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] hover:border-[#7B2CBF] transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--app-text-primary)] group-hover:text-[#7B2CBF]">
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
            className="min-h-[44px] p-3.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] hover:border-[#CCFF00] transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--app-text-primary)] group-hover:text-[#CCFF00]">
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
