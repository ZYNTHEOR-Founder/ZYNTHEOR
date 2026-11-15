import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { Key, Copy, Check, Send } from 'lucide-react';
import { apiUrl } from '../../lib/apiClient';

export const ApiPlatform: React.FC = () => {
  const { authHeaders, session, role } = useAuth();
  const [activeTab, setActiveTab] = useState<'curl' | 'node' | 'python'>('node');
  const [copied, setCopied] = useState(false);
  const [testOutput, setTestOutput] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  const tokenPlaceholder = '<ACTIVE_ZY_TOKEN_FROM_/api/auth>';

  const copySnippetHeader = () => {
    navigator.clipboard.writeText(`Authorization: Bearer ${tokenPlaceholder}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const runQuickApiTest = async () => {
    setTesting(true);
    try {
      const res = await fetch(apiUrl('/api/system/status'), {
        headers: authHeaders(),
      });
      const data = await res.json();
      setTestOutput(data);
    } catch (err: any) {
      setTestOutput({ error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const codeSnippets = {
    curl: `curl -X POST https://your-domain/api/inference/generate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${tokenPlaceholder}" \\
  -d '{"prompt": "Analyze Thai & English semantic alignment with reasoning chain", "max_tokens": 128}'`,
    node: `// Authenticated ZYNTHEOR Native Runtime Request
const response = await fetch('https://your-domain/api/inference/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ${tokenPlaceholder}'
  },
  body: JSON.stringify({
    prompt: 'Synthesize verified neural reasoning plan',
    max_tokens: 128
  })
});

const result = await response.json();
console.log('Model Output:', result.text);
console.log('Reasoning Steps:', result.reasoning_chain);`,
    python: `import requests

url = "https://your-domain/api/inference/generate"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${tokenPlaceholder}"
}
payload = {
    "prompt": "Evaluate cognitive reasoning depth across Thai & English",
    "max_tokens": 128
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
print("Generated Tokens:", data.get("text"))`
  };

  return (
    <div className="space-y-8">
      {/* Credential Status Card (Honest Zero-Simulation) */}
      <VividCard
        title="Sovereign API Credentials & Authentication"
        subtitle="Backend endpoints verify server-signed ZY-TOKEN Bearer credentials; static tenant API key provisioning is not implemented"
        gradientAccent="cyan"
        headerAction={<StatusDot status="PARTIAL" label="ZY-TOKEN ONLY" detail="Static tenant API key provisioning is not implemented" />}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
            <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/12 border border-[#00F0FF]/35 text-[#00F0FF] flex items-center justify-center shrink-0">
              <Key className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] uppercase tracking-wider">
                Active Session Principal ({role})
              </div>
              <div className="font-mono text-xs font-semibold text-[var(--app-text-primary)] truncate">
                {session.userId} · Static API keys: NOT IMPLEMENTED (use signed ZY-TOKEN)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={copySnippetHeader}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold bg-[var(--app-card)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] rounded-xl hover:border-[#00F0FF] transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#CCFF00]" /> : <Copy className="w-3.5 h-3.5 text-[#00F0FF]" />}
            <span>{copied ? 'Header Copied' : 'Copy Auth Header'}</span>
          </button>
        </div>
      </VividCard>

      {/* Code Snippets & Interactive Tester */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VividCard
          title="SDK & Integration Snippets"
          subtitle="Integrate authenticated native inference calls into your services"
          gradientAccent="purple"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 border-b border-[var(--app-card-border)] pb-3">
              {(['node', 'python', 'curl'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold uppercase transition-colors cursor-pointer ${
                    activeTab === tab
                      ? 'bg-[#00F0FF]/18 text-[#00F0FF] border border-[#00F0FF]/45'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] border border-transparent hover:border-[var(--app-card-border)]'
                  }`}
                >
                  {tab === 'node' ? 'TypeScript / Node' : tab === 'python' ? 'Python SDK' : 'cURL'}
                </button>
              ))}
            </div>
            <div className="p-4 bg-[#070B19] border border-[#1E294A] rounded-xl text-[#F4F7FF] font-mono text-xs overflow-x-auto min-h-[220px]">
              <pre>{codeSnippets[activeTab]}</pre>
            </div>
          </div>
        </VividCard>

        {/* Live Test Response */}
        <VividCard
          title="Interactive API Endpoint Tester"
          subtitle="Direct live request to GET /api/system/status"
          gradientAccent="coral"
          headerAction={
            <button
              type="button"
              onClick={runQuickApiTest}
              disabled={testing}
              className="min-h-[40px] flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white vivid-gradient-brand rounded-xl cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testing ? 'Testing...' : 'Send Request'}</span>
            </button>
          }
        >
          <div className="p-4 bg-[#070B19] border border-[#1E294A] rounded-xl text-[#F4F7FF] font-mono text-xs overflow-x-auto min-h-[260px] max-h-[320px]">
            {testOutput ? (
              <pre className="text-[#CCFF00]">{JSON.stringify(testOutput, null, 2)}</pre>
            ) : (
              <span className="text-[#9AA8C7] italic">
                Click "Send Request" to inspect the live response from /api/system/status.
              </span>
            )}
          </div>
        </VividCard>
      </div>
    </div>
  );
};
