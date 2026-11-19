import React from 'react';
import { VividCard } from './ui/VividCard';
import { useLanguage } from '../context/LanguageContext';
import { TrendingDown, Layers, Activity } from 'lucide-react';

interface TrainingProgressProps {
  trainResult: any;
  epochs: number;
  isTraining: boolean;
}

export const TrainingProgress: React.FC<TrainingProgressProps> = ({
  trainResult,
  epochs,
  isTraining
}) => {
  const { lang } = useLanguage();
  const th = lang === 'th';

  const lossBefore = trainResult?.loss_before ?? null;
  const lossAfter = trainResult?.loss_after ?? null;
  const reductionPct = trainResult?.loss_reduction_pct ?? null;
  const step = trainResult?.training_step ?? 0;

  return (
    <VividCard
      title={th ? 'ความคืบหน้าการฝึก (TrainingProgress)' : 'TrainingProgress'}
      subtitle={
        th
          ? 'กราฟ Loss, ค่า Gradient Norm และสถานะ Epoch / Shard ปัจจุบัน'
          : 'Loss curves, gradient norms & current epoch/shard status'
      }
      gradientAccent="emerald"
    >
      <div className="flex justify-end mb-3">
        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold font-mono bg-[var(--app-surface-elevated)] text-[var(--app-amber)] border border-[var(--app-card-border)]">
          {isTraining
            ? th
              ? 'กำลังฝึกโมเดล'
              : 'TRAINING ACTIVE'
            : trainResult
              ? th
                ? `เสร็จสิ้น STEP ${step}`
                : `STEP ${step} COMPLETE`
              : th
                ? 'ว่าง (PARTIAL)'
                : 'IDLE (PARTIAL)'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="flex items-center gap-1.5 text-xs text-[var(--app-text-secondary)] mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-[var(--app-accent)]" />
            Cross-Entropy Loss
          </div>
          <div className="font-mono text-sm font-bold text-[var(--app-text-primary)]">
            {lossBefore !== null && lossAfter !== null
              ? `${Number(lossBefore).toFixed(4)} → ${Number(lossAfter).toFixed(4)}`
              : th
                ? 'รอเริ่มการรันฝึก'
                : 'Awaiting training run'}
          </div>
          {reductionPct !== null && (
            <div className="text-[11px] font-mono text-[var(--app-accent)] mt-1">
              -{Number(reductionPct).toFixed(2)}% {th ? 'ลดลง' : 'reduction'}
            </div>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="flex items-center gap-1.5 text-xs text-[var(--app-text-secondary)] mb-1">
            <Layers className="w-3.5 h-3.5 text-[var(--app-amber)]" />
            {th ? 'สถานะ Epoch / Shard' : 'Epoch / Shard Status'}
          </div>
          <div className="font-mono text-sm font-bold text-[var(--app-text-primary)]">
            {isTraining
              ? th
                ? `กำลังรัน ${epochs} epoch...`
                : `Running ${epochs} epoch(s)...`
              : th
                ? `ตั้งค่าไว้: ${epochs} epoch`
                : `Configured: ${epochs} epoch(s)`}
          </div>
          <div className="text-[11px] font-mono text-[var(--app-text-secondary)] mt-1">
            Sharding: 12-Block Layer-Wise (PARTIAL)
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="flex items-center gap-1.5 text-xs text-[var(--app-text-secondary)] mb-1">
            <Activity className="w-3.5 h-3.5 text-[var(--app-accent)]" />
            {th ? 'อัตราเปลี่ยนแปลงพารามิเตอร์ (Delta)' : 'Parameter Mutation Delta'}
          </div>
          <div className="font-mono text-sm font-bold text-[var(--app-text-primary)]">
            {trainResult?.param_mutation_delta !== undefined
              ? Number(trainResult.param_mutation_delta).toExponential(3)
              : '0.000e+0'}
          </div>
          <div className="text-[11px] font-mono text-[var(--app-text-secondary)] mt-1">
            Optimizer: NativeAdamW
          </div>
        </div>
      </div>
    </VividCard>
  );
};
