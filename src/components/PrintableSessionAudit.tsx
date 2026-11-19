import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthRole, AuthSession } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import type { ConnectivityHealthState, SystemStatusData } from '../types';

export interface PrintableAuditEntry {
  index: number | string;
  timestamp: string;
  role: string;
  action: string;
  detail?: string;
  hash?: string;
}

export interface PrintableSessionMetadata {
  reportTitle: string;
  reportSubtitle?: string;
  exportedAt: string;
  session: AuthSession;
  role: AuthRole;
  modelName?: string | null;
  modelLoaded?: boolean;
  checkpointHash?: string | null;
  connectivityStatus?: string | null;
  connectivityReason?: string | null;
  chainValid?: boolean | null;
  headHash?: string | null;
  totalLedgerRecords?: number | null;
  verificationSummary?: string | null;
  taskId?: string | null;
  goal?: string | null;
  priority?: string | null;
  executionLatencyMs?: number | null;
  activeFilterSummary?: string | null;
}

export interface PrintableAuditPayload {
  metadata: PrintableSessionMetadata;
  entries: PrintableAuditEntry[];
}

export function buildSystemMetadataSnapshot(params: {
  reportTitle: string;
  reportSubtitle?: string;
  session: AuthSession;
  role: AuthRole;
  statusData?: SystemStatusData | null;
  connectivity?: ConnectivityHealthState | null;
  chainValid?: boolean | null;
  headHash?: string | null;
  totalLedgerRecords?: number | null;
  verificationSummary?: string | null;
  taskId?: string | null;
  goal?: string | null;
  priority?: string | null;
  executionLatencyMs?: number | null;
  activeFilterSummary?: string | null;
}): PrintableSessionMetadata {
  const {
    reportTitle,
    reportSubtitle,
    session,
    role,
    statusData,
    connectivity,
    chainValid,
    headHash,
    totalLedgerRecords,
    verificationSummary,
    taskId,
    goal,
    priority,
    executionLatencyMs,
    activeFilterSummary,
  } = params;

  return {
    reportTitle,
    reportSubtitle,
    exportedAt: new Date().toISOString(),
    session,
    role,
    modelName: statusData?.model?.name ?? connectivity?.modelName ?? null,
    modelLoaded: statusData?.model?.weightsLoaded ?? connectivity?.weightsLoaded ?? false,
    checkpointHash: statusData?.model?.checkpointHash ?? connectivity?.checkpointSha256 ?? null,
    connectivityStatus:
      connectivity?.status ??
      statusData?.connectivity?.status ??
      (statusData?.model?.onlineConnectivityRequired ? 'FAIL_CLOSED' : null),
    connectivityReason:
      connectivity?.reason ??
      statusData?.connectivity?.reason ??
      statusData?.model?.failClosedReason ??
      null,
    chainValid: chainValid ?? statusData?.audit?.chainValid ?? null,
    headHash: headHash ?? statusData?.audit?.headHash ?? null,
    totalLedgerRecords: totalLedgerRecords ?? statusData?.audit?.totalRecords ?? null,
    verificationSummary: verificationSummary ?? null,
    taskId: taskId ?? null,
    goal: goal ?? null,
    priority: priority ?? null,
    executionLatencyMs: executionLatencyMs ?? null,
    activeFilterSummary: activeFilterSummary ?? null,
  };
}

