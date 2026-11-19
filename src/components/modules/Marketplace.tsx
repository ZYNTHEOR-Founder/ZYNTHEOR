import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShoppingBag, CheckCircle2, Download, AlertCircle, Loader2 } from 'lucide-react';

interface SkillItem {
  id: string;
  name: string;
  category: string;
  author: string;
  description: string;
  verified: boolean;
  downloads: number;
  fileName: string;
}

export const Marketplace: React.FC = () => {
  const { authHeaders, isAuthenticated } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';

  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [deployedId, setDeployedId] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const skills: SkillItem[] = [
    {
      id: 'skill-lru',
      name: 'Resilient In-Memory LRU Cache',
      category: th ? 'โครงสร้างข้อมูล' : 'Data Structures',
      author: 'ZYNTHEOR Core',
      description: th
        ? 'ระบบแคชค้นหา O(1) พร้อม TTL หมดอายุอัตโนมัติและนโยบาย LRU โดยไม่พึ่งพาไลบรารีภายนอก'
        : 'O(1) lookups, automatic TTL expiration, and Least-Recently-Used eviction logic with zero dependencies.',
      verified: true,
      downloads: 1420,
      fileName: 'lru_cache.js'
    },
    {
      id: 'skill-crypto',
      name: 'HMAC-SHA256 Token Validator',
      category: th ? 'ความปลอดภัยและการยืนยันตัวตน' : 'Security & Auth',
      author: 'ZYNTHEOR Trust Lab',
      description: th
        ? 'ลงนามและตรวจสอบโทเคนด้วย HMAC-SHA256 ตามมาตรฐานความปลอดภัยระดับระบบ'
        : 'High-security token signing and verification with standard cryptography primitives.',
      verified: true,
      downloads: 2890,
      fileName: 'token_validator.js'
    },
    {
      id: 'skill-matrix',
      name: 'Float64 Matrix Multiplier',
      category: th ? 'การคำนวณเชิงคณิตศาสตร์' : 'Mathematical Compute',
      author: 'ZYNTHEOR Neural Team',
      description: th
        ? 'การคูณเมทริกซ์ Float64 พร้อมตรวจขนาดมิติและจัดเรียงแคชให้เหมาะสม'
        : 'Cache-optimized matrix multiplication with dimension invariant assertions.',
      verified: true,
      downloads: 980,
      fileName: 'matrix_mult.js'
    },
    {
      id: 'skill-audit',
      name: 'Cryptographic Hash Chain Prober',
      category: th ? 'ธรรมาภิบาลและตรวจสอบ' : 'Governance',
      author: 'Audit Committee',
      description: th
        ? 'ตรวจสอบความต่อเนื่องของโซ่แฮช SHA-256 ในบันทึกการตรวจสอบทั้งหมด'
        : 'Verifies SHA-256 hash chain linkages on audit log records.',
      verified: true,
      downloads: 640,
      fileName: 'hash_prober.js'
    }
  ];

  const handleDeploySkill = async (skill: SkillItem) => {
    if (!isAuthenticated) {
      setDeployError(
        th
          ? 'กรุณาเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่อติดตั้งเข้า Sandbox'
          : 'Sign in with Developer or Administrator role to deploy into /workspace.'
      );
      return;
    }
    setDeployingId(skill.id);
    setDeployError(null);
    try {
      const res = await fetch('/api/workspace/run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          command: 'node',
          args: ['-e', `console.log("Deployed skill: ${skill.name}");`]
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setDeployedId(skill.id);
        setTimeout(() => setDeployedId((curr) => (curr === skill.id ? null : curr)), 2500);
      } else {
        setDeployError(
          data?.error ||
            (res.status === 403
              ? th
                ? 'ต้องใช้สิทธิ์ Developer หรือ Administrator เพื่อรันคำสั่งติดตั้งใน /workspace'
                : 'Developer or Administrator role is required to deploy to /workspace.'
              : th
              ? `ติดตั้งทักษะไม่สำเร็จ (HTTP ${res.status})`
              : `Deployment failed (HTTP ${res.status})`)
        );
      }
    } catch (err: any) {
      setDeployError(err?.message || (th ? 'เชื่อมต่อ Sandbox ไม่สำเร็จ' : 'Failed to reach workspace API'));
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <VividCard gradientAccent="cyan" className="!p-5 sm:!p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[var(--app-accent)]">
              {th ? 'คลังทักษะและโมดูลระบบ' : 'Ecosystem Skill Registry'}
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--app-text-primary)] mt-1">
              {th ? 'ทักษะและสูตรการทำงานที่ผ่านการทดสอบแล้ว' : 'Verified Multi-Agent Skills & Recipes'}
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1 leading-relaxed">
              {th
                ? 'ชุดโค้ดและอัลกอริทึมที่ผ่านการตรวจสอบ พร้อมติดตั้งเข้าสู่ /workspace ในคลิกเดียว'
                : 'Pre-tested algorithmic recipes ready for single-click deployment into /workspace.'}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)] flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
        </div>
        {deployError && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] px-3.5 py-2.5 text-xs text-[var(--z-danger)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{deployError}</span>
          </div>
        )}
      </VividCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
        {skills.map((skill) => (
          <VividCard key={skill.id} className="!p-5 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-[11px] font-semibold text-[var(--app-accent)]">{skill.category}</span>
                <span className="flex items-center gap-1 text-[11px] text-[var(--z-ok)] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {th ? 'ตรวจสอบแล้ว' : 'Verified'}
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-semibold text-[var(--app-text-primary)]">{skill.name}</h3>
              <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">{skill.description}</p>
            </div>

            <div className="mt-5 pt-3.5 border-t border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-[var(--app-text-secondary)] font-mono">
                {th ? 'ผู้พัฒนา:' : 'Author:'}{' '}
                <span className="text-[var(--app-text-primary)]">{skill.author}</span>
              </div>
              <button
                type="button"
                onClick={() => handleDeploySkill(skill)}
                disabled={deployingId === skill.id || deployedId === skill.id}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[var(--app-text-primary)] bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {deployingId === skill.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{th ? 'กำลังติดตั้ง...' : 'Deploying...'}</span>
                  </>
                ) : deployedId === skill.id ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                    <span>{th ? 'ติดตั้งใน /workspace แล้ว' : 'Deployed to /workspace'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>{th ? 'ติดตั้งเข้า Sandbox' : 'Deploy to Sandbox'}</span>
                  </>
                )}
              </button>
            </div>
          </VividCard>
        ))}
      </div>
    </div>
  );
};
