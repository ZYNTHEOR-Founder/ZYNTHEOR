import React, { useRef, useState } from 'react';
import { SystemStatusData } from '../../types';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusDot } from '../ui/StatusBadge';
import { ConnectivityE2EVerifier } from '../ui/ConnectivityE2EVerifier';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  Activity,
  BrainCircuit,
  Cloud,
  Layers3,
  LogIn,
  RefreshCw,
  Send,
  ShieldCheck,
  Wrench,
} from 'lucide-react';

interface IntelligenceCoreProps {
  statusData: SystemStatusData | null;
  onRefreshStatus?: () => Promise<void> | void;
  onOpenSignIn?: () => void;
}

const TARGET_PARAMS = 41_527_808;
const count = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const IntelligenceCore: React.FC<IntelligenceCoreProps> = ({
  statusData,
  onRefreshStatus,
  onOpenSignIn,
}) => {
  const { authHeaders, isAuthenticated } = useAuth();
  const { lang } = useLanguage();
  const model = statusData?.model;
  const connectivity = statusData?.connectivity;
  const ready = Boolean(
    model?.weightsLoaded &&
      model?.inferenceReady &&
      connectivity?.executionVerified !== false &&
      model?.runtimeState === 'READY'
  );

  const internetReachable = Boolean(connectivity?.internetReachable);
  const cloudConfigured = Boolean(connectivity?.cloudStorageConfigured);
  const cloudReachable = Boolean(connectivity?.cloudStorageReachable);
  const bridgeReachable = Boolean(connectivity?.pythonBridgeReachable);
  const remediationSteps: string[] = Array.isArray(connectivity?.remediationSteps)
    ? connectivity.remediationSteps
    : [];
  const activeParams = ready ? (model?.activeParams ?? model?.totalParams ?? null) : null;
  const checkpointSeal = ready
    ? model?.checkpointSha256 || model?.checkpointHash || connectivity?.checkpointSha256 || ''
    : '';

  const [prompt, setPrompt] = useState('Explain how to verify a native model checkpoint.');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const [cloudUrlInput, setCloudUrlInput] = useState('');
  const [cloudKeyInput, setCloudKeyInput] = useState('');
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const cloudUrlRef = useRef<HTMLInputElement | null>(null);

  const handleRefresh = async () => {
    if (!onRefreshStatus || refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshStatus();
    } finally {
      setRefreshing(false);
    }
  };

  const handleReconnectCloud = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (reconnectBusy) return;
    setReconnectBusy(true);
    setConnectMessage('');
    setError('');
    try {
      const body: Record<string, string> = {};
      if (cloudUrlInput.trim()) body.presignedUrl = cloudUrlInput.trim();
      if (cloudKeyInput.trim()) body.objectKey = cloudKeyInput.trim();
      const response = await fetch('/api/connectivity/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        const msg = data.error || data.reason || `HTTP ${response.status}`;
        setError(
          lang === 'th'
            ? `เชื่อมต่อ Cloud Runtime ไม่สำเร็จ: ${msg}`
            : `Cloud Runtime connection failed: ${msg}`
        );
      } else {
        setConnectMessage(
          lang === 'th'
            ? `โหลดและตรวจสอบ Checkpoint สำเร็จ (${count(data.activeParams)} active params · SHA-256: ${String(
                data.checkpointSha256 || ''
              ).slice(0, 12)}…)`
            : `Cloud Checkpoint loaded & verified (${count(data.activeParams)} active params · SHA-256: ${String(
                data.checkpointSha256 || ''
              ).slice(0, 12)}…)`
        );
      }
      await onRefreshStatus?.();
    } catch (err: any) {
      setError(err?.message || 'Unable to connect to Cloud Checkpoint runtime.');
    } finally {
      setReconnectBusy(false);
    }
  };

  const runInference = async () => {
    if (!prompt.trim() || busy) return;
    setResult(null);
    setError('');

    if (!ready) {
      setError(
        lang === 'th'
          ? 'ยังไม่สามารถรัน Inference ได้แบบ Fail-Closed เพราะยังไม่มี Cloud Checkpoint ที่ผ่านการตรวจ SHA-256 และโหลด Weight — กรุณาวาง Presigned Checkpoint URL ด้านบนแล้วกด "Connect & Load Checkpoint" (หรือตั้งค่า CHECKPOINT_PRESIGNED_URL / S3_BUCKET)'
          : 'Inference is fail-closed until a verified Cloud Checkpoint is connected and loaded. Paste a Presigned Checkpoint URL above and click "Connect & Load Checkpoint" (or configure CHECKPOINT_PRESIGNED_URL / S3_BUCKET).'
      );
      cloudUrlRef.current?.focus();
      return;
    }

    if (!isAuthenticated) {
      setError(
        lang === 'th'
          ? 'กรุณาเข้าสู่ระบบในหน้า Settings ก่อนเรียกใช้งาน Native Inference'
          : 'Please sign in via Settings before invoking Native Inference.'
      );
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/native/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ prompt: prompt.trim(), role: 'analysis' }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || data.code || `HTTP ${response.status}`);
      }
      setResult(data);
    } catch (err: any) {
      setError(err?.message || 'Native inference was not completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title={lang === 'th' ? 'พารามิเตอร์ที่ทำงานอยู่' : 'Active parameters'}
          value={ready ? count(activeParams) : '—'}
          subtitle={
            ready
              ? typeof activeParams === 'number' && activeParams < TARGET_PARAMS
                ? lang === 'th'
                  ? 'ซับกราฟฝึกบางส่วน · ยังไม่ครบ 41.5M'
                  : 'Partial Trained Subgraph · not full 41.5M Core'
                : lang === 'th'
                  ? 'โหลดและตรวจยืนยัน Native Core ครบแล้ว'
                  : 'Loaded & verified full Native Core'
              : lang === 'th'
                ? 'ซ่อนไว้จนกว่าจะตรวจและโหลด Cloud Checkpoint'
                : 'Hidden until Cloud Checkpoint verified & loaded'
          }
          icon={<BrainCircuit className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title={lang === 'th' ? 'สถาปัตยกรรมเป้าหมาย' : 'Target architecture'}
          value={count(model?.targetParams ?? TARGET_PARAMS)}
          subtitle={lang === 'th' ? 'สเปกออกแบบเป้าหมาย · ยังไม่ใช่น้ำหนักที่โหลด' : 'Design target · not active weights'}
          icon={<Layers3 className="w-5 h-5" />}
          accentColor="purple"
        />
        <MetricCard
          title={lang === 'th' ? 'สถานะ Inference Runtime' : 'Inference runtime'}
          value={ready ? (lang === 'th' ? 'พร้อมทำงาน' : 'READY') : (lang === 'th' ? 'ถูกระงับ (BLOCKED)' : 'BLOCKED')}
          subtitle={model?.runtimeState || connectivity?.runtimeState || (lang === 'th' ? 'ยังไม่มีข้อมูล Telemetry' : 'No runtime telemetry')}
          icon={<Cloud className="w-5 h-5" />}
          accentColor={ready ? 'lime' : 'coral'}
        />
        <MetricCard
          title={lang === 'th' ? 'ลายเซ็น Checkpoint' : 'Checkpoint seal'}
          value={checkpointSeal ? (lang === 'th' ? 'ตรวจพบแฮช' : 'PRESENT') : (lang === 'th' ? 'ยังไม่โหลด' : 'NOT LOADED')}
          subtitle={
            checkpointSeal
              ? checkpointSeal.slice(0, 16) + '…'
              : lang === 'th'
                ? 'ยังไม่มีลายนิ้วมือ Cloud Checkpoint'
                : 'Cloud checkpoint fingerprint unavailable'
          }
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="cyan"
        />
      </div>

      <VividCard
        title={lang === 'th' ? 'แกนประมวลผล Native Intelligence Runtime' : 'Native Intelligence Runtime'}
        subtitle={
          lang === 'th'
            ? 'แยกรายงานพารามิเตอร์ที่ใช้งานจริงออกจากสถาปัตยกรรมเป้าหมายอย่างชัดเจน และเรียกใช้ Native Cloud Runtime จริงเท่านั้น'
            : 'Active graph and target architecture are reported separately. Inference calls the real Native Cloud Runtime.'
        }
        gradientAccent="cyan"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className={`vivid-status-dot ${ready ? 'is-ready' : 'is-blocked'}`} />
            <span className="text-sm font-semibold text-[var(--app-text-primary)]">
              {ready
                ? lang === 'th'
                  ? 'พร้อมทำงาน (READY)'
                  : 'READY'
                : model?.runtimeState || connectivity?.runtimeState || (lang === 'th' ? 'ไม่พบสถานะรันไทม์' : 'RUNTIME STATUS UNAVAILABLE')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot
              status={internetReachable ? 'ONLINE' : 'BLOCKED'}
              label={`${lang === 'th' ? 'อินเทอร์เน็ต' : 'INTERNET'}: ${internetReachable ? (lang === 'th' ? 'ออนไลน์' : 'ONLINE') : (lang === 'th' ? 'ออฟไลน์' : 'OFFLINE')}`}
            />
            <span className="text-[var(--app-text-secondary)]">·</span>
            <StatusDot
              status={ready ? 'VERIFIED' : cloudConfigured ? 'BLOCKED' : 'UNVERIFIED'}
            />
            {onRefreshStatus && (
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                aria-label={lang === 'th' ? 'รีเฟรชสถานะการเชื่อมต่อ' : 'Refresh connectivity status'}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
                title={lang === 'th' ? 'รีเฟรชสถานะการเชื่อมต่อ' : 'Refresh connectivity status'}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Two-Track Connectivity Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs">
          <div className="rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] p-3">
            <div className="text-[10px] font-mono uppercase text-[var(--app-text-secondary)]">
              {lang === 'th' ? '1. อินเทอร์เน็ต' : '1. Internet Connectivity'}
            </div>
            <div
              className={`mt-1 font-bold ${
                internetReachable ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
              }`}
            >
              {internetReachable ? (lang === 'th' ? 'ออนไลน์' : 'ONLINE') : (lang === 'th' ? 'ออฟไลน์' : 'OFFLINE')}
            </div>
            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)] break-words">
              {connectivity?.internetProbeDetail || (lang === 'th' ? 'กำลังตรวจสอบเครือข่ายสาธารณะ…' : 'Checking public network reachability…')}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] p-3">
            <div className="text-[10px] font-mono uppercase text-[var(--app-text-secondary)]">
              {lang === 'th' ? '2. Cloud Storage' : '2. Cloud Storage'}
            </div>
            <div
              className={`mt-1 font-bold ${
                cloudConfigured && cloudReachable
                  ? 'text-[var(--z-ok)]'
                  : cloudConfigured
                  ? 'text-[var(--z-warn)]'
                  : 'text-[var(--z-danger)]'
              }`}
            >
              {cloudConfigured
                ? cloudReachable
                  ? lang === 'th'
                    ? 'เชื่อมต่อได้'
                    : 'REACHABLE'
                  : lang === 'th'
                    ? 'เข้าถึงไม่ได้'
                    : 'UNREACHABLE'
                : lang === 'th'
                  ? 'ยังไม่ตั้งค่า'
                  : 'NOT CONFIGURED'}
            </div>
            <div className="mt-1 text-[11px] font-mono text-[var(--app-text-secondary)] break-all">
              {connectivity?.cloudSourceUri ||
                (connectivity?.cloudConfigMissingKeys?.length
                  ? `${lang === 'th' ? 'ขาดตัวแปร:' : 'Missing:'} ${connectivity.cloudConfigMissingKeys.join(', ')}`
                  : lang === 'th'
                    ? 'ตั้งค่า CHECKPOINT_PRESIGNED_URL หรือ S3_BUCKET'
                    : 'Set CHECKPOINT_PRESIGNED_URL or S3_BUCKET')}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] p-3">
            <div className="text-[10px] font-mono uppercase text-[var(--app-text-secondary)]">
              {lang === 'th' ? '3. Native Bridge & Weights' : '3. Native Bridge & Weights'}
            </div>
            <div
              className={`mt-1 font-bold ${
                ready
                  ? 'text-[var(--z-ok)]'
                  : bridgeReachable
                  ? 'text-[var(--z-warn)]'
                  : 'text-[var(--z-danger)]'
              }`}
            >
              {ready
                ? lang === 'th'
                  ? 'ยืนยันแล้ว & พร้อมทำงาน'
                  : 'VERIFIED & READY'
                : bridgeReachable
                ? lang === 'th'
                  ? 'Bridge พร้อม · ยังไม่โหลด Weights'
                  : 'BRIDGE UP · NO WEIGHTS'
                : lang === 'th'
                  ? 'Bridge ไม่ตอบสนอง'
                  : 'BRIDGE UNREACHABLE'}
            </div>
            <div className="mt-1 text-[11px] font-mono text-[var(--app-text-secondary)]">
              {ready
                ? `${lang === 'th' ? 'พารามิเตอร์ที่ใช้งาน:' : 'Active Params:'} ${count(activeParams)}`
                : lang === 'th'
                  ? 'ซ่อนค่าพารามิเตอร์จนกว่าจะตรวจ SHA-256 และ Forward Pass ผ่าน'
                  : 'Active Params withheld until SHA-256 & forward-pass verified'}
            </div>
          </div>
        </div>

        <p className="text-sm leading-6 text-[var(--app-text-secondary)] mb-4">
          {ready
            ? lang === 'th'
              ? 'Cloud Runtime ยืนยันการโหลด Checkpoint และเปิดใช้งาน Inference แล้ว สถานะนี้มีผลเฉพาะ Payload ปัจจุบันเท่านั้น'
              : 'The Cloud Runtime reports a loaded checkpoint and enabled inference. This status applies to the active payload only.'
            : model?.readinessReason ||
              connectivity?.reason ||
              (lang === 'th'
                ? 'Native Inference ถูกระงับแบบ Fail-Closed จนกว่าจะโหลดและตรวจยืนยัน Checkpoint จาก Cloud Storage'
                : 'Native inference remains blocked until a valid checkpoint is loaded and verified from Cloud Storage.')}
        </p>

        {!ready && remediationSteps.length > 0 && (
          <div
            data-testid="intelligence-core-remediation"
            className="mb-4 p-3 rounded-xl border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-amber)_8%,var(--app-surface-elevated))] text-xs"
          >
            <div className="font-bold text-[var(--app-amber)] mb-1.5 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" />
              <span>
                {lang === 'th'
                  ? 'สาเหตุและขั้นตอนการเชื่อมต่อ Cloud Model'
                  : 'Diagnostics & Cloud Model Remediation'}
              </span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[var(--app-text-primary)]">
              {remediationSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Interactive Cloud Checkpoint Connect / Reload Form */}
        <form onSubmit={handleReconnectCloud} className="mb-5 flex flex-col sm:flex-row gap-2">
          <input
            ref={cloudUrlRef}
            type="url"
            value={cloudUrlInput}
            onChange={(e) => setCloudUrlInput(e.target.value)}
            placeholder={
              lang === 'th'
                ? 'Presigned Checkpoint URL (https://.../model_checkpoint.pt)'
                : 'Presigned Checkpoint URL (https://.../model_checkpoint.pt)'
            }
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
          />
          <input
            type="text"
            value={cloudKeyInput}
            onChange={(e) => setCloudKeyInput(e.target.value)}
            placeholder={lang === 'th' ? 'S3 Key (ไม่บังคับ)' : 'Optional S3 Key'}
            className="sm:w-44 px-3 py-2.5 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
          />
          <button
            type="submit"
            disabled={reconnectBusy}
            className="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold bg-[var(--app-accent-deep)] text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>
              {reconnectBusy
                ? lang === 'th'
                  ? 'กำลังเชื่อมต่อ…'
                  : 'Connecting…'
                : lang === 'th'
                  ? 'เชื่อมต่อและโหลด Checkpoint'
                  : 'Connect & Load Checkpoint'}
            </span>
          </button>
        </form>

        {connectMessage && (
          <p className="mb-4 text-xs font-mono text-[var(--z-ok)]">{connectMessage}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5 text-xs">
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]">
            <div className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ความกว้างเป้าหมาย' : 'Target width'}</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">{lang === 'th' ? '512 มิติ' : '512 dimensions'}</div>
          </div>
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]">
            <div className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ความลึกเป้าหมาย' : 'Target depth'}</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">{lang === 'th' ? '10 ชั้น' : '10 layers'}</div>
          </div>
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]">
            <div className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'หัว Attention เป้าหมาย' : 'Target attention'}</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">{lang === 'th' ? '8 Heads' : '8 heads'}</div>
          </div>
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]">
            <div className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ชั้น FFN เป้าหมาย' : 'Target FFN'}</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">{lang === 'th' ? '1,472 มิติ' : '1,472 width'}</div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runInference();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            className="flex-1 min-w-0 px-4 py-3 rounded-xl text-sm bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] disabled:opacity-60"
            placeholder={lang === 'th' ? 'ป้อนคำสั่งสำหรับประมวลผลผ่าน Inference จริง' : 'Enter a real inference request'}
          />
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="min-h-[44px] px-4 py-3 rounded-xl text-sm font-semibold vivid-gradient-brand text-white disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            {busy ? (lang === 'th' ? 'กำลังประมวลผล…' : 'Running…') : (lang === 'th' ? 'รัน Inference' : 'Run inference')}
          </button>
        </form>
        {!isAuthenticated && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--app-amber)] font-mono">
            <span>{lang === 'th' ? 'เข้าสู่ระบบก่อนเพื่อใช้งาน Native Inference และ Cloud Reconnect' : 'Sign in first to execute Native Inference and Cloud Reconnect.'}</span>
            {onOpenSignIn && (
              <button
                type="button"
                onClick={onOpenSignIn}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--app-amber)] font-sans font-bold cursor-pointer"
              >
                <LogIn className="w-3 h-3" />
                <span>{lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in'}</span>
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[var(--z-danger)]">{error}</p>}
        {result && (
          <div className="mt-4 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]">
              <Activity className="w-4 h-4" />
              Actual response · {count(result.outputTokens)} output tokens ·{' '}
              {result.latency_ms ?? '—'} ms
            </div>
            <div className="text-sm whitespace-pre-wrap leading-6 text-[var(--app-text-primary)]">
              {result.response}
            </div>
            <p className="text-[10px] font-mono break-all text-[var(--app-text-secondary)]">
              Checkpoint SHA-256: {result.checkpointSha256 || result.checkpointHash}
            </p>
          </div>
        )}

        <ConnectivityE2EVerifier
          presignedUrl={cloudUrlInput}
          objectKey={cloudKeyInput}
          testPrompt={prompt}
          authHeaders={authHeaders}
          onAfterVerify={onRefreshStatus}
        />
      </VividCard>
    </div>
  );
};
