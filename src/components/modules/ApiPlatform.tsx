import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { useLanguage } from '../../context/LanguageContext';
import { Key, Copy, Check, Send } from 'lucide-react';

export const ApiPlatform: React.FC = () => {
  const { lang } = useLanguage();
  const th = lang === 'th';

  const [activeTab, setActiveTab] = useState<'curl' | 'node' | 'python'>('node');
  const [apiKey] = useState('zy_live_sovereign_7f88088ef2b13344_key');
  const [copied, setCopied] = useState(false);
  const [testOutput, setTestOutput] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const runQuickApiTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/system/status');
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
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"prompt": "Analyze Thai & English semantic alignment with reasoning chain", "max_tokens": 128}'`,
    node: `import fetch from 'node-fetch';

// Call Native Cloud Runtime with evidence-backed generation
const response = await fetch('https://your-domain/api/inference/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ${apiKey}'
  },
  body: JSON.stringify({
    prompt: 'Synthesize verified neural reasoning plan',
    max_tokens: 128
  })
});

const result = await response.json();
console.log('Model Output:', result.text);
console.log('Reasoning Steps:', result.reasoning_chain);
console.log('Latency:', result.latency_ms, 'ms');`,
    python: `import requests, json

url = "https://your-domain/api/inference/generate"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {apiKey}"
}
payload = {
    "prompt": "Evaluate cognitive reasoning depth across Thai & English",
    "max_tokens": 128
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
print("Generated Tokens:", data.get("text"))
print("Reasoning Chain:", data.get("reasoning_chain"))
print(f"Inference Latency: {data.get('latency_ms')}ms")`
  };

  return (
    <div className="space-y-6">
      <VividCard
        title={th ? 'ข้อมูลรับรองและจัดการ API Key' : 'API Credentials & Key Management'}
        subtitle={
          th
            ? 'คีย์รับรองสำหรับเรียกใช้ Native Inference และ Episodic Memory'
            : 'Cryptographically verified tenant keys for native intelligence inference and episodic memory'
        }
        gradientAccent="cyan"
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
          <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)] flex items-center justify-center shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <div className="truncate">
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)]">
                {th ? 'Production API Key' : 'Production API Key'}
              </div>
              <div className="font-mono text-xs font-medium text-[var(--app-text-primary)] truncate">{apiKey}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={copyKey}
            className="w-full sm:w-auto px-3.5 py-2 text-xs font-medium bg-[var(--app-surface)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] rounded-lg hover:border-[var(--app-accent)] transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--z-ok)]" /> : <Copy className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />}
            <span>{copied ? (th ? 'คัดลอกแล้ว' : 'Copied') : (th ? 'คัดลอกคีย์' : 'Copy Key')}</span>
          </button>
        </div>
      </VividCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VividCard
          title={th ? 'ตัวอย่างโค้ด SDK และการเชื่อมต่อ' : 'SDK & Integration Snippets'}
          subtitle={th ? 'เชื่อมเอเจนต์เข้ากับ CI/CD Pipeline โดยตรง' : 'Integrate agents directly into your CI/CD pipeline'}
        >
          <div className="space-y-3">
            <div className="flex gap-2 border-b border-[var(--app-card-border)] pb-2">
              {(['node', 'python', 'curl'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    activeTab === tab
                      ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  {tab === 'node' ? 'TypeScript / Node' : tab === 'python' ? 'Python SDK' : 'cURL'}
                </button>
              ))}
            </div>
            <div className="p-4 bg-[var(--app-bg)] border border-[var(--app-card-border)] rounded-xl text-[var(--app-text-primary)] font-mono text-xs overflow-x-auto min-h-[220px]">
              <pre>{codeSnippets[activeTab]}</pre>
            </div>
          </div>
        </VividCard>

        <VividCard
          title={th ? 'ทดสอบ Endpoint จริง' : 'Interactive API Endpoint Tester'}
          subtitle={th ? 'เรียกทดสอบ GET /api/system/status โดยตรง' : 'Direct call to GET /api/system/status'}
          headerAction={
            <button
              type="button"
              onClick={runQuickApiTest}
              disabled={testing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--app-accent-deep)] rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {testing ? (th ? 'กำลังทดสอบ...' : 'Testing...') : (th ? 'ส่งคำขอ' : 'Send Request')}
            </button>
          }
        >
          <div className="p-4 bg-[var(--app-bg)] border border-[var(--app-card-border)] rounded-xl text-[var(--app-text-primary)] font-mono text-xs overflow-x-auto min-h-[260px] max-h-[300px]">
            {testOutput ? (
              <pre className="text-[var(--z-ok)]">{JSON.stringify(testOutput, null, 2)}</pre>
            ) : (
              <span className="text-[var(--app-text-secondary)]">
                {th ? 'กด "ส่งคำขอ" เพื่อดูผลตอบกลับจริงจาก API' : 'Click "Send Request" to test endpoint response.'}
              </span>
            )}
          </div>
        </VividCard>
      </div>
    </div>
  );
};
