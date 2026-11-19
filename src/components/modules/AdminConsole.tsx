import React, { useState, useEffect, useCallback } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge } from '../ui/StatusBadge';
import { VerificationSuiteData } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { Play, ShieldCheck, AlertCircle } from 'lucide-react';

export const AdminConsole: React.FC = () => {
  const { lang } = useLanguage();
  const { authHeaders, isAuthenticated, role } = useAuth();
  const th = lang === 'th';

  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [suiteData, setSuiteData] = useState<VerificationSuiteData | null>(null);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [healthHistory, setHealthHistory] = useState<Array<{ time: string; cpu: number; ram: number; vram: number }>>([]);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  // does not display fabricated sessions or simulate token revocation; no session API exists yet.
  const [sessions] = useState<Array<{ id: string; actor: string; ip: string; status: string }>>([]);

  const mapResourcePoint = (sample: any) => ({
    time: sample?.timeLabel || new Date().toTimeString().slice(0, 8),
    cpu: sample?.cpuPercent ?? 0,
    ram: Math.round((sample?.processRssMb ?? 0) / 10),
    vram: Math.round((sample?.vramMb ?? 0) / 10),
  });

  const loadAdminData = useCallback(async () => {
    try {
      const statusResponse = await fetch('/api/system/status');
      if (statusResponse.ok) {
        const statusRes = await statusResponse.json();
        if (statusRes.success && statusRes.resources) {
          const resObj = statusRes.resources;
          if (Array.isArray(resObj.history) && resObj.history.length > 0) {
            setHealthHistory(resObj.history.slice(-15).map(mapResourcePoint));
          } else {
            const current = resObj.current ?? resObj;
            setHealthHistory((prev) => [...prev.slice(-14), mapResourcePoint(current)]);
          }
        }
      }

      if (isAuthenticated && (role === 'Developer' || role === 'Administrator')) {
        const auditResponse = await fetch('/api/audit?limit=20', { headers: authHeaders() });
        const auditRes = await auditResponse.json().catch(() => ({}));
        if (auditResponse.ok && auditRes.success && Array.isArray(auditRes.records)) {
          setAuditEntries(auditRes.records);
          setAuditError(null);
        } else if (!auditResponse.ok) {
          setAuditError(
            auditRes?.error ||
              (th ? 'ไม่สามารถโหลด Audit Log ได้' : `Unable to load audit log (HTTP ${auditResponse.status})`)
          );
        }
      } else {
        setAuditEntries([]);
        setAuditError(null);
      }
    } catch {
      // ignore transient error
    }
  }, [authHeaders, isAuthenticated, role, th]);

  useEffect(() => {
    void loadAdminData();
    const interval = setInterval(() => void loadAdminData(), 5000);
    return () => clearInterval(interval);
  }, [loadAdminData]);

  const handleRunVerificationSuite = async () => {
    if (!isAuthenticated) {
      setSuiteError(
        th
          ? 'กรุณาเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator ก่อนรันชุดตรวจสอบ'
          : 'Sign in with Developer or Administrator role before running the verification suite.'
      );
      return;
    }
    setIsRunningSuite(true);
    setSuiteError(null);
    try {
      const res = await fetch('/api/verify/suite', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSuiteData(data.suite);
      } else {
        setSuiteError(
          data?.error ||
            (res.status === 403
              ? th
                ? 'ต้องใช้สิทธิ์ Developer หรือ Administrator เพื่อรันชุดตรวจสอบระบบ'
                : 'Developer or Administrator role is required to execute the verification suite.'
              : th
              ? `การตรวจสอบล้มเหลว (HTTP ${res.status})`
              : `Verification suite failed (HTTP ${res.status})`)
        );
      }
    } catch (err: any) {
      setSuiteError(err?.message || (th ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ' : 'Failed to connect to server'));
    } finally {
      setIsRunningSuite(false);
    }
  };

  return (
    <div className="space-y-6">
      <VividCard
        gradientAccent="cyan"
        className="!p-5 sm:!p-6"
        headerAction={
          <button
            type="button"
            onClick={handleRunVerificationSuite}
            disabled={isRunningSuite}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[var(--app-accent-deep)] rounded-lg hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {isRunningSuite
              ? th
                ? 'กำลังรันชุดตรวจสอบ 8 รายการ...'
                : 'Running 8 Real Proofs...'
              : th
              ? 'รันชุดตรวจสอบความถูกต้องระบบ'
              : 'Execute Full Verification Suite'}
          </button>
        }
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold text-[var(--app-accent)]">
              {th ? 'ระบบตรวจยืนยันเชิงประจักษ์' : 'Empirical Proof Engine'}
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--app-text-primary)] mt-1">
              {th ? 'มาตรฐานการตรวจสอบจากการทำงานจริง' : 'Real-World Execution Verification Standard'}
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1 leading-relaxed">
              {th
                ? 'ทดสอบการทำงานจริงกับ Python Bridge, ไฟล์ Checkpoint และ ToolGateway Sandbox พร้อมบันทึกหลักฐานที่ตรวจสอบได้'
                : 'Executes real checks against runtime bridges, checkpoints, and sandbox boundaries with verifiable evidence.'}
            </p>
          </div>

          <div className="flex items-center gap-3 p-3 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl shrink-0">
            <ShieldCheck className="w-5 h-5 text-[var(--z-ok)] shrink-0" />
            <div>
              <div className="text-xs font-semibold text-[var(--app-text-primary)]">
                {suiteData
                  ? th
                    ? `ผ่าน ${suiteData.passed_tests} / ${suiteData.total_tests} รายการ`
                    : `${suiteData.passed_tests} / ${suiteData.total_tests} Tests Passed`
                  : th
                  ? 'ยังไม่มีประวัติการตรวจรอบล่าสุด'
                  : 'No verification run recorded'}
              </div>
              <div className="text-[10px] text-[var(--z-ok)] font-mono font-bold">
                {suiteData?.verified ? 'EVIDENCE VERIFIED' : 'UNVERIFIED · AWAITING TEST RUN'}
              </div>
            </div>
          </div>
        </div>
        {suiteError && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] px-3.5 py-2.5 text-xs text-[var(--z-danger)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{suiteError}</span>
          </div>
        )}
      </VividCard>

      <VividCard
        title={th ? 'ตารางยืนยันหลักฐานการทำงานของระบบ' : 'System Proof Verification Matrix'}
        subtitle={
          th
            ? 'ตรวจสอบการเชื่อมต่อ Python Bridge, ไฟล์ Checkpoint และ ToolGateway Sandbox แบบเรียลไทม์'
            : 'Live assertions against local Python bridge, weights checkpoint, and ToolGateway sandbox'
        }
        gradientAccent="emerald"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold">
                <th className="pb-3 pl-1">{th ? 'รายการตรวจ / มาตรฐาน' : 'Requirement / Standard'}</th>
                <th className="pb-3">{th ? 'เป้าหมาย' : 'Proof Target'}</th>
                <th className="pb-3">{th ? 'สถานะ' : 'Status'}</th>
                <th className="pb-3">{th ? 'หลักฐาน / ค่าที่วัดได้' : 'Runtime Evidence / Metric'}</th>
                <th className="pb-3 text-right pr-1">{th ? 'เวลาตอบสนอง' : 'Latency'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)] font-sans">
              {(suiteData?.results || []).map((t: any) => (
                <tr key={t.test_id} className="hover:bg-[var(--app-surface-elevated)] transition-colors">
                  <td className="py-3 pl-1 font-semibold text-[var(--app-text-primary)]">
                    <div>{t.name}</div>
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{t.test_id}</div>
                  </td>
                  <td className="py-3 text-[var(--app-text-primary)] font-mono text-[11px]">
                    {t.test_id.includes('WEIGHTS')
                      ? 'model_checkpoint.pt'
                      : t.test_id.includes('TOKEN')
                      ? 'tokenizer.py'
                      : t.test_id.includes('MEMORY')
                      ? 'memory_store.json'
                      : 'Python Bridge'}
                  </td>
                  <td className="py-3">
                    <StatusBadge status={t.status === 'PASS' ? 'VERIFIED' : 'BLOCKED'} />
                  </td>
                  <td className="py-3 text-[var(--app-text-primary)] text-[11px] font-mono max-w-md truncate">
                    {t.evidence}
                  </td>
                  <td className="py-3 text-right pr-1 font-mono text-[var(--app-text-secondary)]">
                    {t.duration_ms}ms
                  </td>
                </tr>
              ))}
              {!suiteData?.results?.length && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-[var(--app-text-secondary)]">
                    {th
                      ? 'ยังไม่มีหลักฐานการตรวจสอบ กด "รันชุดตรวจสอบความถูกต้องระบบ" เพื่อดูผลลัพธ์จริง'
                      : 'No verification evidence is available yet. Run the verification suite to populate this table.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </VividCard>

      <VividCard
        title={th ? 'สุขภาพระบบ (CPU / RAM / VRAM)' : 'System Health (CPU / RAM / VRAM)'}
        subtitle={
          th
            ? 'ข้อมูล Telemetry จริงแบบเรียลไทม์จาก /api/system/status'
            : 'Real-time infrastructure telemetry from /api/system/status'
        }
        gradientAccent="emerald"
      >
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={healthHistory}>
              <XAxis dataKey="time" stroke="#A7BDB2" fontSize={10} />
              <YAxis stroke="#A7BDB2" fontSize={10} />
              <Tooltip />
              <Area type="monotone" dataKey="cpu" stroke="var(--app-accent)" fill="var(--app-accent)" fillOpacity={0.2} name="CPU %" />
              <Area type="monotone" dataKey="ram" stroke="var(--app-amber)" fill="var(--app-amber)" fillOpacity={0.15} name="RSS (×10MB)" />
              <Area type="monotone" dataKey="vram" stroke="var(--app-accent)" fill="var(--app-accent)" fillOpacity={0.15} name="Heap (×10MB)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </VividCard>

      <VividCard
        title={th ? 'เซสชันผู้ใช้ที่กำลังทำงาน' : 'Active User Sessions'}
        subtitle={
          th
            ? 'จัดการโทเคนเซสชันและบันทึกเหตุการณ์ลง AuditLedger'
            : 'Invalidate active session tokens and log to AuditLedger'
        }
        gradientAccent="amber"
      >
        <div className="space-y-2 text-xs font-mono">
          {sessions.length === 0 ? (
            <div className="py-5 text-center text-[var(--app-text-secondary)]">
              {th
                ? 'ยังไม่มีข้อมูลรายการจัดการเซสชันที่เปิดใช้งานจากฝั่ง Server'
                : 'No session-management records are available from the server.'}
            </div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                <span className="text-[var(--app-text-primary)] font-bold">{s.id}</span>{' '}
                <span className="text-[var(--app-text-secondary)]">
                  ({s.actor} · {s.ip} · {s.status})
                </span>
              </div>
            ))
          )}
        </div>
      </VividCard>

      <VividCard
        title={th ? 'บันทึกการตรวจสอบสำหรับผู้ดูแล (Audit Log)' : 'Admin Audit Log'}
        subtitle={th ? 'กิจกรรมสำคัญล่าสุดจาก AuditLedger' : 'Recent critical actions sourced from AuditLedger'}
        gradientAccent="emerald"
      >
        <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono text-[11px]">
          {auditError ? (
            <div className="text-[var(--z-danger)]">{auditError}</div>
          ) : !isAuthenticated || (role !== 'Developer' && role !== 'Administrator') ? (
            <div className="text-[var(--app-text-secondary)]">
              {th
                ? 'เข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่อดูบันทึกการตรวจสอบ (AuditLedger)'
                : 'Sign in with Developer or Administrator role to view AuditLedger records.'}
            </div>
          ) : auditEntries.length === 0 ? (
            <div className="text-[var(--app-text-secondary)]">
              {th ? 'ยังไม่มีรายการบันทึกการตรวจสอบ' : 'No audit entries loaded.'}
            </div>
          ) : (
            auditEntries.map((entry, idx) => (
              <div
                key={entry.id ?? entry.index ?? idx}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]"
              >
                <span className="text-[var(--app-accent)] font-semibold truncate">
                  [{entry.role || entry.actor || 'SYSTEM'}] {entry.action}
                </span>
                <span className="text-[var(--app-text-secondary)] shrink-0">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                </span>
              </div>
            ))
          )}
        </div>
      </VividCard>
    </div>
  );
};
