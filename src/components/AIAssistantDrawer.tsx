import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  X,
  Send,
  Trash2,
  Copy,
  Check,
  Terminal,
  Loader2,
  AlertCircle,
  Bot,
  User,
  Globe,
  Brain,
  Paperclip,
  Wrench,
  ExternalLink,
  ArrowRight,
  Volume2,
  VolumeX,
  FileCode,
  Image as ImageIcon,
} from 'lucide-react';
import { ModuleId } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from './ui/ConfirmDialog';

export type ThinkingMode = 'fast' | 'balanced' | 'deep';

export interface AssistantAttachmentPayload {
  name: string;
  mimeType: string;
  dataBase64?: string;
  textContent?: string;
  sizeBytes?: number;
}

export interface AssistantToolLog {
  name: string;
  ok?: boolean;
  summary?: string;
}

export interface AssistantSourceLink {
  title: string;
  url: string;
}

export interface AssistantActionSuggestion {
  actionType: 'navigate_module' | 'prepare_quick_task';
  label: string;
  moduleId?: string;
  taskGoal?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  error?: boolean;
  attachmentNames?: string[];
  toolsUsed?: AssistantToolLog[];
  sources?: AssistantSourceLink[];
  actions?: AssistantActionSuggestion[];
}

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeModule: ModuleId;
  runtimeReady: boolean;
  recentLogs: string[];
  moduleState?: Record<string, unknown>;
  workspaceMetadata?: Record<string, unknown>;
  onRefreshContext?: () => void;
  onApplyToQuickTask?: (goalText: string) => void;
  onNavigateModule?: (moduleId: ModuleId) => void;
}

const SESSION_ID_STORAGE_KEY = 'zyntheor_ai_assistant_session_id';
const SESSION_MEMORY_PREFIX = 'zyntheor_ai_assistant_stm_';
const MAX_SHORT_TERM_EXCHANGES = 12;
const MAX_SHORT_TERM_MESSAGES = MAX_SHORT_TERM_EXCHANGES * 2;

