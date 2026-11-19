import React from 'react';
import { VividCard } from './ui/VividCard';
import { useLanguage } from '../context/LanguageContext';
import { Database } from 'lucide-react';

interface ShardBlock {
  id: string;
  label: string;
  params: number;
  resident: 'RAM' | 'DISK_SHARD';
  trained: boolean;
}

interface MemoryShardMapProps {
  isTraining: boolean;
  hasTrainedStep: boolean;
}

const SHARD_BLOCKS: ShardBlock[] = [
  { id: 'embed', label: 'Token Embedding (16,384 × 512)', params: 8388608, resident: 'RAM', trained: false },
  { id: 'block_0', label: 'Transformer Block 0', params: 1717248, resident: 'RAM', trained: true },
  { id: 'block_1', label: 'Transformer Block 1', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_2', label: 'Transformer Block 2', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_3', label: 'Transformer Block 3', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_4', label: 'Transformer Block 4', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_5', label: 'Transformer Block 5', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_6', label: 'Transformer Block 6', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_7', label: 'Transformer Block 7', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_8', label: 'Transformer Block 8', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'block_9', label: 'Transformer Block 9', params: 1717248, resident: 'DISK_SHARD', trained: false },
  { id: 'lm_head', label: 'Final RMSNorm + LM Head', params: 8397312, resident: 'RAM', trained: true }
];

export const MemoryShardMap: React.FC<MemoryShardMapProps> = ({
  isTraining,
  hasTrainedStep
}) => {
  const { lang } = useLanguage();
  const th = lang === 'th';
  const totalCovered = SHARD_BLOCKS.reduce((acc, b) => acc + b.params, 0);

  return (
    <VividCard
      title={th ? 'แผนผัง Memory Shard (พารามิเตอร์ 33.9M)' : 'Memory Shard Map (33.9M Parameters)'}
      subtitle={
        th
          ? `ความครอบคลุมพารามิเตอร์ทั้งหมด: ${(totalCovered / 1e6).toFixed(2)}M ผ่าน 12 shards · สถานะ: PARTIAL`
          : `Full parameter coverage: ${(totalCovered / 1e6).toFixed(2)}M params across 12 shards · Status: PARTIAL`
      }
      gradientAccent="emerald"
    >
      <div className="flex justify-end mb-3">
        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold font-mono bg-[color-mix(in_srgb,var(--app-amber)_14%,transparent)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)]">
          {th ? 'สถานะ: PARTIAL' : 'STATUS: PARTIAL'}
        </span>
      </div>

      {/* 10-Layer Neural Coverage Grid */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-[var(--app-text-secondary)] mb-2">
          {th
            ? 'ความครอบคลุมโครงข่ายประสาท (10 เลเยอร์ Transformer · ฝึกแล้ว vs. ยังไม่ฝึก)'
            : 'Neural Coverage (10 Transformer Layers · Trained vs. Untrained)'}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
          {Array.from({ length: 10 }, (_, idx) => {
            const pct = idx === 0 ? (hasTrainedStep ? 13 : 13) : 0;
            return (
              <div
                key={idx}
                className="p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-center space-y-1.5"
              >
                <div className="text-[10px] font-mono font-bold text-[var(--app-text-primary)]">L{idx}</div>
                <div className="h-1.5 rounded-full bg-[var(--app-surface-elevated)] overflow-hidden">
                  <div
                    className={`h-full ${pct > 0 ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-surface)]'}`}
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
                <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {SHARD_BLOCKS.map((block) => {
          const active = block.resident === 'RAM' || isTraining;
          return (
            <div
              key={block.id}
              className={`p-3 rounded-xl border text-xs transition-colors ${
                active
                  ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] text-[var(--app-text-primary)]'
                  : 'bg-[var(--app-bg)] border-[var(--app-card-border)] text-[var(--app-text-secondary)]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <Database className={`w-3.5 h-3.5 ${active ? 'text-[var(--app-accent)]' : 'text-[color-mix(in_srgb,var(--app-text-secondary)_60%,transparent)]'}`} />
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  {active ? 'RAM' : 'SHARD'}
                </span>
              </div>
              <div className="font-semibold text-[11px] truncate" title={block.label}>
                {block.label}
              </div>
              <div className="text-[10px] font-mono text-[var(--app-text-secondary)] mt-0.5">
                {(block.params / 1e6).toFixed(2)}M {th ? 'พารามิเตอร์' : 'params'} {hasTrainedStep && block.trained ? '· ✓' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </VividCard>
  );
};
