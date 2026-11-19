import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { EvolutionRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Play } from 'lucide-react';

export const ExperimentCenter: React.FC = () => {
  const { authHeaders } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';

  const [isEvolving, setIsEvolving] = useState(false);
  const [currentEvolution, setCurrentEvolution] = useState<EvolutionRecord | null>(null);
  const [selectedDomain, setSelectedDomain] = useState('algorithm_resilience');

  const handleRunSelfEvolution = async () => {
    setIsEvolving(true);
    try {
      const res = await fetch('/api/self-evolve/run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ domain: selectedDomain })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentEvolution(data.evolution);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsEvolving(false);
    }
  };

  const stages = th
    ? [
        { step: '1. เรียนรู้', desc: 'เก็บข้อมูลความล้มเหลวและ Log การทำงานจริง' },
        { step: '2. วิเคราะห์', desc: 'ระบุคอขวดและจุดบกพร่องของระบบ' },
        { step: '3. พัฒนา', desc: 'สร้างแนวทางแก้ไขโค้ดและพารามิเตอร์' },
        { step: '4. ประเมิน', desc: 'ทดสอบเทียบผลก่อนและหลังแก้ไขจริง' },
        { step: '5. ปรับปรุง', desc: 'บันทึกผลลัพธ์ที่พิสูจน์แล้วว่าดีขึ้น' },
      ]
    : [
        { step: '1. LEARN', desc: 'Harvests execution failures & logs' },
        { step: '2. ANALYZE', desc: 'Identifies cognitive bottlenecks' },
        { step: '3. SELF-DEVELOP', desc: 'Synthesizes code & weight deltas' },
        { step: '4. EVALUATE', desc: 'Executes before vs after benchmarks' },
        { step: '5. IMPROVE', desc: 'Commits verified capability delta' },
      ];

  return (
    <div className="space-y-6">
      <VividCard
        gradientAccent="cyan"
        className="!p-5 sm:!p-6"
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-lg px-3 py-2 font-medium text-[var(--app-text-primary)]"
            >
              <option value="algorithm_resilience">
                {th ? 'โดเมน: ความทนทานอัลกอริทึม' : 'Domain: Algorithm Resilience'}
              </option>
              <option value="token_optimization">
                {th ? 'โดเมน: ปรับแต่ง Tokenizer' : 'Domain: Tokenizer Optimization'}
              </option>
              <option value="cache_concurrency">
                {th ? 'โดเมน: Cache & Concurrency' : 'Domain: Concurrency & Cache Safety'}
              </option>
            </select>
            <button
              type="button"
              onClick={handleRunSelfEvolution}
              disabled={isEvolving}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[var(--app-accent-deep)] rounded-lg hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              {isEvolving
                ? th
                  ? 'กำลังรันวงจรพัฒนา 5 ขั้นตอน...'
                  : 'Running 5-Stage Evolution...'
                : th
                ? 'เริ่มวงจรพัฒนาตนเอง'
                : 'Trigger Self-Evolution Loop'}
            </button>
          </div>
        }
      >
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold text-[var(--app-accent)]">
            ZYNTHEOR Q+ Autonomic Engine
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-[var(--app-text-primary)] mt-1">
            {th ? 'วงจรทดลองและพัฒนาประสิทธิภาพเชิงประจักษ์' : 'Self-Evolving Native Intelligence Loop'}
          </h2>
          <p className="text-xs text-[var(--app-text-secondary)] mt-2 leading-relaxed">
            {th
              ? 'เรียนรู้จากผลการทำงานจริง ปรับปรุงสถาปัตยกรรม Tokenizer น้ำหนักโมเดล และ Pipeline พร้อมเปรียบเทียบหลักฐานก่อน-หลังอย่างตรวจสอบได้'
              : 'Learn from execution traces, refine architecture, tokenizer, weights, and pipeline, and verify improvement with before-and-after empirical evidence.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-5">
          {stages.map((s, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-1"
            >
              <div className="text-xs font-semibold text-[var(--app-text-primary)]">{s.step}</div>
              <div className="text-[11px] text-[var(--app-text-secondary)] leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </VividCard>

      {currentEvolution && (
        <VividCard
          title={th ? `บันทึกการพัฒนา: ${currentEvolution.cycle_id}` : `Evolution Record: ${currentEvolution.cycle_id}`}
          subtitle={
            th
              ? `ผลตรวจวัดเชิงประจักษ์ในโดเมน '${currentEvolution.domain}'`
              : `Empirical verification in domain '${currentEvolution.domain}'`
          }
          gradientAccent="emerald"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between p-4 bg-[color-mix(in_srgb,var(--z-ok)_10%,transparent)] border border-[color-mix(in_srgb,var(--z-ok)_35%,transparent)] rounded-xl">
              <div>
                <span className="text-xs font-semibold text-[var(--z-ok)]">
                  {th ? 'ผลต่างความสามารถที่ตรวจวัดได้' : 'Capability Benchmark Delta'}
                </span>
                <div className="text-xl font-semibold font-mono text-[var(--z-ok)]">
                  +{currentEvolution.improvement_pct}% {th ? 'ดีขึ้น' : 'Improvement'}
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-[var(--app-text-secondary)]">
                  {th ? 'คะแนน Benchmark:' : 'Benchmark Score:'}
                </span>
                <div className="font-mono text-sm font-semibold text-[var(--app-text-primary)]">
                  {currentEvolution.score_before}% → <span className="text-[var(--z-ok)]">{currentEvolution.score_after}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {currentEvolution.stages.map((st, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs flex items-start gap-3">
                  <span className="font-mono font-semibold text-[var(--app-accent)] shrink-0">{st.stage}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--app-text-primary)]">{st.action}</div>
                    {st.findings && <div className="text-[var(--app-text-secondary)] text-[11px] mt-0.5">{st.findings}</div>}
                    {st.evidence && <div className="text-[var(--z-ok)] font-medium text-[11px] mt-0.5">{st.evidence}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </VividCard>
      )}
    </div>
  );
};
