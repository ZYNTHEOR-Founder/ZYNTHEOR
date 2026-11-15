import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth, AuthRole } from '../../context/AuthContext';
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
  CheckCircle2,
  AlertTriangle
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
  const { role, setRole, session } = useAuth();
  const [activeSection, setActiveSection] = useState<ControlSection>('appearance');
  const [tenantName, setTenantName] = useState(session.tenantId);
  const [memoryRetention, setMemoryRetention] = useState('infinite');
  const [sovereigntyStatus, setSovereigntyStatus] = useState<'VERIFIED' | 'BLOCKED' | 'UNVERIFIED'>('UNVERIFIED');
  const [configAudit, setConfigAudit] = useState<ConfigAuditEntry[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<ControlRole, Record<string, boolean>>>({
    User: { nativeInference: true, modelTraining: false, sandboxExec: false, auditExport: false },
    Developer: { nativeInference: true, modelTraining: false, sandboxExec: true, auditExport: true },
    Administrator: { nativeInference: true, modelTraining: false, sandboxExec: true, auditExport: true }
  });

  useEffect(() => {
    fetch('/api/system/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSovereigntyStatus(d.model?.weightsLoaded && d.model?.inferenceReady ? 'VERIFIED' : 'BLOCKED');
      })
      .catch(() => setSovereigntyStatus('UNVERIFIED'));
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
    recordConfigChange('Local Session Logs & Snapshots', 'PRESENT', 'CLEARED');
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* System Control Center Header + RBAC Switcher */}
      <VividCard
        title={lang === 'th' ? 'ศูนย์ควบคุมระบบ ZYNTHEOR (System Control Center)' : 'ZYNTHEOR System Control Center'}
        subtitle={
          lang === 'th'
            ? 'ควบคุมผู้ใช้ ระบบประสาทเทียม ความปลอดภัย และโครงสร้างพื้นฐาน พร้อมบันทึก Audit Trail'
            : 'Unified RBAC control plane for Identity, Native Intelligence, Security, and Runtime'
        }
        gradientAccent="emerald"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--app-text-secondary)]">
              {lang === 'th' ? 'สิทธิ์การเข้าถึง (RBAC):' : 'Active Role:'}
            </span>
            {(['User', 'Developer', 'Administrator'] as ControlRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  role === r
                    ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[var(--app-accent)]'
                    : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Security Invariant Badges (Protected Semantic Colors) */}
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span
              className="px-2.5 py-1 rounded-md font-bold flex items-center gap-1"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--z-ok) 14%, transparent)',
                color: 'var(--status-verified)',
                border: '1px solid color-mix(in srgb, var(--z-ok) 40%, transparent)'
              }}
            >
              <CheckCircle2 className="w-3 h-3" />
              SOVEREIGNTY: {sovereigntyStatus}
            </span>
            <span
              className="px-2.5 py-1 rounded-md font-bold flex items-center gap-1"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--z-danger) 14%, transparent)',
                color: 'var(--status-blocked)',
                border: '1px solid color-mix(in srgb, var(--z-danger) 40%, transparent)'
              }}
            >
              <Lock className="w-3 h-3" />
              EXTERNAL AI: BLOCKED
            </span>
          </div>
        </div>
      </VividCard>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Navigation */}
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
              subtitle="Emerald Graphite + Amber Obsidian Theme Engine"
              gradientAccent="emerald"
            >
              <ThemeSwitcher />
            </VividCard>
          )}

          {activeSection === 'account' && (
            <VividCard title="Account & Identity" subtitle="Profile, Session & Tenant Identity" gradientAccent="emerald">
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[var(--app-text-secondary)] font-bold mb-1">Tenant Identifier</label>
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
                  <span className="text-[var(--app-text-secondary)]">Active RBAC Role</span>
                  <span className="font-mono font-bold text-[var(--app-accent)]">{role}</span>
                </div>
              </div>
            </VividCard>
          )}

          {activeSection === 'intelligence' && (
            <VividCard title="Native Intelligence" subtitle="Native Intelligence Runtime Policy" gradientAccent="emerald">
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <span className="text-[var(--app-text-secondary)]">Active Native Model</span>
                  <span className="font-mono font-bold text-[var(--app-text-primary)]">231,168 checkpoint payload values · Cloud load not confirmed</span>
                </div>
                <div className="flex justify-between p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                  <span className="text-[var(--app-text-secondary)]">Full-Model Training Status</span>
                  <span className="font-mono font-bold text-[var(--app-amber)]">PARTIAL</span>
                </div>
              </div>
            </VividCard>
          )}

          {activeSection === 'memory' && (
            <VividCard title="Data Sovereignty & Memory" subtitle="Retention, Backup & Governed Data Deletion" gradientAccent="emerald">
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-[var(--app-text-secondary)] font-bold mb-1">Episodic Memory Retention</label>
                  <select
                    value={memoryRetention}
                    onChange={(e) => {
                      recordConfigChange('memoryRetention', memoryRetention, e.target.value);
                      setMemoryRetention(e.target.value);
                    }}
                    className="w-full px-3.5 py-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  >
                    <option value="infinite">Managed retention policy</option>
                    <option value="90d">90 Days Rolling</option>
                    <option value="30d">30 Days Rolling</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleClearLocalData}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[color-mix(in_srgb,var(--z-danger)_50%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] hover:bg-[var(--z-danger)] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Local Session Logs & Snapshots
                </button>
              </div>
            </VividCard>
          )}

          {activeSection === 'access' && (
            <VividCard
              title="Access Control (RBAC Permissions)"
              subtitle={`Granular native intelligence permissions for ${role}`}
              gradientAccent="emerald"
            >
              <div className="space-y-2.5 text-xs">
                {[
                  { key: 'nativeInference', label: 'Native Neural Inference (Cloud Runtime)' },
                  { key: 'modelTraining', label: 'Model Laboratory Training' },
                  { key: 'sandboxExec', label: 'DevStudio Sandbox Execution' },
                  { key: 'auditExport', label: 'Audit Ledger & Provenance Export' }
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
                            [role]: { ...prev[role], [perm.key]: next }
                          }));
                          recordConfigChange(`${role}.${perm.key}`, String(enabled), String(next));
                        }}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition-colors ${
                          enabled
                            ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                            : 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
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
              gradientAccent="emerald"
            >
              <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--app-amber)] shrink-0" />
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
            gradientAccent="amber"
          >
            {configAudit.length === 0 ? (
              <div className="text-xs text-[var(--app-text-secondary)] italic">No configuration changes recorded in this session.</div>
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