export const PrintableSessionAudit: React.FC<{ payload: PrintableAuditPayload | null }> = ({ payload }) => {
  const { lang } = useLanguage();
  const th = lang === 'th';

  if (!payload || typeof document === 'undefined') return null;

  const { metadata, entries } = payload;

  return createPortal(
    <section
      id="printable-session-audit"
      aria-label={th ? 'เอกสารรายงานตรวจสอบเซสชันสำหรับพิมพ์' : 'Printable Session Audit Document'}
      className="print-only-audit"
    >
      <header className="print-header">
        <div>
          <div className="print-eyebrow">
            {th
              ? 'ZYNTHEOR · รายงานตรวจสอบทางวิศวกรรม AI'
              : 'ZYNTHEOR · SOVEREIGN AI ENGINEERING AUDIT REPORT'}
          </div>
          <h1 className="print-title">{metadata.reportTitle}</h1>
          {metadata.reportSubtitle && <p className="print-subtitle">{metadata.reportSubtitle}</p>}
        </div>
        <div className="print-header-right">
          <div>
            <strong>{th ? 'ส่งออก (UTC):' : 'Exported (UTC):'}</strong>{' '}
            <span className="print-mono">{metadata.exportedAt}</span>
          </div>
          <div>
            <strong>{th ? 'เวลาท้องถิ่น:' : 'Local Time:'}</strong>{' '}
            <span className="print-mono">{new Date(metadata.exportedAt).toLocaleString()}</span>
          </div>
          <div>
            <strong>{th ? 'จำนวนรายการ:' : 'Entries Included:'}</strong>{' '}
            <span className="print-mono">{entries.length}</span>
          </div>
        </div>
      </header>

      <div className="print-grid">
        <div className="print-card">
          <div className="print-card-title">
            {th ? 'ข้อมูลเซสชันและตัวตนผู้ใช้' : 'Session & Identity Metadata'}
          </div>
          <dl className="print-dl">
            <div>
              <dt>User ID</dt>
              <dd className="print-mono">{metadata.session.userId || 'anonymous'}</dd>
            </div>
            <div>
              <dt>{th ? 'อีเมล' : 'Email'}</dt>
              <dd className="print-mono">
                {metadata.session.email || (th ? 'ไม่ได้ระบุ (dev/local)' : 'Not provided (dev/local)')}
              </dd>
            </div>
            <div>
              <dt>Tenant ID</dt>
              <dd className="print-mono">
                {metadata.session.tenantId || (th ? 'ยังไม่ได้กำหนด' : 'Unassigned')}
              </dd>
            </div>
            <div>
              <dt>{th ? 'บทบาท / โหมดยืนยันตัวตน' : 'Role / Auth Mode'}</dt>
              <dd className="print-mono">
                {metadata.role} ({metadata.session.authMode || 'verified-token'})
              </dd>
            </div>
            <div>
              <dt>{th ? 'ยืนยันตัวตนเมื่อ' : 'Authenticated At'}</dt>
              <dd className="print-mono">
                {metadata.session.authenticatedAt || (th ? 'ไม่พร้อมใช้งาน' : 'Unavailable')}
              </dd>
            </div>
          </dl>
        </div>

        <div className="print-card">
          <div className="print-card-title">
            {th ? 'สถานะ Runtime, โมเดล และความสมบูรณ์' : 'Runtime, Model & Integrity State'}
          </div>
          <dl className="print-dl">
            <div>
              <dt>{th ? 'โมเดลที่ใช้งาน' : 'Active Model'}</dt>
              <dd className="print-mono">
                {metadata.modelName || (th ? 'ไม่พร้อมใช้งาน' : 'Unavailable')} (
                {metadata.modelLoaded ? 'WEIGHTS LOADED' : 'NOT LOADED'})
              </dd>
            </div>
            <div>
              <dt>{th ? 'การเชื่อมต่อ' : 'Connectivity'}</dt>
              <dd className="print-mono">{metadata.connectivityStatus || 'UNKNOWN'}</dd>
            </div>
            <div>
              <dt>Checkpoint SHA-256</dt>
              <dd className="print-mono print-break">
                {metadata.checkpointHash || (th ? 'ไม่พร้อมใช้งาน' : 'Unavailable')}
              </dd>
            </div>
            <div>
              <dt>{th ? 'ตราประทับห่วงโซ่ตรวจสอบ' : 'Audit Chain Seal'}</dt>
              <dd className="print-mono">
                {metadata.chainValid === null || metadata.chainValid === undefined
                  ? 'UNVERIFIED'
                  : metadata.chainValid
                  ? 'VALID / INTACT'
                  : 'TAMPER / BROKEN'}
                {metadata.totalLedgerRecords != null ? ` (${metadata.totalLedgerRecords} blocks)` : ''}
              </dd>
            </div>
            <div>
              <dt>{th ? 'แฮชส่วนหัวสมุดบัญชี (Head Hash)' : 'Ledger Head Hash'}</dt>
              <dd className="print-mono print-break">
                {metadata.headHash || (th ? 'ไม่พร้อมใช้งาน' : 'Unavailable')}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {(metadata.goal || metadata.verificationSummary || metadata.connectivityReason || metadata.activeFilterSummary) && (
        <div className="print-card print-meta-strip">
          {metadata.goal && (
            <div>
              <strong>{th ? 'เป้าหมายงาน:' : 'Task Objective:'}</strong> {metadata.goal}
              {metadata.taskId ? ` (${metadata.taskId})` : ''}
              {metadata.priority ? ` · ${th ? 'ระดับความสำคัญ' : 'Priority'}: ${metadata.priority}` : ''}
              {metadata.executionLatencyMs != null ? ` · ${th ? 'ระยะเวลา' : 'Duration'}: ${metadata.executionLatencyMs} ms` : ''}
            </div>
          )}
          {metadata.verificationSummary && (
            <div>
              <strong>{th ? 'การตรวจสอบความสมบูรณ์:' : 'Integrity Verification:'}</strong>{' '}
              <span className="print-mono">{metadata.verificationSummary}</span>
            </div>
          )}
          {metadata.activeFilterSummary && (
            <div>
              <strong>{th ? 'ขอบเขต / ตัวกรองที่ใช้:' : 'Applied Scope / Filters:'}</strong>{' '}
              <span className="print-mono">{metadata.activeFilterSummary}</span>
            </div>
          )}
          {metadata.connectivityReason && (
            <div>
              <strong>{th ? 'คำอธิบายการเชื่อมต่อ:' : 'Connectivity Disclosure:'}</strong>{' '}
              {metadata.connectivityReason}
            </div>
          )}
        </div>
      )}

      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '56px' }}>#</th>
            <th style={{ width: '132px' }}>{th ? 'เวลา (Timestamp)' : 'Timestamp'}</th>
            <th style={{ width: '92px' }}>{th ? 'บทบาท / แท็ก' : 'Role / Tag'}</th>
            <th style={{ width: '160px' }}>{th ? 'การดำเนินการ / เหตุการณ์' : 'Action / Event'}</th>
            <th>{th ? 'รายละเอียด / ข้อมูล' : 'Detail / Payload'}</th>
            <th style={{ width: '128px' }}>SHA-256 Digest</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: '14px' }}>
                {th
                  ? 'ไม่พบรายการบันทึกเซสชันที่ตรงกับขอบเขตที่ส่งออก'
                  : 'No session log entries matched the export scope.'}
              </td>
            </tr>
          ) : (
            entries.map((entry, idx) => (
              <tr key={`${entry.index}-${idx}`}>
                <td className="print-mono">{entry.index}</td>
                <td className="print-mono">{entry.timestamp}</td>
                <td className="print-mono print-bold">{entry.role}</td>
                <td className="print-bold">{entry.action}</td>
                <td className="print-detail">{entry.detail || '—'}</td>
                <td className="print-mono print-break">{entry.hash ? `${entry.hash.slice(0, 18)}…` : '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <footer className="print-footer">
        <span>
          {th
            ? 'สร้างภายในเครื่องผ่านระบบส่งออกรายงานตรวจสอบ ZYNTHEOR · นโยบาย Zero Simulation'
            : 'Generated locally via ZYNTHEOR High-Contrast Audit Exporter · Zero Simulation Policy'}
        </span>
        <span className="print-mono">
          {th ? 'สแนปช็อตตรวจสอบ' : 'Page audit snapshot'} · {metadata.exportedAt}
        </span>
      </footer>
    </section>,
    document.body
  );
};

export function usePrintAudit() {
  const [printPayload, setPrintPayload] = useState<PrintableAuditPayload | null>(null);

  useEffect(() => {
    if (!printPayload) return;

    let cleaned = false;
    const cleanup = () => {
      if (!cleaned) {
        cleaned = true;
        setPrintPayload(null);
      }
    };

    const handleAfterPrint = () => cleanup();
    window.addEventListener('afterprint', handleAfterPrint);

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.print();
      });
    });

    // Fallback cleanup if browser blocks/cancels print silently without firing afterprint
    const fallbackTimer = setTimeout(cleanup, 60000);

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      clearTimeout(fallbackTimer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printPayload]);

  const triggerPrintAudit = useCallback((payload: PrintableAuditPayload) => {
    setPrintPayload(payload);
  }, []);

  return { printPayload, triggerPrintAudit };
}
