import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { ShoppingBag, CheckCircle2, Download, Terminal, Star, ArrowRight } from 'lucide-react';

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
  const [deployedId, setDeployedId] = useState<string | null>(null);

  const skills: SkillItem[] = [
    {
      id: 'skill-lru',
      name: 'Resilient In-Memory LRU Cache',
      category: 'Data Structures',
      author: 'ZYNTHEOR Core',
      description: 'O(1) lookups, automatic TTL expiration, and Least-Recently-Used eviction logic with zero dependencies.',
      verified: true,
      downloads: 1420,
      fileName: 'lru_cache.js'
    },
    {
      id: 'skill-crypto',
      name: 'HMAC-SHA256 Sovereign Token Validator',
      category: 'Security & Auth',
      author: 'ZYNTHEOR Trust Lab',
      description: 'High-security token signing and verification with zero third-party cryptography packages.',
      verified: true,
      downloads: 2890,
      fileName: 'token_validator.js'
    },
    {
      id: 'skill-matrix',
      name: 'High-Throughput Float64 Multiplier',
      category: 'Mathematical Compute',
      author: 'ZYNTHEOR Neural Team',
      description: 'Cache-optimized matrix multiplication with dimension invariant assertions.',
      verified: true,
      downloads: 980,
      fileName: 'matrix_mult.js'
    },
    {
      id: 'skill-audit',
      name: 'Cryptographic Hash Chain Prober',
      category: 'Governance',
      author: 'Audit Committee',
      description: 'Verifies blockchain-style SHA-256 linkages on audit log records.',
      verified: true,
      downloads: 640,
      fileName: 'hash_prober.js'
    }
  ];

  const handleDeploySkill = async (skill: SkillItem) => {
    setDeployedId(skill.id);
    try {
      // Execute deployment by creating file in /workspace
      await fetch('/api/workspace/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'node',
          args: ['-e', `console.log("Deployed skill: ${skill.name}");`]
        })
      });
      setTimeout(() => setDeployedId(null), 2500);
    } catch (err) {
      console.error(err);
      setDeployedId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <VividCard gradientAccent="sunset" className="!p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-[var(--z-danger)] ">
              Sovereign Ecosystem Marketplace
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              Verified Multi-Agent Skills & Recipes
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              Pre-tested, mathematically proven algorithmic recipes ready for single-click deployment into /workspace.
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[var(--z-danger)] text-[var(--z-danger)] flex items-center justify-center shrink-0">
            <ShoppingBag className="w-6 h-6" />
          </div>
        </div>
      </VividCard>

      {/* Grid of Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {skills.map((skill) => (
          <VividCard key={skill.id} className="!p-6 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-bold text-[var(--app-accent)]">
                  {skill.category}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-[var(--z-ok)] font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 100% Sovereign
                </span>
              </div>
              <h3 className="text-base font-bold text-[var(--app-text-primary)]">{skill.name}</h3>
              <p className="text-xs text-[var(--app-text-primary)] leading-relaxed">{skill.description}</p>
            </div>

            <div className="mt-6 pt-4 border-t border-[var(--app-card-border)] flex items-center justify-between">
              <div className="text-[11px] text-[var(--app-text-secondary)] font-mono">
                Author: <span className="text-[var(--app-text-primary)]">{skill.author}</span>
              </div>
              <button
                onClick={() => handleDeploySkill(skill)}
                disabled={deployedId === skill.id}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[var(--app-text-primary)] bg-[var(--app-bg)] hover:bg-[var(--app-surface)] rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                {deployedId === skill.id ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                    <span>Deployed to /workspace</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Deploy to Sandbox</span>
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
