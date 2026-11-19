import React, { useState, useEffect, useCallback } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { CloudSecretsConfig } from '../CloudSecretsConfig';
import { S3CredentialsValidator } from '../S3CredentialsValidator';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth, AuthRole } from '../../context/AuthContext';
import {
  getApiBaseUrl,
  setApiBaseUrl,
  isNativeAndroidApp,
  isNativeCapacitorApp,
  resolveWebSocketUrl,
} from '../../lib/apiClient';
import {
  User,
  Palette,
  Cpu,
  Database,
  ShieldCheck,
  Activity,
  Code2,
  Building2,
  Lock,
  KeyRound,
  HardDrive,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Smartphone,
  Server,
  RefreshCw,
} from 'lucide-react';

type ControlRole = AuthRole;
export type ControlSection =
  | 'account'
  | 'appearance'
  | 'secrets'
  | 's3_storage'
  | 'intelligence'
  | 'memory'
  | 'security'
  | 'runtime'
  | 'developer'
  | 'organization'
  | 'access';

interface ConfigAuditEntry {
  id: string;
  actor: ControlRole;
  timestamp: string;
  setting: string;
  oldValue: string;
  newValue: string;
}

interface UserSettingsProps {
  initialSection?: ControlSection;
  returnToModuleLabel?: string | null;
  onReturnToTask?: () => void;
}