function getOrCreateTabSessionId(): string {
  if (typeof window === 'undefined') return 'default-session';
  try {
    const existing = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,80}$/.test(existing)) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
        : `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `sess_${Date.now().toString(36)}`;
  }
}

const VALID_MODULE_IDS = new Set<ModuleId>([
  'command_center',
  'conversational_intelligence',
  'intelligence_core',
  'dev_studio',
  'research_lab',
  'automation_center',
  'knowledge_hub',
  'model_laboratory',
  'experiment_center',
  'api_platform',
  'marketplace',
  'subscription_billing',
  'analytics_bi',
  'governance_security',
  'user_settings',
  'admin_console',
]);

const TEXT_FILE_EXTENSIONS = /\.(txt|md|markdown|ts|tsx|js|jsx|mjs|cjs|py|json|csv|log|yml|yaml|sql|html|css|sh|env)$/i;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function formatToolDisplayName(name: string, lang: 'th' | 'en'): string {
  if (lang === 'th') {
    switch (name) {
      case 'get_system_telemetry':
        return 'ตรวจ Telemetry ระบบ';
      case 'search_knowledge_hub':
        return 'ค้น Knowledge Hub';
      case 'inspect_workspace_files':
        return 'ตรวจไฟล์ /workspace';
      case 'inspect_audit_ledger':
        return 'ตรวจ Audit Ledger';
      case 'propose_ui_action':
        return 'เตรียมคำสั่งลัด UI';
      case 'recall_or_store_assistant_memory':
        return 'ความจำถาวร (Brain Memory)';
      case 'run_adaptive_reasoning':
        return 'แกนวิเคราะห์เหตุผล (Reasoning)';
      case 'decompose_execution_plan':
        return 'วางแผน DAG (Planner)';
      default:
        return name;
    }
  }
  switch (name) {
    case 'get_system_telemetry':
      return 'System Telemetry';
    case 'search_knowledge_hub':
      return 'Knowledge Hub';
    case 'inspect_workspace_files':
      return 'Workspace Sandbox';
    case 'inspect_audit_ledger':
      return 'Audit Ledger';
    case 'propose_ui_action':
      return 'UI Action';
    case 'recall_or_store_assistant_memory':
      return 'Brain Memory';
    case 'run_adaptive_reasoning':
      return 'Adaptive Reasoning';
    case 'decompose_execution_plan':
      return 'DAG Planner';
    default:
      return name;
  }
}

export const AIAssistantDrawer: React.FC<AIAssistantDrawerProps> = ({
  isOpen,
  onClose,
  activeModule,
  runtimeReady,
  recentLogs,
  moduleState,
  workspaceMetadata,
  onRefreshContext,
  onApplyToQuickTask,
  onNavigateModule,
}) => {
  const { lang } = useLanguage();
  const { authHeaders, role } = useAuth();
  const [sessionId, setSessionId] = useState<string>(() => getOrCreateTabSessionId());
  const [messages, setMessages] = useState<AssistantMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const sid = getOrCreateTabSessionId();
      const saved = sessionStorage.getItem(`${SESSION_MEMORY_PREFIX}${sid}`);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.slice(-MAX_SHORT_TERM_MESSAGES) : [];
    } catch {
      return [];
    }
  });
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(() => {
    if (typeof window === 'undefined') return 'balanced';
    const saved = localStorage.getItem('zyntheor_ai_assistant_thinking');
    return saved === 'fast' || saved === 'deep' ? saved : 'balanced';
  });
  const [webGrounding, setWebGrounding] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('zyntheor_ai_assistant_web') === 'true';
  });
  const [attachments, setAttachments] = useState<AssistantAttachmentPayload[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isClearSessionConfirmOpen, setIsClearSessionConfirmOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [liveTools, setLiveTools] = useState<AssistantToolLog[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [assistantOnline, setAssistantOnline] = useState<boolean>(true);
  const [serverExchangeCount, setServerExchangeCount] = useState<number>(0);
  const [brainCoreMeta, setBrainCoreMeta] = useState<{
    architecture?: string;
    totalCycles?: number;
    episodicCount?: number;
    intent?: string;
    strategy?: string;
    recalledCount?: number;
    conflictCount?: number;
    entities?: string[];
  } | null>(null);
  const [showBrainDetails, setShowBrainDetails] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevIsOpenRef = useRef<boolean>(false);

  // Persist rolling single-session short-term memory buffer in sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `${SESSION_MEMORY_PREFIX}${sessionId}`,
        JSON.stringify(messages.slice(-MAX_SHORT_TERM_MESSAGES))
      );
    } catch {
      // ignore storage quota errors
    }
  }, [messages, sessionId]);

  useEffect(() => {
    try {
      localStorage.setItem('zyntheor_ai_assistant_thinking', thinkingMode);
    } catch {
      // ignore
    }
  }, [thinkingMode]);

  useEffect(() => {
    try {
      localStorage.setItem('zyntheor_ai_assistant_web', String(webGrounding));
    } catch {
      // ignore
    }
  }, [webGrounding]);

  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (justOpened) {
      onRefreshContext?.();
    }

    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
    }
  }, [isOpen, onRefreshContext]);

  // Sync selected module state & active workspace metadata to assistant session context when opened or updated
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const syncContext = async () => {
      try {
        const [ctxRes, statusRes] = await Promise.all([
          fetch('/api/assistant/context', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              sessionId,
              moduleState,
              workspaceMetadata,
              context: {
                activeModule,
                lang,
                role,
                runtimeReady,
                recentLogs: recentLogs.slice(-12),
              },
            }),
          }),
          fetch('/api/assistant/status'),
        ]);
        if (cancelled) return;
        if (ctxRes.ok) {
          const data = await ctxRes.json().catch(() => null);
          if (data?.session && typeof data.session.exchangeCount === 'number') {
            setServerExchangeCount(data.session.exchangeCount);
          }
        }
        if (statusRes.ok) {
          const st = await statusRes.json().catch(() => null);
          setAssistantOnline(Boolean(st?.available));
          if (st?.brainCore) {
            setBrainCoreMeta((prev) => ({
              ...prev,
              architecture: st.brainCore.architecture,
              totalCycles: st.brainCore.metrics?.totalCycles,
              episodicCount: st.brainCore.memoryStore?.totalEpisodicItems,
              intent: st.brainCore.lastPacket?.intent ?? prev?.intent,
              strategy: st.brainCore.lastPacket?.strategy ?? prev?.strategy,
              recalledCount: st.brainCore.lastPacket?.recalledMemories?.length ?? prev?.recalledCount,
              conflictCount: st.brainCore.lastPacket?.conflictCount ?? prev?.conflictCount,
              entities: st.brainCore.lastPacket?.entities ?? prev?.entities,
            }));
          }
        }
      } catch {
        // best-effort live context sync
      }
    };

    void syncContext();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId, activeModule, moduleState, workspaceMetadata, lang, role, runtimeReady, recentLogs, authHeaders]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, liveTools, isOpen]);

  if (!isOpen) return null;

  const starterPrompts =
    lang === 'th'
      ? [
          {
            label: 'ตรวจสถานะระบบจริง, Metrics และ Blockers',
            prompt:
              'ช่วยตรวจสอบสถานะระบบ ZYNTHEOR ล่าสุดจาก Telemetry จริง พร้อมสรุป Metrics สำคัญ และ Blockers ที่ต้องดูแล',
          },
          {
            label: 'ตรวจไฟล์ใน /workspace และ Audit Ledger',
            prompt:
              'ช่วยตรวจสอบรายชื่อไฟล์ใน /workspace sandbox และตรวจความถูกต้องของ Audit Ledger ล่าสุดให้หน่อย',
          },
          ...(recentLogs.length > 0
            ? [
                {
                  label: 'วิเคราะห์ Log ล่าสุดใน Terminal',
                  prompt:
                    'ช่วยสรุปและวิเคราะห์บันทึกการทำงานล่าสุดใน Execution Trace Terminal พร้อมแนะนำขั้นตอนถัดไป',
                },
              ]
            : []),
          {
            label: 'ค้นหา Knowledge Hub และร่าง Task ให้ Agent',
            prompt:
              'ช่วยค้นหาเอกสารที่เกี่ยวข้องใน Knowledge Hub แล้วเตรียม Task Specification สำหรับส่งให้ Quick Task Engine',
          },
        ]
      : [
          {
            label: 'Inspect live system telemetry & blockers',
            prompt:
              'Inspect live ZYNTHEOR telemetry, runtime metrics, and active blockers, then summarize what needs attention.',
          },
          {
            label: 'Inspect /workspace & Audit Ledger',
            prompt:
              'List files in the /workspace sandbox and verify the latest SHA-256 Audit Ledger integrity.',
          },
          ...(recentLogs.length > 0
            ? [
                {
                  label: 'Analyze recent terminal logs',
                  prompt:
                    'Summarize the recent execution terminal logs and highlight any issues or next steps.',
                },
              ]
            : []),
          {
            label: 'Search Knowledge Hub & draft task',
            prompt:
              'Search our Knowledge Hub documents and prepare an actionable task specification for Quick Task.',
          },
        ];

  const handleFilesSelected = async (files: FileList | File[]) => {
    setAttachError(null);
    const list = Array.from(files).slice(0, Math.max(0, 4 - attachments.length));
    if (list.length === 0) return;

    const added: AssistantAttachmentPayload[] = [];
    for (const file of list) {
      if (file.size > 4 * 1024 * 1024) {
        setAttachError(
          lang === 'th'
            ? `ไฟล์ "${file.name}" มีขนาดเกิน 4 MB`
            : `File "${file.name}" exceeds the 4 MB limit.`
        );
        continue;
      }

      const isTextLike =
        file.type.startsWith('text/') ||
        file.type === 'application/json' ||
        TEXT_FILE_EXTENSIONS.test(file.name);

      if (isTextLike) {
        const textContent = await file.text();
        added.push({
          name: file.name,
          mimeType: file.type || 'text/plain',
          textContent: textContent.slice(0, 12000),
          sizeBytes: file.size,
        });
      } else if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        const dataBase64 = await readFileAsBase64(file);
        added.push({
          name: file.name,
          mimeType: file.type,
          dataBase64,
          sizeBytes: file.size,
        });
      } else {
        setAttachError(
          lang === 'th'
            ? `ไม่รองรับชนิดไฟล์ "${file.name}" (รองรับรูปภาพ, PDF, และไฟล์ข้อความ/โค้ด)`
            : `Unsupported file type for "${file.name}" (supports images, PDFs, and text/code files).`
        );
      }
    }

    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added].slice(0, 4));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void handleFilesSelected(files);
    }
  };

  const handleSend = async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim();
    const pendingAttachments = overrideText ? [] : attachments;
    if ((!trimmed && pendingAttachments.length === 0) || isStreaming) return;

    const userMsg: AssistantMessage = {
      id: `asst-u-${Date.now()}`,
      role: 'user',
      text: trimmed || (lang === 'th' ? 'ช่วยวิเคราะห์ไฟล์ที่แนบมา' : 'Please analyze the attached file(s).'),
      timestamp: new Date().toISOString(),
      attachmentNames: pendingAttachments.map((a) => a.name),
    };

    const historyPayload = messages
      .filter((m) => !m.error)
      .slice(-MAX_SHORT_TERM_MESSAGES)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg].slice(-MAX_SHORT_TERM_MESSAGES));
    if (!overrideText) {
      setInput('');
      setAttachments([]);
      setAttachError(null);
    }
    setIsStreaming(true);
    setStreamingText('');
    setLiveStatus(lang === 'th' ? 'กำลังเชื่อมต่อผู้ช่วย AI...' : 'Connecting to AI Assistant...');
    setLiveTools([]);

    let streamedTools: AssistantToolLog[] = [];
    let streamedSources: AssistantSourceLink[] = [];
    let streamedActions: AssistantActionSuggestion[] = [];

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId,
          message: trimmed,
          history: historyPayload,
          attachments: pendingAttachments.map(({ name, mimeType, dataBase64, textContent }) => ({
            name,
            mimeType,
            dataBase64,
            textContent,
          })),
          thinkingMode,
          webGrounding,
          moduleState,
          workspaceMetadata,
          context: {
            sessionId,
            activeModule,
            lang,
            role,
            runtimeReady,
            recentLogs: recentLogs.slice(-12),
          },
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || errBody.message || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response stream unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'status' && typeof ev.label === 'string') {
              setLiveStatus(ev.label);
            } else if (ev.type === 'brain_core' && ev.packet && typeof ev.packet === 'object') {
              setBrainCoreMeta((prev) => ({
                ...prev,
                architecture: ev.packet.architecture,
                intent: ev.packet.intent,
                strategy: ev.packet.strategy,
                recalledCount: Array.isArray(ev.packet.recalledMemories)
                  ? ev.packet.recalledMemories.length
                  : 0,
                conflictCount: ev.packet.conflictCount || 0,
                entities: Array.isArray(ev.packet.entities) ? ev.packet.entities : [],
              }));
            } else if (ev.type === 'tool_call' && typeof ev.name === 'string') {
              streamedTools = [...streamedTools, { name: ev.name }];
              setLiveTools(streamedTools);
              setLiveStatus(
                lang === 'th'
                  ? `กำลังเรียกเครื่องมือ: ${formatToolDisplayName(ev.name, 'th')}...`
                  : `Running tool: ${formatToolDisplayName(ev.name, 'en')}...`
              );
            } else if (ev.type === 'tool_result' && typeof ev.name === 'string') {
              const idx = streamedTools.findIndex((t) => t.name === ev.name && t.ok === undefined);
              if (idx >= 0) {
                streamedTools = streamedTools.map((t, i) =>
                  i === idx ? { ...t, ok: Boolean(ev.ok), summary: ev.summary } : t
                );
              } else {
                streamedTools = [
                  ...streamedTools,
                  { name: ev.name, ok: Boolean(ev.ok), summary: ev.summary },
                ];
              }
              setLiveTools(streamedTools);
            } else if (ev.type === 'grounding' && Array.isArray(ev.sources)) {
              streamedSources = ev.sources;
            } else if (ev.type === 'actions' && Array.isArray(ev.actions)) {
              streamedActions = ev.actions;
            } else if (ev.type === 'chunk' && typeof ev.text === 'string') {
              accumulated += ev.text;
              setStreamingText(accumulated);
            } else if (ev.type === 'done') {
              if (typeof ev.text === 'string' && ev.text && !accumulated) {
                accumulated = ev.text;
              }
              if (Array.isArray(ev.sources)) streamedSources = ev.sources;
              if (Array.isArray(ev.actions)) streamedActions = ev.actions;
              if (typeof ev.memoryExchanges === 'number') {
                setServerExchangeCount(ev.memoryExchanges);
              }
              if (ev.brainTrace) {
                setBrainCoreMeta((prev) => ({
                  ...prev,
                  totalCycles: (prev?.totalCycles ?? 0) + 1,
                  intent: ev.brainTrace.intent || prev?.intent,
                  strategy: ev.brainTrace.strategy || prev?.strategy,
                  recalledCount:
                    typeof ev.brainTrace.recalledCount === 'number'
                      ? ev.brainTrace.recalledCount
                      : prev?.recalledCount,
                }));
              }
            } else if (ev.type === 'error') {
              throw new Error(ev.error || 'Assistant request failed');
            }
          } catch (parseErr: any) {
            if (parseErr?.message && parseErr.message !== 'Unexpected end of JSON input') {
              throw parseErr;
            }
          }
        }
      }

      const finalText =
        accumulated.trim() || (lang === 'th' ? 'ไม่ได้รับข้อความตอบกลับ' : 'No response received.');
      setMessages((prev) =>
        [
          ...prev,
          {
            id: `asst-m-${Date.now()}`,
            role: 'model' as const,
            text: finalText,
            timestamp: new Date().toISOString(),
            toolsUsed: streamedTools.length > 0 ? streamedTools : undefined,
            sources: streamedSources.length > 0 ? streamedSources : undefined,
            actions: streamedActions.length > 0 ? streamedActions : undefined,
          },
        ].slice(-MAX_SHORT_TERM_MESSAGES)
      );
      setStreamingText('');
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-e-${Date.now()}`,
          role: 'model',
          text: err?.message || 'Unable to reach AI Assistant.',
          timestamp: new Date().toISOString(),
          error: true,
        },
      ]);
      setStreamingText('');
    } finally {
      setIsStreaming(false);
      setLiveStatus('');
      setLiveTools([]);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSpeakToggle = (msgId: string, text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const clean = text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[*#`]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(clean || text);
    const savedRate = parseFloat(localStorage.getItem('zyntheor_tts_rate') || '1.0');
    const savedPitch = parseFloat(localStorage.getItem('zyntheor_tts_pitch') || '1.0');
    const savedVolume = parseFloat(localStorage.getItem('zyntheor_tts_volume') || '1.0');
    const savedVoice = localStorage.getItem('zyntheor_tts_voice') || '';

    if (Number.isFinite(savedRate)) utterance.rate = Math.min(2, Math.max(0.5, savedRate));
    if (Number.isFinite(savedPitch)) utterance.pitch = Math.min(2, Math.max(0.5, savedPitch));
    if (Number.isFinite(savedVolume)) utterance.volume = Math.min(1, Math.max(0, savedVolume));
    if (savedVoice) {
      const matched = window.speechSynthesis
        .getVoices()
        .find((v) => v.voiceURI === savedVoice || v.name === savedVoice);
      if (matched) utterance.voice = matched;
    }

    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const handleExecuteAction = (action: AssistantActionSuggestion) => {
    if (action.actionType === 'navigate_module' && action.moduleId && onNavigateModule) {
      const target = action.moduleId as ModuleId;
      if (VALID_MODULE_IDS.has(target)) {
        onNavigateModule(target);
      }
    } else if (action.actionType === 'prepare_quick_task' && action.taskGoal && onApplyToQuickTask) {
      onApplyToQuickTask(action.taskGoal);
    }
  };

  const handleClearSession = async () => {
    const oldSessionId = sessionId;
    setMessages([]);
    setServerExchangeCount(0);
    try {
      sessionStorage.removeItem(`${SESSION_MEMORY_PREFIX}${oldSessionId}`);
      const nextSid = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_ID_STORAGE_KEY, nextSid);
      setSessionId(nextSid);
    } catch {
      // ignore storage errors
    }
    try {
      await fetch(`/api/assistant/session/${encodeURIComponent(oldSessionId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    } catch {
      // ignore cleanup error
    }
  };

  const localExchanges = Math.ceil(messages.filter((m) => !m.error).length / 2);
  const displayedExchanges = Math.max(serverExchangeCount, localExchanges);
  const workspaceFileCount =
    typeof workspaceMetadata?.sandboxFileCount === 'number' ? workspaceMetadata.sandboxFileCount : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'th' ? 'ผู้ช่วย AI ในระบบ' : 'System AI Assistant'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="w-full max-w-lg h-full flex flex-col border-l shadow-2xl"
        style={{
          backgroundColor: 'var(--app-card)',
          borderColor: 'var(--app-card-border)',
          color: 'var(--app-text-primary)',
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 border-b shrink-0 space-y-2.5"
          style={{
            backgroundColor: 'var(--app-surface)',
            borderColor: 'var(--app-card-border)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] border border-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] flex items-center justify-center text-[var(--app-accent)] shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-semibold tracking-tight truncate">
                    {lang === 'th' ? 'ผู้ช่วย AI อัจฉริยะ' : 'System AI Assistant'}
                  </h2>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]">
                    {assistantOnline
                      ? lang === 'th'
                        ? 'พร้อมรับคำสั่ง'
                        : 'ONLINE'
                      : lang === 'th'
                      ? 'รอตรวจสอบ'
                      : 'CHECK'}
                  </span>
                </div>
                <p
                  data-testid="assistant-context-summary"
                  className="text-[11px] font-mono text-[var(--app-text-secondary)] truncate"
                >
                  {lang === 'th'
                    ? `${activeModule} · ความจำ ${displayedExchanges}/${MAX_SHORT_TERM_EXCHANGES} · ${
                        workspaceFileCount !== null ? `/workspace ${workspaceFileCount} ไฟล์` : '/workspace พร้อม'
                      } · ${runtimeReady ? 'Runtime พร้อม' : 'โหมดเครื่องมือ'}`
                    : `${activeModule} · Memory ${displayedExchanges}/${MAX_SHORT_TERM_EXCHANGES} · ${
                        workspaceFileCount !== null ? `Workspace ${workspaceFileCount} files` : 'Workspace Live'
                      } · ${runtimeReady ? 'Runtime READY' : 'Tools Live'}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsClearSessionConfirmOpen(true)}
                disabled={messages.length === 0 || isStreaming}
                title={lang === 'th' ? 'ล้างหน่วยความจำสนทนาเซสชันนี้' : 'Clear session memory'}
                aria-label={lang === 'th' ? 'ล้างหน่วยความจำสนทนาเซสชันนี้' : 'Clear session memory'}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center p-1.5 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] hover:border-[var(--z-danger)] disabled:opacity-40 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={lang === 'th' ? 'ปิดผู้ช่วย AI' : 'Close AI Assistant'}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center p-1.5 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Capability Bar: Thinking Depth + Web Search */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
            <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-bg)] p-0.5">
              <Brain className="w-3 h-3 text-[var(--app-accent)] ml-1.5 mr-0.5" />
              {(['fast', 'balanced', 'deep'] as ThinkingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setThinkingMode(mode)}
                  disabled={isStreaming}
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    thinkingMode === mode
                      ? 'bg-[var(--app-accent-deep)] text-white font-bold'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  {mode === 'fast'
                    ? lang === 'th'
                      ? 'เร็ว'
                      : 'Fast'
                    : mode === 'balanced'
                    ? lang === 'th'
                      ? 'สมดุล'
                      : 'Balanced'
                    : lang === 'th'
                    ? 'ลึก XHIGH'
                    : 'Deep XHIGH'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setWebGrounding((prev) => !prev)}
              disabled={isStreaming}
              aria-pressed={webGrounding}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
                webGrounding
                  ? 'bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] font-bold'
                  : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
              }`}
              title={
                lang === 'th'
                  ? 'เปิด/ปิด การค้นหาเว็บและอ่านลิงก์อัตโนมัติ'
                  : 'Toggle Google Search & URL Context grounding'
              }
            >
              <Globe className="w-3 h-3" />
              <span>{lang === 'th' ? 'ค้นเว็บ + URL' : 'Web + URL'}</span>
            </button>

            <button
              type="button"
              data-testid="assistant-brain-core-toggle"
              onClick={() => setShowBrainDetails((prev) => !prev)}
              aria-expanded={showBrainDetails}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] cursor-pointer transition-colors"
              title={lang === 'th' ? 'ดูรายละเอียดแกนสมองผู้ช่วย' : 'Inspect Assistant Brain Core'}
            >
              <Bot className="w-3 h-3 text-[var(--app-accent)]" />
              <span>
                {brainCoreMeta?.strategy
                  ? `${brainCoreMeta.intent} · ${brainCoreMeta.strategy}`
                  : lang === 'th'
                  ? 'แกนสมองผู้ช่วย: พร้อม'
                  : 'Brain Core: Active'}
              </span>
            </button>
          </div>

          {showBrainDetails && (
            <div
              data-testid="assistant-brain-core-details"
              className="pt-2 border-t border-[color-mix(in_srgb,var(--app-card-border)_65%,transparent)] text-[10px] font-mono text-[var(--app-text-secondary)] space-y-1"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--app-text-primary)] font-semibold">
                  {brainCoreMeta?.architecture || 'ZYNTHEOR-AssistantBrainCore-v1'}
                </span>
                <span>
                  Cycles: {brainCoreMeta?.totalCycles ?? 0} · LTM: {brainCoreMeta?.episodicCount ?? 0} items
                </span>
              </div>
              <div className="truncate">
                Core: CognitiveContext + AdaptiveReasoning + NativeMemory + AutonomousPlanner
              </div>
              {brainCoreMeta?.entities && brainCoreMeta.entities.length > 0 && (
                <div className="truncate text-[var(--app-accent)]">
                  Entities: {brainCoreMeta.entities.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && !isStreaming && (
            <div className="space-y-4 pt-1">
              <div className="p-3.5 rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface)] space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-accent)]">
                  <Bot className="w-4 h-4" />
                  <span>
                    {lang === 'th'
                      ? 'ผู้ช่วยเชื่อมต่อระบบจริงพร้อมเครื่องมือครบชุด'
                      : 'Tool-Enabled Assistant Connected to Live System'}
                  </span>
                </div>
                <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">
                  {lang === 'th'
                    ? 'สามารถเรียกดู Telemetry จริง ค้น Knowledge Hub อ่านไฟล์ใน /workspace ตรวจ Audit Ledger ค้นข้อมูลเว็บ วิเคราะห์ภาพ/โค้ดที่แนบ และส่งคำสั่งเข้า Quick Task หรือนำทางไปยังโมดูลต่าง ๆ ได้ทันที'
                    : 'Inspects live telemetry, searches Knowledge Hub, reads /workspace files, audits SHA-256 logs, grounds answers with web search, analyzes attached images/code, and triggers module navigation or Quick Tasks.'}
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                  {lang === 'th' ? 'คำสั่งแนะนำ' : 'Quick Prompts'}
                </div>
                <div className="flex flex-col gap-2">
                  {starterPrompts.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => void handleSend(item.prompt)}
                      className="text-left px-3 py-2.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)] text-xs text-[var(--app-text-primary)] transition-colors cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--app-text-secondary)] px-1">
                {msg.role === 'user' ? (
                  <>
                    <span>{lang === 'th' ? 'คุณ' : 'You'}</span>
                    <User className="w-3 h-3" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-[var(--app-accent)]" />
                    <span>{lang === 'th' ? 'ผู้ช่วย AI' : 'AI Assistant'}</span>
                  </>
                )}
              </div>
              <div
                className={`max-w-[94%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words border ${
                  msg.error
                    ? 'bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] text-[var(--z-danger)]'
                    : msg.role === 'user'
                    ? 'bg-[color-mix(in_srgb,var(--app-accent)_14%,var(--app-surface))] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] text-[var(--app-text-primary)]'
                    : 'bg-[var(--app-surface)] border-[var(--app-card-border)] text-[var(--app-text-primary)]'
                }`}
              >
                {msg.error && (
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{lang === 'th' ? 'เกิดข้อผิดพลาด' : 'Error'}</span>
                  </div>
                )}

                {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.attachmentNames.map((name, idx) => (
                      <span
                        key={`${name}-${idx}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-accent)]"
                      >
                        <Paperclip className="w-2.5 h-2.5" />
                        {name}
                      </span>
                    ))}
                  </div>
                )}

                {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.toolsUsed.map((tool, idx) => (
                      <span
                        key={`${tool.name}-${idx}`}
                        title={tool.summary || tool.name}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono border ${
                          tool.ok === false
                            ? 'bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-[var(--z-danger)]'
                            : 'bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)] border-[color-mix(in_srgb,var(--z-ok)_35%,transparent)] text-[var(--z-ok)]'
                        }`}
                      >
                        <Wrench className="w-2.5 h-2.5" />
                        <span>{formatToolDisplayName(tool.name, lang === 'th' ? 'th' : 'en')}</span>
                      </span>
                    ))}
                  </div>
                )}

                {msg.text}

                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {msg.actions.map((act, idx) => (
                      <button
                        key={`${act.actionType}-${idx}`}
                        type="button"
                        onClick={() => handleExecuteAction(act)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-[color-mix(in_srgb,var(--app-accent)_16%,var(--app-bg))] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_26%,var(--app-bg))] cursor-pointer transition-colors"
                      >
                        <span>{act.label}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                )}

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)] space-y-1">
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'แหล่งอ้างอิงจากเว็บ:' : 'Web Sources:'}
                    </div>
                    <div className="flex flex-col gap-1">
                      {msg.sources.map((src) => (
                        <a
                          key={src.url}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--app-accent)] hover:underline truncate"
                        >
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{src.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {msg.role === 'model' && !msg.error && (
                  <div className="mt-2 pt-2 border-t border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)] flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCopy(msg.id, msg.text)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3 h-3 text-[var(--z-ok)]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>
                        {copiedId === msg.id
                          ? lang === 'th'
                            ? 'คัดลอกแล้ว'
                            : 'Copied'
                          : lang === 'th'
                          ? 'คัดลอก'
                          : 'Copy'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSpeakToggle(msg.id, msg.text)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] cursor-pointer"
                    >
                      {speakingMsgId === msg.id ? (
                        <VolumeX className="w-3 h-3 text-[var(--app-amber)]" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                      <span>
                        {speakingMsgId === msg.id
                          ? lang === 'th'
                            ? 'หยุดอ่าน'
                            : 'Stop'
                          : lang === 'th'
                          ? 'อ่านออกเสียง'
                          : 'Read aloud'}
                      </span>
                    </button>
                    {onApplyToQuickTask && (
                      <button
                        type="button"
                        onClick={() => {
                          onApplyToQuickTask(msg.text.slice(0, 280));
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-amber)] cursor-pointer"
                      >
                        <Terminal className="w-3 h-3" />
                        <span>{lang === 'th' ? 'ส่งไป Quick Task' : 'Use as Task Goal'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="flex flex-col gap-1.5 items-start">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--app-accent)] px-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{liveStatus || (lang === 'th' ? 'กำลังประมวลผล...' : 'Thinking...')}</span>
              </div>
              {liveTools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {liveTools.map((tool, idx) => (
                    <span
                      key={`${tool.name}-live-${idx}`}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono border ${
                        tool.ok === undefined
                          ? 'bg-[color-mix(in_srgb,var(--app-amber)_14%,transparent)] border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] text-[var(--app-amber)]'
                          : tool.ok
                          ? 'bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)] border-[color-mix(in_srgb,var(--z-ok)_35%,transparent)] text-[var(--z-ok)]'
                          : 'bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-[var(--z-danger)]'
                      }`}
                    >
                      <Wrench className="w-2.5 h-2.5" />
                      <span>
                        {formatToolDisplayName(tool.name, lang === 'th' ? 'th' : 'en')}
                        {tool.summary ? ` · ${tool.summary}` : ''}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {streamingText && (
                <div className="max-w-[94%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words border bg-[var(--app-surface)] border-[var(--app-card-border)] text-[var(--app-text-primary)]">
                  {streamingText}
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div
          className="p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t shrink-0 space-y-2"
          style={{
            backgroundColor: 'var(--app-surface)',
            borderColor: 'var(--app-card-border)',
          }}
        >
          {attachError && (
            <div className="text-[10px] font-mono text-[var(--z-danger)] flex items-center justify-between px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)]">
              <span>{attachError}</span>
              <button
                type="button"
                onClick={() => setAttachError(null)}
                aria-label={lang === 'th' ? 'ปิดข้อความแจ้งเตือน' : 'Dismiss attachment error'}
                className="min-h-[28px] min-w-[28px] inline-flex items-center justify-center cursor-pointer hover:opacity-80"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((att, idx) => (
                <span
                  key={`${att.name}-${idx}`}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono border border-[var(--app-card-border)] bg-[var(--app-bg)] text-[var(--app-text-primary)]"
                >
                  {att.mimeType.startsWith('image/') ? (
                    <ImageIcon className="w-3 h-3 text-[var(--app-accent)]" />
                  ) : (
                    <FileCode className="w-3 h-3 text-[var(--app-amber)]" />
                  )}
                  <span className="max-w-[140px] truncate">{att.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                    }
                    className="text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] cursor-pointer"
                    aria-label={lang === 'th' ? `นำไฟล์ ${att.name} ออก` : `Remove ${att.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.txt,.md,.ts,.tsx,.js,.jsx,.py,.json,.csv,.log,.yml,.yaml,.sql"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void handleFilesSelected(e.target.files);
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || attachments.length >= 4}
              title={
                lang === 'th'
                  ? 'แนบไฟล์ภาพ, PDF หรือโค้ด/Log (สูงสุด 4 ไฟล์)'
                  : 'Attach image, PDF, or code/log file (max 4)'
              }
              aria-label={lang === 'th' ? 'แนบไฟล์' : 'Attach files'}
              className="h-10 px-2.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] hover:border-[var(--app-accent)] disabled:opacity-40 cursor-pointer shrink-0 inline-flex items-center justify-center transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                lang === 'th'
                  ? 'สั่งงาน/ถามข้อมูลระบบ ค้นเว็บ หรือวางรูป/โค้ด... (Enter ส่ง)'
                  : 'Ask, inspect live telemetry, search web, or paste image/code... (Enter)'
              }
              className="flex-1 resize-none rounded-xl px-3 py-2 text-xs focus:outline-none border"
              style={{
                backgroundColor: 'var(--app-input-bg)',
                borderColor: 'var(--app-card-border)',
                color: 'var(--app-text-primary)',
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={(!input.trim() && attachments.length === 0) || isStreaming}
              aria-label={lang === 'th' ? 'ส่งข้อความ' : 'Send message'}
              className="h-10 px-3.5 rounded-xl vivid-gradient-brand text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer shrink-0"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-[var(--app-text-secondary)]">
            <span>{lang === 'th' ? 'สลับหน้าต่าง: Alt+A · วางภาพได้' : 'Toggle: Alt+A · Paste image'}</span>
            <span>Shift+Enter {lang === 'th' ? 'ขึ้นบรรทัดใหม่' : 'newline'}</span>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={isClearSessionConfirmOpen}
        title={lang === 'th' ? 'ยืนยันการล้างประวัติสนทนา' : 'Clear Session History'}
        description={
          lang === 'th'
            ? 'ข้อความทั้งหมดและหน่วยความจำระยะสั้นของเซสชันนี้จะถูกลบออกอย่างถาวร'
            : 'All messages and short-term memory for this session will be permanently cleared.'
        }
        targetLabel={`${sessionId} (${messages.length} ${lang === 'th' ? 'ข้อความ' : 'messages'})`}
        confirmLabel={lang === 'th' ? 'ล้างประวัติสนทนา' : 'Clear Session'}
        onCancel={() => setIsClearSessionConfirmOpen(false)}
        onConfirm={async () => {
          await handleClearSession();
          setIsClearSessionConfirmOpen(false);
        }}
      />
    </div>
  );
};
