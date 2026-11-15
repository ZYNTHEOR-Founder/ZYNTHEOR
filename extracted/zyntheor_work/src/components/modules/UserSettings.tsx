import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { Button } from '../ui/Button';
import { FormField, Input, Select } from '../ui/FormPrimitives';
import { SplitPanel, PageContainer } from '../ui/LayoutPrimitives';
import { RuntimeStatusIndicator } from '../ui/StatusBadge';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth, AuthRole } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
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
  Trash2,
  AlertTriangle,
  LogOut
} from 'lucide-react';

type ControlRole = AuthRole;
type ControlSection =
  | 'account'
  | 'appearance'
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

export const UserSettings: React.FC = () => {
  const { lang } = useLanguage();
  const { role, setRole, session, devAccessEnabled, logout } = useAuth();
  const [activeSection, setActiveSection] = useState<ControlSection>('appearance');
  const [tenantName, setTenantName] = useState(session.tenantId);
  const [memoryRetention, setMemoryRetention] = useState('infinite');
  const [sovereigntyStatus, setSovereigntyStatus] = useState<'VERIFIED' | 'PARTIAL'>('PARTIAL');
  const [liveModelInfo, setLiveModelInfo] = useState<{
    name: string | null;
    weightsLoaded: boolean;
    totalParams: number;
    weightsSource: string | null;
    failClosedReason: string | null;
  } | null>(null);
  const [configAudit, setConfigAudit] = useState<ConfigAuditEntry[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<ControlRole, Record<string, boolean>>>({
    User: { nativeInference: true, modelTraining: false, sandboxExec: false, auditExport: false },
    Developer: { nativeInference: true, modelTraining: true, sandboxExec: true, auditExport: true },
    Administrator: { nativeInference: true, modelTraining: true, sandboxExec: true, auditExport: true }
  });

  useEffect(() => {
    fetch(apiUrl('/api/system/status'))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSovereigntyStatus(d.audit?.chainValid ? 'VERIFIED' : 'PARTIAL');
          if (d.model) {
            setLiveModelInfo({
              name: d.model.name ?? null,
              weightsLoaded: Boolean(d.model.weightsLoaded),
              totalParams: Number(d.model.totalParams || 0),
              weightsSource: d.model.weightsSource ?? null,
              failClosedReason: d.model.failClosedReason ?? null,
            });
          }
        }
      })
      .catch(() => setSovereigntyStatus('PARTIAL'));
  }, []);

  const recordConfigChange = (setting: string, oldValue: string, newValue: string) => {
    if (oldValue === newValue) return;
    setConfigAudit((prev) => [
      {
        id: `cfg-${Date.now()}`,
        actor: role,
        timestamp: new Date().toISOString(),
        setting,
        oldValue,
        newValue
      },
      ...prev.slice(0, 19)
    ]);
  };

  const sections: Array<{ id: ControlSection; label: string; thLabel: string; icon: React.ReactNode }> = [
    { id: 'account', label: '1. Account & Identity', thLabel: '1. บัญชีและตัวตน', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: '2. Appearance & TTS', thLabel: '2. ธีม ภาษา และเสียง', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'intelligence', label: '3. Native Intelligence', thLabel: '3. ระบบประสาทเทียม', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'memory', label: '4. Memory & Knowledge', thLabel: '4. ความจำและข้อมูล', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'security', label: '5. Security & Privacy', thLabel: '5. ความปลอดภัย', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'runtime', label: '6. System & Runtime', thLabel: '6. ระบบและรันไทม์', icon: <Activity className="w-3.5 h-3.5" /> },
    { id: 'developer', label: '7. Developer & APIs', thLabel: '7. นักพัฒนาและ API', icon: <Code2 className="w-3.5 h-3.5" /> },
    { id: 'organization', label: '8. Organization', thLabel: '8. องค์กรและการค้า', icon: <Building2 className="w-3.5 h-3.5" /> },
    { id: 'access', label: '9. Access Control', thLabel: '9. ควบคุมสิทธิ์ (RBAC)', icon: <Lock className="w-3.5 h-3.5" /> }
  ];

  const handleClearLocalData = () => {
    localStorage.removeItem('zyntheor_quick_logs');
    localStorage.removeItem('zyntheor_log_snapshots');
    recordConfigChange('Cloud Session Logs & Snapshots', 'PRESENT', 'CLEARED');
  };

  return (
    <PageContainer maxWidth="6xl">
      {/* System Control Center Header + RBAC Switcher */}
      <VividCard
        title={lang === 'th' ? 'ศูนย์ควบคุมระบบ ZYNTHEOR (System Control Center)' : 'ZYNTHEOR System Control Center'}
        subtitle={
          lang === 'th'
            ? 'ควบคุมผู้ใช้ ระบบประสาทเทียม ความปลอดภัย และโครงสร้างพื้นฐาน พร้อมบันทึก Audit Trail'
            : 'Unified RBAC control plane for Identity, Native Intelligence, Security, and Runtime'
        }
        gradientAccent="cyan"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold" style={{ color: 'var(--app-text-secondary)' }}>
              {lang === 'th' ? 'สิทธิ์การเข้าถึง (RBAC):' : 'Active Role:'}
            </span>
            {(['User', 'Developer', 'Administrator'] as ControlRole[]).map((r) => (
              <button
                key={r}
                type="button"
                disabled={!devAccessEnabled}
                title={!devAccessEnabled ? 'Role switching is restricted to explicit development mode' : undefined}
                onClick={() => setRole(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  !devAccessEnabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                } ${
                  role === r
                    ? 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/60'
                    : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RuntimeStatusIndicator
              status={sovereigntyStatus === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL'}
              label={`SOVEREIGNTY: ${sovereigntyStatus}`}
            />
            <RuntimeStatusIndicator status="BLOCKED" label="EXTERNAL AI: BLOCKED" />
          </div>
        </div>
      </VividCard>

      <SplitPanel
        ratio="1:3"
        primary={
          <div className="space-y-1.5">
            {sections
              .filter((sec) => {
                if (role === 'User') {
                  return ['account', 'appearance', 'memory'].includes(sec.id);
                }
                if (role === 'Developer') {
                  return ['account', 'appearance', 'intelligence', 'memory', 'runtime', 'developer'].includes(sec.id);
                }
                return true;
              })
              .map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer text-left ${
                    activeSection === sec.id
                      ? 'bg-[#00F0FF]/14 text-[#00F0FF] border-[#00F0FF]/55'
                      : 'bg-[var(--app-card)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  {sec.icon}
                  <span className="truncate">{lang === 'th' ? sec.thLabel : sec.label}</span>
                </button>
              ))}
          </div>
        }
        secondary={
          <div className="space-y-6">
            {activeSection === 'appearance' && (
              <VividCard
                title={lang === 'th' ? 'ธีม ภาษา และประสบการณ์ผู้ใช้' : 'Appearance, Language & Experience'}
                subtitle="Batch 25 Midnight Navy & Vibrant Color Design System"
                gradientAccent="cyan"
              >
                <ThemeSwitcher />
              </VividCard>
            )}

            {activeSection === 'account' && (
              <VividCard title="Account & Identity" subtitle="Profile, Session & Tenant Identity" gradientAccent="blue">
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}>
                    <span style={{ color: 'var(--app-text-secondary)' }}>Authentication Mode</span>
                    <span className="font-mono font-bold text-right" style={{ color: 'var(--app-text-primary)' }}>
                      {session.authMode === 'development' ? 'Development Access (Non-Production)' : 'Google Identity (Firebase)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}>
                    <span style={{ color: 'var(--app-text-secondary)' }}>Authenticated Email</span>
                    <span className="font-mono font-bold text-right break-all" style={{ color: 'var(--app-text-primary)' }}>{session.email || 'None (dev session)'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}>
                    <span style={{ color: 'var(--app-text-secondary)' }}>User ID</span>
                    <span className="font-mono text-right break-all" style={{ color: 'var(--app-text-primary)' }}>{session.userId}</span>
                  </div>
                  <FormField label="Tenant Identifier" htmlFor="zyntheor-tenant-id">
                    <Input
                      id="zyntheor-tenant-id"
                      type="text"
                      value={tenantName}
                      onChange={(e) => {
                        recordConfigChange('tenantName', tenantName, e.target.value);
                        setTenantName(e.target.value);
                      }}
                    />
                  </FormField>
                  <div className="flex items-center justify-between p-3 rounded-xl border" style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}>
                    <span style={{ color: 'var(--app-text-secondary)' }}>Active RBAC Role</span>
                    <span className="font-mono font-bold text-[#00F0FF]">{role}</span>
                  </div>
                  <div className="pt-2">
                    <Button variant="danger" size="sm" leftIcon={<LogOut className="w-3.5 h-3.5" />} onClick={logout}>
                      Sign out
                    </Button>
                  </div>
                </div>
              </VividCard>
            )}

            {activeSection === 'intelligence' && (
              <VividCard title="Native Intelligence" subtitle="Live runtime-verified model state" gradientAccent="violet">
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}>
                    <span style={{ color: 'var(--app-text-secondary)' }}>Active Native Model</span>
                    <span className="font-mono font-bold text-right" style={{ color: 'var(--app-text-primary)' }}>
                      {liveModelInfo?.name || 'ZYNTHEOR Native Runtime (Unloaded)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}>
                    <span style={{ color: 'var(--app-text-secondary)' }}>Cloud Weights Status</span>
                    <span className={`font-mono font-bold ${liveModelInfo?.weightsLoaded ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                      {liveModelInfo === null
                        ? 'CHECKING...'
                        : liveModelInfo.weightsLoaded
                        ? `ONLINE (${liveModelInfo.totalParams.toLocaleString()} params)`
                        : 'FAIL_CLOSED (UNLOADED)'}
                    </span>
                  </div>
                  {liveModelInfo && !liveModelInfo.weightsLoaded && liveModelInfo.failClosedReason && (
                    <div className="p-3 rounded-xl border border-[#FF007F]/40 bg-[#FF007F]/10 text-[#FF85B8] font-mono text-[11px]">
                      {liveModelInfo.failClosedReason}
                    </div>
                  )}
                </div>
              </VividCard>
            )}

            {activeSection === 'memory' && (
              <VividCard title="Data Sovereignty & Memory" subtitle="Retention, Backup & Cloud Data Deletion" gradientAccent="cyan">
                <div className="space-y-4 text-xs">
                  <FormField label="Episodic Memory Retention" htmlFor="zyntheor-retention">
                    <Select
                      id="zyntheor-retention"
                      value={memoryRetention}
                      onChange={(e) => {
                        recordConfigChange('memoryRetention', memoryRetention, e.target.value);
                        setMemoryRetention(e.target.value);
                      }}
                    >
                      <option value="infinite">Infinite (Sovereign Cloud Storage)</option>
                      <option value="90d">90 Days Rolling</option>
                      <option value="30d">30 Days Rolling</option>
                    </Select>
                  </FormField>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                    onClick={handleClearLocalData}
                  >
                    Clear Cloud Session Logs & Snapshots
                  </Button>
                </div>
              </VividCard>
            )}

          {activeSection === 'access' && (
            <VividCard
              title="Access Control (RBAC Permissions)"
              subtitle={`Granular native intelligence permissions for ${role}`}
              gradientAccent="violet"
            >
              <div className="space-y-2.5 text-xs">
                {[
                  { key: 'nativeInference', label: 'Native Neural Inference (NativeLM Runtime)' },
                  { key: 'modelTraining', label: 'Model Laboratory Training' },
                  { key: 'sandboxExec', label: 'DevStudio Sandbox Execution' },
                  { key: 'auditExport', label: 'Audit Ledger & Provenance Export' }
                ].map((perm) => {
                  const enabled = rolePermissions[role][perm.key];
                  return (
                    <div
                      key={perm.key}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border"
                      style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}
                    >
                      <span className="font-semibold" style={{ color: 'var(--app-text-primary)' }}>{perm.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !enabled;
                          setRolePermissions((prev) => ({
                            ...prev,
                            [role]: { ...prev[role], [perm.key]: next }
                          }));
                          recordConfigChange(`${role}.${perm.key}`, String(enabled), String(next));
                        }}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition-colors ${
                          enabled
                            ? 'bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/45'
                            : 'bg-[#FF007F]/15 text-[#FF4FA3] border-[#FF007F]/45'
                        }`}
                      >
                        {enabled ? 'ALLOWED' : 'DENIED'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </VividCard>
          )}

          {(activeSection === 'security' ||
            activeSection === 'runtime' ||
            activeSection === 'developer' ||
            activeSection === 'organization') && (
            <VividCard
              title={sections.find((s) => s.id === activeSection)?.label || 'System Policy'}
              subtitle="Backend-enforced sovereign configuration (READ-ONLY)"
              gradientAccent="blue"
            >
              <div
                className="p-3 rounded-xl border text-xs flex items-center gap-2.5"
                style={{
                  backgroundColor: 'var(--app-bg)',
                  borderColor: 'var(--app-card-border)',
                  color: 'var(--app-text-secondary)'
                }}
              >
                <AlertTriangle className="w-4 h-4 text-[#FF5E3A] shrink-0" />
                <span>
                  {role === 'Administrator'
                    ? 'Administrator view active. Server-side secrets, ToolGateway sandbox barriers, and scheduler policies are enforced in server.ts.'
                    : `Read-only for ${role} role. Switch to Administrator to inspect full governance controls.`}
                </span>
              </div>
            </VividCard>
          )}

          {/* Configuration Integrity Audit Trail */}
          <VividCard
            title="Configuration Integrity Audit Trail"
            subtitle="Every setting mutation is logged with actor, timestamp, old value & new value"
            gradientAccent="coral"
          >
            {configAudit.length === 0 ? (
              <div className="text-xs italic" style={{ color: 'var(--app-text-secondary)' }}>
                No configuration changes recorded in this session.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
                {configAudit.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border"
                    style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--app-card-border)' }}
                  >
                    <span className="text-[#00F0FF] font-bold">[{entry.actor}] {entry.setting}</span>
                    <span style={{ color: 'var(--app-text-secondary)' }}>
                      {entry.oldValue} → <span className="text-[#FF5E3A]">{entry.newValue}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </VividCard>
        </div>
        }
      />
    </PageContainer>
  );
};
