import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EvidenceDrawerItem, ModuleId } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { StatusDot } from './ui/StatusBadge';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Search,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (module: ModuleId) => void;
  onInspectEvidence?: (item: EvidenceDrawerItem) => void;
  blockers?: Array<{
    id: string;
    component: string;
    currentState: string;
    reason: string;
    requiredDependency: string;
  }>;
  quickLogs?: string[];
}

interface SearchModuleEntry {
  id: ModuleId;
  title: string;
  keywords: string;
  minRole?: 'Developer' | 'Administrator';
}

const MODULES: SearchModuleEntry[] = [
  { id: 'command_center', title: 'Intelligence Center (Command Center)', keywords: 'overview control brain truth workflow status blockers' },
  { id: 'intelligence_core', title: 'Model Core (Native Runtime & Weights)', keywords: '41.5m weights checkpoint sha256 tokenizer inference bridge parity' },
  { id: 'proof_of_intelligence', title: 'Proof of Intelligence & Benchmark', keywords: 'proof software engineering research autonomous execution benchmark' },
  { id: 'research_lab', title: 'Training & Research Lab (5,800 Steps)', keywords: 'training numpy perplexity provenance dataset 5800 eval' },
  { id: 'model_laboratory', title: 'ModelLaboratory (Activation & 7-Phase)', keywords: 'load model weights verification 7-phase activation', minRole: 'Developer' },
  { id: 'conversational_intelligence', title: 'Reasoning Lab (Bilingual Chat)', keywords: 'chat reasoning inference thai english' },
  { id: 'knowledge_hub', title: 'Knowledge & Memory', keywords: 'documents ingest knowledge graph episodic memory citations' },
  { id: 'automation_center', title: 'Autonomous Execution', keywords: 'tasks agent missions jobs workflow' },
  { id: 'infrastructure_cloud', title: 'Infrastructure (S3/R2, Cloud SQL, Bridge)', keywords: 's3 r2 bucket cloud sql storage health python bridge' },
  { id: 'analytics_bi', title: 'Execution Insights', keywords: 'insights metrics recovery benchmark success rate' },
  { id: 'governance_security', title: 'Evidence & Audit Ledger', keywords: 'audit ledger sha256 tamper approval governance', minRole: 'Developer' },
  { id: 'dev_studio', title: 'Creation Studio (Dev Studio)', keywords: 'code sandbox projects build test repair', minRole: 'Developer' },
  { id: 'user_settings', title: 'Settings & Cloud Secrets', keywords: 'settings secrets auth role token' },
];

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onInspectEvidence,
  blockers = [],
  quickLogs = [],
}) => {
  const { lang } = useLanguage();
  const { authHeaders, isAuthenticated, role } = useAuth();
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<Array<{ id: string; title: string; collection?: string; sha256?: string }>>([]);
  const [audits, setAudits] = useState<Array<{ index: number; action: string; role: string; entry_hash: string; timestamp: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    window.setTimeout(() => inputRef.current?.focus(), 40);

    const loadIndex = async () => {
      const headers = authHeaders();
      if (!isAuthenticated || !headers.Authorization) {
        setDocs([]);
        setAudits([]);
        return;
      }
      try {
        const docsRes = await fetch('/api/knowledge/documents', { headers });
        if (docsRes.ok) {
          const dJson = await docsRes.json();
          if (Array.isArray(dJson.documents)) {
            setDocs(dJson.documents.slice(0, 25));
          }
        }
      } catch {
        // ignore
      }

      if (isAuthenticated && (role === 'Developer' || role === 'Administrator')) {
        try {
          const audRes = await fetch('/api/audit', { headers: authHeaders() });
          if (audRes.ok) {
            const aJson = await audRes.json();
            if (Array.isArray(aJson.records)) {
              setAudits(aJson.records.slice(-20).reverse());
            }
          }
        } catch {
          // ignore
        }
      }
    };

    void loadIndex();
  }, [isOpen, isAuthenticated, role, authHeaders]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const q = query.trim().toLowerCase();

  const matchedModules = useMemo(() => {
    return MODULES.filter((m) => {
      if (m.minRole === 'Developer' && role === 'User') return false;
      if (m.minRole === 'Administrator' && role !== 'Administrator') return false;
      if (!q) return true;
      return `${m.title} ${m.keywords}`.toLowerCase().includes(q);
    }).slice(0, 6);
  }, [q, role]);

  const matchedBlockers = useMemo(() => {
    if (!q) return blockers.slice(0, 4);
    return blockers.filter((b) =>
      `${b.component} ${b.reason} ${b.requiredDependency}`.toLowerCase().includes(q)
    );
  }, [q, blockers]);

  const matchedDocs = useMemo(() => {
    if (!q) return docs.slice(0, 3);
    return docs.filter((d) => `${d.title} ${d.collection || ''}`.toLowerCase().includes(q)).slice(0, 5);
  }, [q, docs]);

  const matchedAudits = useMemo(() => {
    if (!q) return audits.slice(0, 3);
    return audits.filter((a) => `${a.action} ${a.role} ${a.entry_hash}`.toLowerCase().includes(q)).slice(0, 5);
  }, [q, audits]);

  const matchedLogs = useMemo(() => {
    if (!q) return [];
    return quickLogs
      .map((line, idx) => ({ line, idx }))
      .filter((entry) => entry.line.toLowerCase().includes(q))
      .slice(-5)
      .reverse();
  }, [q, quickLogs]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm flex items-start justify-center p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Global Search"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface)] shadow-2xl overflow-hidden flex flex-col max-h-[78vh]">
        <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--app-card-border)] bg-[var(--app-bg-secondary)]">
          <Search className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              lang === 'th'
                ? 'ค้นหาโมดูล, จุดติดขัด (NumPy/S3/41.5M), เอกสาร, Evidence Hash, หรือ Log...'
                : 'Search modules, blockers (NumPy/S3/41.5M), documents, audit hashes, or logs...'
            }
            className="flex-1 bg-transparent text-sm text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close global search"
            className="p-1.5 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
          {matchedModules.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] px-1">
                {lang === 'th' ? 'พื้นที่ควบคุมหลัก (Surfaces)' : 'Control Surfaces'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {matchedModules.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onNavigate(m.id);
                      onClose();
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-left cursor-pointer"
                  >
                    <span className="font-semibold text-[var(--app-text-primary)] truncate">{m.title}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedBlockers.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] px-1">
                {lang === 'th' ? 'จุดติดขัดที่ตรวจพบจริง (Active Blockers)' : 'Active Runtime Blockers'}
              </div>
              <div className="space-y-1.5">
                {matchedBlockers.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      if (onInspectEvidence) {
                        onInspectEvidence({
                          title: b.component,
                          subtitle: b.reason,
                          status: b.currentState,
                          source: 'TruthDashboard / ActiveBlockers',
                          details: [
                            { label: 'State', value: b.currentState },
                            { label: 'Required Dependency', value: b.requiredDependency },
                          ],
                          remediation: [b.requiredDependency],
                          targetModule: b.id.includes('cloud') || b.id.includes('bridge') ? 'infrastructure_cloud' : 'intelligence_core',
                          targetLabel: lang === 'th' ? 'เปิดหน้า Infrastructure' : 'Open Infrastructure',
                        });
                      }
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[var(--z-warn)] text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-[var(--app-text-primary)]">
                        <AlertTriangle className="w-3.5 h-3.5 text-[var(--z-warn)] shrink-0" />
                        <span className="truncate">{b.component}</span>
                      </div>
                      <div className="text-[11px] text-[var(--app-text-secondary)] truncate mt-0.5">{b.reason}</div>
                    </div>
                    <StatusDot status={b.currentState} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedDocs.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] px-1">
                {lang === 'th' ? 'คลังความรู้และเอกสาร (Knowledge Documents)' : 'Knowledge Documents'}
              </div>
              <div className="space-y-1.5">
                {matchedDocs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      onNavigate('knowledge_hub');
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2 text-[var(--app-text-primary)] truncate">
                      <BookOpen className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                      <span className="truncate">{d.title}</span>
                    </span>
                    <span className="font-mono text-[10px] text-[var(--app-text-secondary)] shrink-0">
                      {d.collection || 'workspace'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedAudits.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] px-1">
                {lang === 'th' ? 'บัญชีหลักฐาน SHA-256 (Evidence Ledger)' : 'Audit Ledger Records'}
              </div>
              <div className="space-y-1.5">
                {matchedAudits.map((a) => (
                  <button
                    key={a.index}
                    type="button"
                    onClick={() => {
                      if (onInspectEvidence) {
                        onInspectEvidence({
                          title: `Audit Record #${a.index}: ${a.action}`,
                          subtitle: `Actor role: ${a.role}`,
                          status: 'VERIFIED',
                          hash: a.entry_hash,
                          timestamp: a.timestamp,
                          source: 'AuditLedger SHA-256 Chain',
                          details: [
                            { label: 'Record Index', value: String(a.index) },
                            { label: 'Role', value: a.role },
                            { label: 'Action', value: a.action },
                          ],
                          targetModule: 'governance_security',
                          targetLabel: lang === 'th' ? 'เปิด Evidence Ledger' : 'Open Evidence Ledger',
                        });
                      }
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-left cursor-pointer font-mono"
                  >
                    <span className="flex items-center gap-2 text-[var(--app-text-primary)] truncate">
                      <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)] shrink-0" />
                      <span className="truncate">#{a.index} · {a.action}</span>
                    </span>
                    <span className="text-[10px] text-[var(--app-text-secondary)] shrink-0">
                      {a.entry_hash.slice(0, 12)}…
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedLogs.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] px-1">
                {lang === 'th' ? 'บันทึกการทำงานสด (Execution Trace)' : 'Execution Trace Logs'}
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                {matchedLogs.map((l) => (
                  <div key={l.idx} className="px-3 py-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] flex items-start gap-2">
                    <Terminal className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0 mt-0.5" />
                    <span className="text-[var(--app-text-primary)] break-all">{l.line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