export const UserSettings: React.FC<UserSettingsProps> = ({
  initialSection,
  returnToModuleLabel,
  onReturnToTask,
}) => {
  const { lang } = useLanguage();
  const {
    role,
    setRole,
    session,
    isAuthenticated,
    sessionExpired,
    devAccessEnabled,
    authError,
    loginWithGoogle,
    logout,
  } = useAuth();
  const [activeSection, setActiveSection] = useState<ControlSection>(initialSection || 'account');

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  const [tenantName, setTenantName] = useState(session.tenantId);
  useEffect(() => {
    setTenantName(session.tenantId);
  }, [session.tenantId]);

  const [memoryRetention, setMemoryRetention] = useState('infinite');
  const [liveStatus, setLiveStatus] = useState<any>(null);
  const [liveReadiness, setLiveReadiness] = useState<any>(null);
  const [sovereigntyStatus, setSovereigntyStatus] = useState<'VERIFIED' | 'BLOCKED' | 'UNVERIFIED'>('UNVERIFIED');
  const [configAudit, setConfigAudit] = useState<ConfigAuditEntry[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<ControlRole, Record<string, boolean>>>({
    User: { nativeInference: true, modelTraining: false, sandboxExec: false, auditExport: false },
    Developer: { nativeInference: true, modelTraining: false, sandboxExec: true, auditExport: true },
    Administrator: { nativeInference: true, modelTraining: false, sandboxExec: true, auditExport: true },
  });

  // Android / Remote Express + WebSocket Connector state
  const [backendUrlInput, setBackendUrlInput] = useState<string>(() => getApiBaseUrl());
  const [backendProbeResult, setBackendProbeResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [probingBackend, setProbingBackend] = useState(false);

  const loadLiveStatus = useCallback(async () => {
    try {
      const [statusRes, readyRes] = await Promise.all([
        fetch('/api/system/status', { cache: 'no-store' }),
        fetch('/api/system/training-readiness', { cache: 'no-store' }),
      ]);
      const statusJson = await statusRes.json().catch(() => null);
      const readyJson = await readyRes.json().catch(() => null);
      if (statusJson?.success) {
        setLiveStatus(statusJson);
        setSovereigntyStatus(
          statusJson.model?.weightsLoaded && statusJson.model?.inferenceReady ? 'VERIFIED' : 'BLOCKED'
        );
      }
      if (readyJson?.success) {
        setLiveReadiness(readyJson);
      }
    } catch {
      setSovereigntyStatus('UNVERIFIED');
    }
  }, []);

  useEffect(() => {
    void loadLiveStatus();
  }, [loadLiveStatus]);

  const recordConfigChange = (setting: string, oldValue: string, newValue: string) => {
    if (oldValue === newValue) return;
    setConfigAudit((prev) => [
      {
        id: `cfg-${Date.now()}`,
        actor: role,
        timestamp: new Date().toISOString(),
        setting,
        oldValue,
        newValue,
      },
      ...prev.slice(0, 19),
    ]);
  };

  const handleSaveAndTestBackendUrl = async () => {
    setProbingBackend(true);
    setBackendProbeResult(null);
    const saved = setApiBaseUrl(backendUrlInput);
    if (!saved.ok) {
      setBackendProbeResult({ ok: false, message: saved.error || 'Invalid URL' });
      setProbingBackend(false);
      return;
    }
    recordConfigChange('Mobile Backend Server Origin', getApiBaseUrl() || 'same-origin', saved.normalized || 'same-origin');
    const started = performance.now();
    try {
      const healthRes = await fetch('/api/health', { cache: 'no-store' });
      const data = await healthRes.json().catch(() => ({}));
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      if (!healthRes.ok || data?.status !== 'healthy') {
        throw new Error(data?.error || `HTTP ${healthRes.status}`);
      }
      setBackendProbeResult({
        ok: true,
        latencyMs,
        message: `Connected (${latencyMs}ms) · WS: ${resolveWebSocketUrl('/ws/runtime') || 'n/a'}`,
      });
      await loadLiveStatus();
    } catch (err: any) {
      setBackendProbeResult({
        ok: false,
        message: `Unreachable: ${err?.message || 'Network or CORS error'}`,
      });
    } finally {
      setProbingBackend(false);
    }
  };

  const sections: Array<{ id: ControlSection; label: string; thLabel: string; icon: React.ReactNode }> = [
    { id: 'account', label: '1. Account & Identity', thLabel: '1. บัญชีและตัวตน', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: '2. Appearance & TTS', thLabel: '2. ธีม ภาษา และเสียง', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'secrets', label: '3. Secrets (Cloud Env)', thLabel: '3. Secrets (ตัวแปรระบบคลาวด์)', icon: <KeyRound className="w-3.5 h-3.5" /> },
    { id: 's3_storage', label: '4. AWS S3 Credentials', thLabel: '4. AWS S3 Credentials (ตรวจ Bucket)', icon: <HardDrive className="w-3.5 h-3.5" /> },
    { id: 'intelligence', label: '5. Native Intelligence', thLabel: '5. ระบบประสาทเทียม', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'memory', label: '6. Memory & Knowledge', thLabel: '6. ความจำและข้อมูล', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'security', label: '7. Security & Privacy', thLabel: '7. ความปลอดภัย', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'runtime', label: '8. Android & Server Link', thLabel: '8. Android & รันไทม์', icon: <Smartphone className="w-3.5 h-3.5" /> },
    { id: 'developer', label: '9. Developer & APIs', thLabel: '9. นักพัฒนาและ API', icon: <Code2 className="w-3.5 h-3.5" /> },
    { id: 'organization', label: '10. Organization', thLabel: '10. องค์กรและการค้า', icon: <Building2 className="w-3.5 h-3.5" /> },
    { id: 'access', label: '11. Access Control', thLabel: '11. ควบคุมสิทธิ์ (RBAC)', icon: <Lock className="w-3.5 h-3.5" /> },
  ];

  const handleClearLocalData = () => {
    localStorage.removeItem('zyntheor_quick_logs');
    localStorage.removeItem('zyntheor_log_snapshots');
    recordConfigChange('Local Session Logs & Snapshots', 'PRESENT', 'CLEARED');
  };

  const activeParams = liveStatus?.model?.activeParams ?? liveStatus?.model?.totalParams ?? 0;
  const targetParams = liveStatus?.model?.targetParams ?? 41_527_808;
  const weightsLoaded = Boolean(liveStatus?.model?.weightsLoaded);
  const numpyAvailable = Boolean(liveReadiness?.pythonBackend?.numpyAvailable);
  const trainingStatusLabel = numpyAvailable && weightsLoaded ? 'READY' : 'BLOCKED';

  const renderAndroidConnectorCard = () => (
    <VividCard
      title={lang === 'th' ? 'เชื่อมต่อ ZYNTHEOR Android / Remote Express Server' : 'Android & Remote Express + WebSocket Connector'}
      subtitle={
        lang === 'th'
          ? 'กำหนด URL ของเซิร์ฟเวอร์ Express + Python Native Bridge สำหรับแอป Android Capacitor (HTTPS + WSS)'
          : 'Configure Express + WebSocket origin for Capacitor Android APK or remote browser deployments'
      }
      gradientAccent="cyan"
    >
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--app-accent)]" />
            <span className="font-semibold text-[var(--app-text-primary)]">
              Platform: {isNativeAndroidApp() ? 'Capacitor Android Native' : isNativeCapacitorApp() ? 'Capacitor Hybrid' : 'Web / Desktop Browser'}
            </span>
          </div>
          <StatusDot status={backendProbeResult ? (backendProbeResult.ok ? 'ONLINE' : 'BLOCKED') : 'IMPLEMENTED'} />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-bold text-[var(--app-text-secondary)]">
            Express Server Base URL (leave empty for same-origin web; Android emulator uses http://10.0.2.2:3000)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              value={backendUrlInput}
              onChange={(e) => setBackendUrlInput(e.target.value)}
              placeholder="https://your-zyntheor-backend.run.app or http://10.0.2.2:3000"
              className="flex-1 min-w-[220px] px-3.5 py-2 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
            />
            <button
              type="button"
              disabled={probingBackend}
              onClick={() => void handleSaveAndTestBackendUrl()}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${probingBackend ? 'animate-spin' : ''}`} />
              <span>{probingBackend ? 'Testing…' : 'Save & Test /api/health'}</span>
            </button>
          </div>
        </div>

        {backendProbeResult && (
          <div
            className={`p-2.5 rounded-xl font-mono text-[11px] border ${
              backendProbeResult.ok
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_10%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] text-[var(--z-ok)]'
                : 'bg-[color-mix(in_srgb,var(--z-danger)_10%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-[var(--z-danger)]'
            }`}
          >
            {backendProbeResult.message}
          </div>
        )}
      </div>
    </VividCard>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      {returnToModuleLabel && onReturnToTask && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-surface))]">
          <div className="text-xs text-[var(--app-text-primary)]">
            {isAuthenticated ? (
              <span>
                Signed in as <strong className="font-mono text-[var(--app-accent)]">{role}</strong>. Ready to return to{' '}
                <strong>{returnToModuleLabel}</strong>.
              </span>
            ) : (
              <span>
                Sign in below to unlock protected actions and return to <strong>{returnToModuleLabel}</strong>.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onReturnToTask}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to {returnToModuleLabel}</span>
          </button>
        </div>
      )}

      {/* System Control Center Header + RBAC Switcher */}
      <VividCard
        title={lang === 'th' ? 'ศูนย์ควบคุมระบบ ZYNTHEOR (Account & Settings)' : 'ZYNTHEOR Account & System Settings'}
        subtitle={
          lang === 'th'
            ? 'ควบคุมผู้ใช้ การเชื่อมต่อ Android App, Secrets, ระบบประสาทเทียม และสิทธิ์ RBAC'
            : 'Unified control plane for Identity, Android Backend Connector, Cloud Secrets, and Runtime'
        }
        gradientAccent="emerald"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loginWithGoogle()}
                className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer transition-colors"
              >
                Continue with Google
              </button>
              {devAccessEnabled && (
                <>
                  <span className="text-xs font-semibold text-[var(--app-text-secondary)]">
                    {lang === 'th' ? 'สิทธิ์การเข้าถึง (Dev Access):' : 'Dev Role:'}
                  </span>
                  {(['User', 'Developer', 'Administrator'] as ControlRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        role === r && isAuthenticated
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[var(--app-accent)]'
                          : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)]'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </>
              )}
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={logout}
                  className="min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold bg-[var(--app-surface)] text-[var(--z-danger)] border border-[var(--app-card-border)] hover:border-[var(--z-danger)] cursor-pointer"
                >
                  Sign out
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
              {session.authMode === 'development' && (
                <StatusDot status="PARTIAL" label="DEV ACCESS" />
              )}
              <StatusDot
                status={sovereigntyStatus}
                label={`SOVEREIGNTY: ${sovereigntyStatus}`}
              />
              <StatusDot status="BLOCKED" label="EXTERNAL AI: BLOCKED" />
            </div>
          </div>

          {(authError || sessionExpired) && (
            <div className="p-2.5 rounded-lg text-xs font-mono text-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_35%,transparent)]">
              Auth notice: {authError || 'Session expired. Sign in again to restore protected privileges.'}
            </div>
          )}
        </div>
      </VividCard>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Navigation */}
        <div className="space-y-1.5">
          {sections
            .filter((sec) => {
              if (role === 'User') {
                return ['account', 'appearance', 'secrets', 's3_storage', 'memory', 'runtime'].includes(sec.id);
              }
              if (role === 'Developer') {
                return ['account', 'appearance', 'secrets', 's3_storage', 'intelligence', 'memory', 'runtime', 'developer'].includes(sec.id);
              }
              return true;
            })
            .map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full min-h-[42px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer text-left ${
                  activeSection === sec.id
                    ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)]'
                    : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {sec.icon}
                <span>{lang === 'th' ? sec.thLabel : sec.label}</span>
              </button>
            ))}
        </div>

        {/* Right Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeSection === 'appearance' && (
            <VividCard
              title={lang === 'th' ? 'ธีม ภาษา และประสบการณ์ผู้ใช้' : 'Appearance, Language & Experience'}
              subtitle="VIVID INTELLIGENCE Theme & Voice Engine"
              gradientAccent="emerald"
            >
              <ThemeSwitcher />
            </VividCard>
          )}

          {activeSection === 'secrets' && (
            <CloudSecretsConfig onAuditMutated={recordConfigChange} />
          )}

          {activeSection === 's3_storage' && (
            <S3CredentialsValidator onAuditMutated={recordConfigChange} />
          )}

          {activeSection === 'account' && (
            <>
              <VividCard
                title={lang === 'th' ? 'บัญชีและตัวตน (Account & Identity)' : 'Account & Identity'}
                subtitle={lang === 'th' ? 'โปรไฟล์ เซสชัน และรหัส Tenant' : 'Profile, Session & Tenant Identity'}
                gradientAccent="emerald"
              >
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[var(--app-text-secondary)] font-bold mb-1">
                      {lang === 'th' ? 'รหัสองค์กร (Tenant Identifier)' : 'Tenant Identifier'}
                    </label>
                    <input
                      type="text"
                      value={tenantName}
                      onChange={(e) => {
                        recordConfigChange('tenantName', tenantName, e.target.value);
                        setTenantName(e.target.value);
                      }}
                      className="w-full px-3.5 py-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <span className="text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'ตัวตนที่ยืนยันแล้ว' : 'Authenticated Identity'}
                    </span>
                    <span className="font-mono font-bold text-[var(--app-text-primary)]">
                      {isAuthenticated ? `${session.email || session.userId} (${role})` : (lang === 'th' ? 'ผู้เยี่ยมชม (ยังไม่เข้าสู่ระบบ)' : 'Guest (unauthenticated)')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <span className="text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'บทบาทสิทธิ์ RBAC' : 'Active RBAC Role'}
                    </span>
                    <span className="font-mono font-bold text-[var(--app-accent)]">{role}</span>
                  </div>
                </div>
              </VividCard>
              {renderAndroidConnectorCard()}
            </>
          )}

          {activeSection === 'intelligence' && (
            <VividCard
              title={lang === 'th' ? 'Telemetry ระบบประสาทเทียม (Native Intelligence)' : 'Native Intelligence Telemetry'}
              subtitle={lang === 'th' ? 'ค่าจริงจาก /api/system/status และ /api/system/training-readiness' : 'Live values reported from /api/system/status & /api/system/training-readiness'}
              gradientAccent="emerald"
            >
              <div className="space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <span className="text-[var(--app-text-secondary)]">
                    {lang === 'th' ? 'โมเดล Native ที่ใช้งานอยู่' : 'Active Native Model'}
                  </span>
                  <span className="font-mono font-bold text-[var(--app-text-primary)] tabular-nums">
                    {weightsLoaded
                      ? `${activeParams.toLocaleString()} active params (${liveStatus?.model?.architecture || 'PureSeqLM'})`
                      : lang === 'th'
                        ? `0 active params · ยังไม่โหลดบน Cloud (เป้าหมาย ${targetParams.toLocaleString()})`
                        : `0 active params · Cloud load not confirmed (target ${targetParams.toLocaleString()})`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <span className="text-[var(--app-text-secondary)]">
                    {lang === 'th' ? 'เกตการฝึกโมเดล 5,800 Steps' : '5,800-Step Full-Model Training Gate'}
                  </span>
                  <StatusDot
                    status={trainingStatusLabel}
                    label={`${trainingStatusLabel} (${liveReadiness?.pythonBackend?.backendMode || 'PROBING'})`}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <span className="text-[var(--app-text-secondary)]">Checkpoint SHA-256</span>
                  <span className="font-mono text-[var(--app-text-primary)] break-all">
                    {liveStatus?.model?.checkpointSha256 || liveStatus?.model?.checkpointHash || (lang === 'th' ? 'ยังไม่โหลด' : 'Not loaded')}
                  </span>
                </div>
              </div>
            </VividCard>
          )}

          {activeSection === 'memory' && (
            <VividCard
              title={lang === 'th' ? 'อธิปไตยข้อมูลและความจำ (Memory)' : 'Data Sovereignty & Memory'}
              subtitle={lang === 'th' ? 'นโยบายการเก็บข้อมูล การสำรอง และล้างข้อมูลเฉพาะเครื่อง' : 'Retention, Backup & Governed Data Deletion'}
              gradientAccent="emerald"
            >
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-[var(--app-text-secondary)] font-bold mb-1">
                    {lang === 'th' ? 'ระยะเวลาเก็บความจำ Episodic Memory' : 'Episodic Memory Retention'}
                  </label>
                  <select
                    value={memoryRetention}
                    onChange={(e) => {
                      recordConfigChange('memoryRetention', memoryRetention, e.target.value);
                      setMemoryRetention(e.target.value);
                    }}
                    className="w-full px-3.5 py-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  >
                    <option value="infinite">{lang === 'th' ? 'ตามนโยบายระบบ (ถาวรภายใต้การกำกับ)' : 'Managed retention policy'}</option>
                    <option value="90d">{lang === 'th' ? 'หมุนเวียน 90 วัน' : '90 Days Rolling'}</option>
                    <option value="30d">{lang === 'th' ? 'หมุนเวียน 30 วัน' : '30 Days Rolling'}</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleClearLocalData}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[color-mix(in_srgb,var(--z-danger)_16%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--z-danger)_24%,transparent)] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {lang === 'th' ? 'ล้างประวัติเซสชันและ Snapshot บนเบราว์เซอร์' : 'Clear Local Session Logs & Snapshots'}
                </button>
              </div>
            </VividCard>
          )}

          {activeSection === 'access' && (
            <VividCard
              title={lang === 'th' ? 'ควบคุมสิทธิ์การเข้าถึง (Access Control / RBAC)' : 'Access Control (RBAC Permissions)'}
              subtitle={lang === 'th' ? `สิทธิ์ระบบปัญญาประดิษฐ์สำหรับบทบาท ${role}` : `Granular native intelligence permissions for ${role}`}
              gradientAccent="emerald"
            >
              <div className="space-y-2.5 text-xs">
                {[
                  { key: 'nativeInference', label: lang === 'th' ? 'ประมวลผล Native Neural Inference (Cloud Runtime)' : 'Native Neural Inference (Cloud Runtime)' },
                  { key: 'modelTraining', label: lang === 'th' ? 'ฝึกโมเดลใน ModelLaboratory' : 'Model Laboratory Training' },
                  { key: 'sandboxExec', label: lang === 'th' ? 'รันคำสั่งใน DevStudio Sandbox' : 'DevStudio Sandbox Execution' },
                  { key: 'auditExport', label: lang === 'th' ? 'ส่งออก Audit Ledger & หลักฐานความถูกต้อง' : 'Audit Ledger & Provenance Export' },
                ].map((perm) => {
                  const enabled = rolePermissions[role][perm.key];
                  return (
                    <div
                      key={perm.key}
                      className="flex items-center justify-between p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]"
                    >
                      <span className="text-[var(--app-text-primary)] font-semibold">{perm.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !enabled;
                          setRolePermissions((prev) => ({
                            ...prev,
                            [role]: { ...prev[role], [perm.key]: next },
                          }));
                          recordConfigChange(`${role}.${perm.key}`, String(enabled), String(next));
                        }}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition-colors ${
                          enabled
                            ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                            : 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
                        }`}
                      >
                        {enabled ? (lang === 'th' ? 'อนุญาต (ALLOWED)' : 'ALLOWED') : (lang === 'th' ? 'ปฏิเสธ (DENIED)' : 'DENIED')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </VividCard>
          )}

          {activeSection === 'runtime' && renderAndroidConnectorCard()}

          {(activeSection === 'security' ||
            activeSection === 'developer' ||
            activeSection === 'organization') && (
            <VividCard
              title={
                (lang === 'th'
                  ? sections.find((s) => s.id === activeSection)?.thLabel
                  : sections.find((s) => s.id === activeSection)?.label) || 'System Policy'
              }
              subtitle={lang === 'th' ? 'การตั้งค่าที่บังคับใช้จากฝั่งเซิร์ฟเวอร์ (อ่านอย่างเดียว)' : 'Backend-enforced sovereign configuration (READ-ONLY)'}
              gradientAccent="emerald"
            >
              <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--app-amber)] shrink-0" />
                <span>
                  {role === 'Administrator'
                    ? lang === 'th'
                      ? 'มุมมอง Administrator ทำงานอยู่ — Secrets, ขอบเขต ToolGateway Sandbox และนโยบายบังคับใช้ใน server.ts'
                      : 'Administrator view active. Server-side secrets, ToolGateway sandbox barriers, and scheduler policies are enforced in server.ts.'
                    : lang === 'th'
                      ? `สิทธิ์ ${role} อ่านได้อย่างเดียว — ต้องใช้สิทธิ์ Administrator เพื่อตรวจการตั้งค่าระดับองค์กร`
                      : `Read-only for ${role} role. Switch to Administrator to inspect full governance controls.`}
                </span>
              </div>
            </VividCard>
          )}

          {/* Configuration Integrity Audit Trail */}
          <VividCard
            title={lang === 'th' ? 'บันทึกการเปลี่ยนแปลงการตั้งค่า (Audit Trail)' : 'Configuration Integrity Audit Trail'}
            subtitle={lang === 'th' ? 'ทุกการแก้ไขจะบันทึกผู้ดำเนินการ เวลา ค่าเดิม และค่าใหม่' : 'Every setting mutation is logged with actor, timestamp, old value & new value'}
            gradientAccent="amber"
          >
            {configAudit.length === 0 ? (
              <div className="text-xs text-[var(--app-text-secondary)] italic">
                {lang === 'th' ? 'ยังไม่มีการเปลี่ยนแปลงการตั้งค่าในเซสชันนี้' : 'No configuration changes recorded in this session.'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
                {configAudit.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]"
                  >
                    <span className="text-[var(--app-accent)] font-bold">[{entry.actor}] {entry.setting}</span>
                    <span className="text-[var(--app-text-secondary)]">
                      {entry.oldValue} → <span className="text-[var(--app-amber)]">{entry.newValue}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </VividCard>
        </div>
      </div>
    </div>
  );
};
