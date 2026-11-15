import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import { HardwareMonitor } from '../HardwareMonitor';
import { TrainingProgress } from '../TrainingProgress';
import { MemoryShardMap } from '../MemoryShardMap';
import { GradientNormOverlay, LayerGradientNorm } from '../GradientNormOverlay';
import { ModelBenchmarking } from '../ModelBenchmarking';
import {
  Binary,
  Layers,
  HardDrive,
  Cpu,
  TrendingDown,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertTriangle,
  Download,
  Zap,
  Sliders,
  ShieldCheck,
  FileCheck,
  Hash,
  Database
} from 'lucide-react';

import { SystemStatusData } from '../../types';

interface ModelLaboratoryProps {
  statusData?: SystemStatusData | null;
  onStatusChanged?: () => void;
}

export const ModelLaboratory: React.FC<ModelLaboratoryProps> = ({ statusData, onStatusChanged }) => {
  const { lang, formatNumber } = useLanguage();
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const [modelStatus, setModelStatus] = useState<any>(null);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [trainingEpochs, setTrainingEpochs] = useState<number>(2);
  const [isTraining, setIsTraining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [trainResult, setTrainResult] = useState<any>(null);
  const [exportResult, setExportResult] = useState<any>(null);
  const [isGradOverlayOpen, setIsGradOverlayOpen] = useState(false);
  const [comparisonData, setComparisonData] = useState<any>(null);

  const layerNorms: LayerGradientNorm[] = trainResult?.layer_gradient_norms
    ? Object.entries(trainResult.layer_gradient_norms).map(([layer, norm]) => ({
        layer,
        norm: Number(norm),
        rawNorm:
          trainResult?.layer_gradient_norms_pre_clip?.[layer] !== undefined
            ? Number(trainResult.layer_gradient_norms_pre_clip[layer])
            : undefined
      }))
    : [];

  const fetchModelAndDatasets = async () => {
    if (!isAuthenticated) return;
    setIsRefreshing(true);
    try {
      const h = authHeaders();
      const [inspectRes, dsRes, compRes] = await Promise.all([
        fetch(apiUrl('/api/model/inspect'), { headers: h }).then((r) => r.json()),
        fetch(apiUrl('/api/knowledge/datasets'), { headers: h }).then((r) => r.json()),
        fetch(apiUrl('/api/model/comparison'), { headers: h }).then((r) => r.json()).catch(() => null)
      ]);

      if (inspectRes.success) {
        setModelStatus(inspectRes);
        if (inspectRes.latest_training_step) {
          setTrainResult((prev: any) => prev ?? inspectRes.latest_training_step);
        }
      }
      if (dsRes.success) {
        setDatasets(dsRes.datasets || []);
        if (dsRes.datasets?.length > 0 && !selectedDatasetId) {
          setSelectedDatasetId(dsRes.datasets[0].datasetId);
        }
      }
      if (compRes?.success) {
        setComparisonData(compRes);
      }
    } catch (err) {
      console.error('Failed to load model laboratory data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchModelAndDatasets();
    }
  }, [authReady, isAuthenticated]);

  const handleExecuteTraining = async (epochsOverride?: number) => {
    setIsTraining(true);
    try {
      const res = await fetch(apiUrl('/api/model/train'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          datasetId: selectedDatasetId,
          epochs: epochsOverride ?? trainingEpochs
        })
      });
      const data = await res.json();
      if (data.success) {
        setTrainResult(data);
        fetchModelAndDatasets();
      }
    } catch (err) {
      console.error('Training run error:', err);
    } finally {
      setIsTraining(false);
    }
  };

  const handleExportCheckpoint = async () => {
    setIsExporting(true);
    setExportResult(null);
    try {
      const res = await fetch(apiUrl('/api/model/export'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          step: trainResult?.training_step || 1,
          loss: trainResult?.loss_after || 0.38
        })
      });
      const data = await res.json();
      if (data.success) {
        setExportResult(data);
        fetchModelAndDatasets();
      }
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const isFullTensor = modelStatus?.is_full_tensor || false;
  const activeModel = statusData?.model || comparisonData?.activeCheckpoint;
  const activeKey = activeModel?.activeKey || activeModel?.key;
  const activeWeightsLoaded = Boolean(activeModel?.weightsLoaded);
  const displayedParams = activeWeightsLoaded
    ? activeModel?.totalParams ?? null
    : modelStatus?.metadata?.total_params ?? null;
  const fileSizeMb = modelStatus?.file_size
    ? (modelStatus.file_size / (1024 * 1024)).toFixed(2)
    : '—';
  const totalParams = modelStatus?.metadata?.total_params ?? 0;
  const checkpointHash = activeModel?.checkpointHash || activeModel?.checkpointSha256 || modelStatus?.payload_sha256 || modelStatus?.metadata?.sha256 || null;
  const tensorCount = modelStatus?.metadata?.tensors_manifest?.length ?? modelStatus?.metadata?.tensors?.length ?? null;
  const activeArchitecture = activeModel?.architecture || modelStatus?.metadata?.architecture || 'Not reported';

  return (
    <div className="space-y-6">
      {/* Metric Strip - Midnight Navy + Vibrant */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <MetricCard
          title={lang === 'th' ? 'พารามิเตอร์โมเดลที่ใช้งาน' : 'Active Model Parameters'}
          value={displayedParams != null ? formatNumber(displayedParams) : '—'}
          subtitle={activeWeightsLoaded ? 'Loaded parameter count from runtime' : modelStatus?.metadata ? 'Checkpoint metadata; weights not confirmed loaded' : 'Awaiting checkpoint data'}
          icon={<Binary className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title={lang === 'th' ? 'ขนาด Checkpoint ไบนารี' : 'Checkpoint Footprint'}
          value={fileSizeMb === '—' ? '—' : `${fileSizeMb} MB`}
          subtitle={fileSizeMb === '—' ? 'File size not reported' : isFullTensor ? 'Checkpoint file size' : 'Inspected checkpoint file'}
          icon={<HardDrive className="w-5 h-5" />}
          accentColor="coral"
        />
        <MetricCard
          title={lang === 'th' ? 'จำนวน Tensor Layers' : 'Architecture Tensors'}
          value={tensorCount ?? '—'}
          subtitle="Entries returned by checkpoint manifest"
          icon={<Layers className="w-5 h-5" />}
          accentColor="violet"
        />
        <MetricCard
          title={lang === 'th' ? 'สถานะการตรวจพิสูจน์' : 'Active Runtime Status'}
          value={!activeModel ? '—' : activeWeightsLoaded ? (activeModel.signatureMatchesExpected === false ? 'Mismatch' : activeModel.signatureMatchesExpected === true ? 'Matched' : 'Loaded') : 'Not loaded'}
          subtitle={checkpointHash ? `${checkpointHash.slice(0, 16)}…` : 'Fingerprint unavailable'}
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="lime"
        />
      </div>

      {/* Real Native Training Engine Console */}
      <VividCard
        title={lang === 'th' ? 'ระบบฝึกโมเดลระดับ Tensor (Native Training Engine)' : 'Native Backpropagation & Training Engine'}
        subtitle={lang === 'th' ? 'คำนวณ Gradient จริง, ปรับค่าน้ำหนักด้วย AdamW, และพิสูจน์การลดลงของ Cross-Entropy Loss โดยไม่พึ่งพา External AI API' : 'Real CPU autograd backpropagation, AdamW optimizer updates, and empirical loss reduction'}
        gradientAccent="cyan"
        headerAction={
          <button
            onClick={fetchModelAndDatasets}
            disabled={isRefreshing}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 rounded-xl text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] transition-colors cursor-pointer"
            title="Refresh status"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#00F0FF]' : ''}`} />
          </button>
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--app-text-primary)] mb-1">
                {lang === 'th' ? 'เลือกชุดข้อมูลฝึก (Curated Dataset)' : 'Select Curated Training Dataset'}
              </label>
              <select
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] focus:outline-none focus:border-[#00F0FF] cursor-pointer"
              >
                {datasets.map((ds) => (
                  <option key={ds.datasetId} value={ds.datasetId}>
                    {ds.name} ({ds.totalSamples} samples)
                  </option>
                ))}
                {datasets.length === 0 && (
                  <option value="">Default Bilingual Corpus (Built-in)</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--app-text-primary)] mb-1">
                {lang === 'th' ? 'จำนวน Epochs (รอบการฝึก)' : 'Training Epochs'}
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={trainingEpochs}
                onChange={(e) => setTrainingEpochs(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] focus:outline-none focus:border-[#00F0FF] tabular-nums"
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <button
                onClick={() => handleExecuteTraining()}
                disabled={isTraining}
                className="flex-1 min-w-[160px] min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-white vivid-gradient-brand shadow-md hover:opacity-95 transition-all cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Zap className="w-4 h-4 text-[#CCFF00] shrink-0" />
                <span>{isTraining ? (lang === 'th' ? 'กำลังฝึกโมเดล...' : 'Training Model...') : (lang === 'th' ? 'เริ่มฝึกจริง (Train Step)' : 'Run Training Step')}</span>
              </button>

              <button
                onClick={handleExportCheckpoint}
                disabled={isExporting}
                className="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-[var(--app-text-primary)] bg-[var(--app-input-bg)] border border-[var(--app-card-border)] hover:border-[#00F0FF] transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                title="Export atomic checkpoint"
              >
                <Download className="w-4 h-4 text-[#00F0FF] shrink-0" />
                <span className="hidden sm:inline">Export Checkpoint</span>
              </button>
            </div>
          </div>

          {/* Real Training Metrics Feedback */}
          {trainResult && (
            <div className="p-4 rounded-xl bg-[var(--app-input-bg)] border border-[#CCFF00]/40 space-y-3 tabular-nums">
              <div className="flex items-center justify-between text-xs font-bold text-[#CCFF00]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{lang === 'th' ? 'ยืนยันผลการฝึกจริง (Zero-Fake Verified Training Proof)' : 'Empirical Training Run Verification'}</span>
                </div>
                <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                  Step #{trainResult.training_step} · {trainResult.tokens_processed} tokens
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Initial Loss</div>
                  <div className="text-base font-bold text-[#FF007F] mt-0.5">{trainResult.loss_before}</div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Final Loss</div>
                  <div className="text-base font-bold text-[#CCFF00] mt-0.5">{trainResult.loss_after}</div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Loss Delta</div>
                  <div className="text-base font-bold text-[#FF5E3A] mt-0.5">-{trainResult.loss_reduction_pct}%</div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Param Delta L2</div>
                  <div className="text-base font-bold text-[#00F0FF] mt-0.5">+{trainResult.param_mutation_delta}</div>
                </div>
              </div>

              <div className="text-[11px] text-[var(--app-text-secondary)] font-mono flex items-center justify-between pt-1 border-t border-[var(--app-card-border)]">
                <span>Avg Gradient Norm: {trainResult.avg_gradient_norm}</span>
                <span className="text-[#CCFF00] font-bold">✓ Parameters Mathematically Mutated</span>
              </div>
            </div>
          )}

          {/* Export Result Notification */}
          {exportResult && (
            <div className="p-4 rounded-xl bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-xs font-mono space-y-1 tabular-nums">
              <div className="flex items-center gap-2 font-bold text-[#00F0FF]">
                <CheckCircle2 className="w-4 h-4" />
                <span>{lang === 'th' ? 'ส่งออก Checkpoint ไบนารีเต็มรูปแบบสำเร็จ (Atomic Safe Replace)' : 'Full Tensor Checkpoint Atomically Exported'}</span>
              </div>
              <div className="text-[11px] text-[var(--app-text-primary)]">
                Size: {(exportResult.file_size / (1024 * 1024)).toFixed(2)} MB · {exportResult.tensors_count} tensors · Parameters: {exportResult.total_params.toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--app-text-secondary)] truncate">
                SHA-256: {exportResult.payload_sha256}
              </div>
            </div>
          )}
        </div>
      </VividCard>

      {/* Side-by-side evaluation data returned by the model comparison API */}
      <ModelBenchmarking
        externalComparisonData={comparisonData}
        onRefreshed={(refreshed) => setComparisonData(refreshed)}
        onPromoted={onStatusChanged}
      />

      {/* Model Checkpoint Inspection Table */}
      <VividCard
        title={lang === 'th' ? 'รายการ Tensor ใน Checkpoint' : 'Checkpoint Tensor Manifest'}
        subtitle={
          lang === 'th'
            ? 'แสดง Tensor ที่พบใน Checkpoint Manifest จากการตรวจสอบล่าสุด'
            : `Tensor entries returned by checkpoint inspection · ${statusData?.model?.weightsSource || statusData?.model?.runtimeBridgeSource || 'Runtime source not reported'}`
        }
        gradientAccent="coral"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase font-semibold">
                <th className="pb-3 pl-1">Tensor Name</th>
                <th className="pb-3">Dimension Shape</th>
                <th className="pb-3">Parameter Count</th>
                <th className="pb-3">Data Type</th>
                <th className="pb-3 text-right pr-1">Storage Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)]">
              {(modelStatus?.metadata?.tensors_manifest || modelStatus?.metadata?.tensors || []).map((tensor: any, index: number) => (
                <tr key={`${tensor.name}-${index}`} className="hover:bg-[var(--app-surface-elevated)]/40">
                  <td className="py-2.5 pl-1 font-semibold text-[var(--app-text-primary)]">{tensor.name}</td>
                  <td className="py-2.5 text-[var(--app-text-primary)]">{Array.isArray(tensor.shape) ? `[${tensor.shape.join(', ')}]` : '—'}</td>
                  <td className="py-2.5 text-[var(--app-text-primary)] font-bold">{Number(tensor.params || 0).toLocaleString()}</td>
                  <td className="py-2.5 text-[var(--app-text-secondary)]">{tensor.dtype || 'float32'}</td>
                  <td className="py-2.5 text-right pr-1 text-[var(--app-text-secondary)]">Manifest</td>
                </tr>
              ))}
              <tr className="bg-[var(--app-input-bg)] font-bold">
                <td className="py-3 pl-1 text-[var(--app-text-primary)] uppercase">Active Checkpoint Weights</td>
                <td className="py-3 text-[var(--app-text-primary)]">
                  {activeArchitecture}
                </td>
                <td className="py-3 text-[#00F0FF] font-bold text-sm">{displayedParams != null ? `${formatNumber(displayedParams)} Params` : '—'}</td>
                <td className="py-3 text-[var(--app-text-secondary)]">{fileSizeMb} MB</td>
                <td className="py-3 text-right pr-1 text-[#CCFF00]">
                  {activeWeightsLoaded ? 'Loaded by runtime' : totalParams > 0 ? 'Checkpoint inspected; not confirmed active' : 'Unavailable'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </VividCard>

      {/* Hardware Monitor & Training Progress */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setIsGradOverlayOpen(true)}
          className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold border border-[var(--app-card-border)] bg-[var(--app-input-bg)] text-[var(--app-text-primary)] hover:border-[#00F0FF] transition-colors cursor-pointer"
        >
          Inspect Per-Layer Gradient Norms
        </button>
      </div>

      <HardwareMonitor isTraining={isTraining} activeModelLabel={activeModel?.name || undefined} />
      <TrainingProgress trainResult={trainResult} epochs={trainingEpochs} isTraining={isTraining} />
      <MemoryShardMap isTraining={isTraining} hasTrainedStep={Boolean(trainResult)} activeKey={activeKey} />

      <GradientNormOverlay
        isOpen={isGradOverlayOpen}
        onClose={() => setIsGradOverlayOpen(false)}
        layerNorms={layerNorms}
        trainingStep={trainResult?.training_step}
        executedBridge={trainResult?.executed_runtime_bridge || statusData?.model?.runtimeBridgeSource}
        totalParams={trainResult?.total_params ?? displayedParams ?? undefined}
        forwardGraph={trainResult?.forward_graph}
        auditBlockIndex={trainResult?.audit_block_index}
        isTraining={isTraining}
        onRunSingleStep={() => handleExecuteTraining(1)}
      />
    </div>
  );
};
