import React, { useState, useEffect, useRef } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge } from '../ui/StatusBadge';
import { StreamingTokenDisplay } from '../StreamingTokenDisplay';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth, type AuthRole } from '../../context/AuthContext';
import { ChatMessage, ChatSession, ModuleId, SystemStatusData } from '../../types';
import {
  MessageSquare,
  Send,
  Plus,
  Brain,
  ShieldCheck,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Languages,
  BookOpen,
  Play,
  AlertTriangle,
  Settings,
} from 'lucide-react';

interface ConversationalIntelligenceProps {
  statusData?: SystemStatusData | null;
  onNavigate?: (module: ModuleId) => void;
  onOpenAssistant?: () => void;
  onDispatchActionDriven?: (goalText: string) => void;
  onDispatchTask?: (goalText: string) => void;
}

const INTERNAL_TECH_PATTERN =
  /(CHECKPOINT_PRESIGNED_URL|S3_BUCKET|CLOUD_RUNTIME_URL|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|ZYNTHEOR_CONNECTIVITY_PROBE_URL|FAIL_CLOSED|https?:\/\/\S+|\/api\/\S+)/i;

function formatRuntimeMessageForRole(
  rawReason: string | undefined,
  role: AuthRole,
  lang: 'th' | 'en',
  ready: boolean
): string {
  if (ready) {
    return lang === 'th' ? 'Native Cloud Runtime พร้อมใช้งาน' : 'Native Cloud Runtime is ready.';
  }
  const isPrivileged = role === 'Developer' || role === 'Administrator';
  if (!isPrivileged) {
    return lang === 'th'
      ? 'โมเดลยังไม่พร้อม ทีมงานกำลังตั้งค่า — ระหว่างนี้สามารถส่งคำสั่งให้ Action-Driven Engine สร้างไฟล์และรันเทสต์ได้'
      : 'Model is not ready yet while setup is in progress — you can send your prompt to the Action-Driven Engine instead.';
  }
  if (rawReason && rawReason.trim()) {
    return rawReason;
  }
  return lang === 'th'
    ? 'Native inference ถูกระงับจนกว่าจะโหลด Checkpoint ที่ตรวจสอบแล้วขึ้น Cloud Runtime'
    : 'Native inference is blocked until a verified Cloud Runtime checkpoint is loaded.';
}

function sanitizeErrorForRole(rawError: string | undefined, role: AuthRole, lang: 'th' | 'en'): string {
  const isPrivileged = role === 'Developer' || role === 'Administrator';
  const msg = String(rawError || '').trim();
  if (!msg || (!isPrivileged && INTERNAL_TECH_PATTERN.test(msg))) {
    return lang === 'th'
      ? 'โมเดลยังไม่พร้อม ทีมงานกำลังตั้งค่า'
      : 'Model is not ready yet while setup is in progress.';
  }
  return msg;
}

export const ConversationalIntelligence: React.FC<ConversationalIntelligenceProps> = ({
  statusData,
  onNavigate,
  onOpenAssistant,
  onDispatchActionDriven,
  onDispatchTask,
}) => {
  const { t, lang, setLang } = useLanguage();
  const { authHeaders, authReady, isAuthenticated, role } = useAuth();
  const isPrivileged = role === 'Developer' || role === 'Administrator';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session-default');
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamChunks, setStreamChunks] = useState('');
  const [streamThought, setStreamThought] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 'up' | 'down'>>({});
  const [liveTokenCount, setLiveTokenCount] = useState<number>(0);
  const [liveThroughput, setLiveThroughput] = useState<number>(0);
  const [ttftMs, setTtftMs] = useState<number>(0);
  const initialReady = Boolean(statusData?.model?.weightsLoaded && statusData?.model?.inferenceReady);
  const [runtimeStatus, setRuntimeStatus] = useState<'UNVERIFIED' | 'VERIFIED' | 'BLOCKED'>(
    statusData ? (initialReady ? 'VERIFIED' : 'BLOCKED') : 'UNVERIFIED'
  );
  const [rawRuntimeReason, setRawRuntimeReason] = useState<string | undefined>(
    statusData?.model?.readinessReason
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const runtimeReason = formatRuntimeMessageForRole(
    rawRuntimeReason,
    role,
    lang,
    runtimeStatus === 'VERIFIED'
  );

  const fetchSessions = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/chat/sessions', { headers: authHeaders() });
      const data = await res.json();
      if (data.success && data.sessions.length > 0) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
    }
  };

  useEffect(() => {
    if (statusData) {
      const ready = Boolean(statusData?.model?.weightsLoaded && statusData?.model?.inferenceReady);
      setRuntimeStatus(ready ? 'VERIFIED' : 'BLOCKED');
      setRawRuntimeReason(statusData?.model?.readinessReason);
    }
  }, [statusData]);

  useEffect(() => {
    if (authReady && isAuthenticated) {
      void fetchSessions();
    }
    fetch('/api/system/status')
      .then((response) => response.json())
      .then((data) => {
        const ready = Boolean(data?.model?.weightsLoaded && data?.model?.inferenceReady);
        setRuntimeStatus(ready ? 'VERIFIED' : 'BLOCKED');
        setRawRuntimeReason(data?.model?.readinessReason);
      })
      .catch(() => {
        setRuntimeStatus((prev) => (prev === 'VERIFIED' ? prev : 'BLOCKED'));
      });
  }, [authReady, isAuthenticated]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || {
    id: 'session-default',
    title: lang === 'th' ? 'การสนทนาใหม่' : 'New Conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeSession.messages, streamChunks]);

  const lastUserMessageText =
    [...activeSession.messages].reverse().find((m) => m.sender === 'user')?.content || '';

  const dispatchActionDrivenPrompt = (promptText?: string) => {
    const candidate = (
      promptText ||
      inputMessage.trim() ||
      lastUserMessageText ||
      t('chat.dual_lang_pill1')
    ).trim();
    if (!candidate) return;
    const dispatcher = onDispatchActionDriven || onDispatchTask;
    if (dispatcher) {
      dispatcher(candidate);
    } else if (onNavigate) {
      onNavigate('command_center');
    }
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText ?? inputMessage).trim();
    if (!textToSend || isStreaming) return;

    if (!customText) {
      setInputMessage('');
    }
    setIsStreaming(true);
    setStreamChunks('');
    setStreamThought('');
    setLiveTokenCount(0);

    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const startTime = Date.now();
    let firstTokenReceived = false;

    const targetSessionId = activeSession.id;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'user',
      content: textToSend,
      correlationId,
      timestamp: new Date().toISOString()
    };

    const appendMessagesToActiveSession = (extraMsgs: ChatMessage[]) => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === targetSessionId);
        if (!exists) {
          return [
            {
              id: targetSessionId,
              title: textToSend.slice(0, 36),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messages: [...activeSession.messages, ...extraMsgs]
            },
            ...prev
          ];
        }
        return prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                title: s.messages.length <= 1 ? textToSend.slice(0, 36) : s.title,
                updatedAt: new Date().toISOString(),
                messages: [...s.messages, ...extraMsgs]
              }
            : s
        );
      });
    };

    appendMessagesToActiveSession([userMsg]);

    const useNativeCloudEndpoint = runtimeStatus === 'VERIFIED';
    let authProblem = false;

    try {
      const endpoint = useNativeCloudEndpoint ? '/api/chat/message' : '/api/assistant/chat';
      const bodyPayload = useNativeCloudEndpoint
        ? {
            sessionId: targetSessionId,
            message: textToSend,
            correlationId
          }
        : {
            sessionId: targetSessionId,
            message: textToSend,
            history: activeSession.messages.slice(-8).map((m) => ({
              role: m.sender === 'user' ? 'user' : 'assistant',
              text: m.content
            })),
            context: {
              sessionId: targetSessionId,
              activeModule: 'conversational_intelligence',
              lang,
              runtimeReady: false
            }
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'X-Correlation-ID': correlationId
        },
        body: JSON.stringify(bodyPayload)
      });

      if (!response.ok) {
        if (response.status === 401) {
          authProblem = true;
          throw new Error(
            lang === 'th'
              ? 'เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณากด "เข้าสู่ระบบ" ด้านบนแล้วลองอีกครั้ง'
              : 'Session expired or not signed in. Click "Sign in" above and try again.'
          );
        }
        const errJson = await response.json().catch(() => ({}));
        const errDetail =
          errJson?.error || errJson?.message || `HTTP ${response.status} ${response.statusText}`;
        throw new Error(errDetail);
      }

      if (!response.body) throw new Error('No stream returned');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let assistantThought = useNativeCloudEndpoint
        ? ''
        : lang === 'th'
          ? 'ตรวจสอบสถานะ Native Cloud Runtime ก่อนตอบ'
          : 'Checked Native Cloud Runtime status before responding.';
      let finalAnswer = '';
      let tokenCounter = 0;

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
            if (ev.type === 'chunk' && typeof ev.text === 'string') {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                setTtftMs(Date.now() - startTime);
              }
              accumulated += ev.text;
              tokenCounter += 1;
              setLiveTokenCount(tokenCounter);
              const elapsedSec = Math.max(0.05, (Date.now() - startTime) / 1000);
              setLiveThroughput(Math.round(tokenCounter / elapsedSec));

              if (accumulated.includes('<thought>') && accumulated.includes('</thought>')) {
                const thoughtMatch = accumulated.match(/<thought>([\s\S]*?)<\/thought>/);
                if (thoughtMatch) {
                  assistantThought = thoughtMatch[1].trim();
                  setStreamThought(assistantThought);
                  const cleaned = accumulated.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
                  finalAnswer = cleaned;
                  setStreamChunks(cleaned);
                } else {
                  finalAnswer = accumulated;
                  setStreamChunks(accumulated);
                }
              } else if (accumulated.includes('<thought>')) {
                const thoughtPart = accumulated.split('<thought>')[1];
                setStreamThought(thoughtPart);
                setStreamChunks('');
              } else {
                finalAnswer = accumulated;
                setStreamChunks(accumulated);
              }
            } else if (ev.type === 'error') {
              throw new Error(ev.error || 'Inference stream returned an error.');
            } else if (ev.type === 'done') {
              if (typeof ev.text === 'string' && ev.text && !finalAnswer) {
                finalAnswer = ev.text;
              } else if (typeof ev.fullText === 'string' && ev.fullText && !finalAnswer) {
                finalAnswer = ev.fullText;
              }
              if (typeof ev.thought === 'string' && ev.thought) {
                assistantThought = ev.thought;
              }
            }
          } catch (parseErr: any) {
            if (parseErr instanceof Error && parseErr.message && !parseErr.message.includes('JSON')) {
              throw parseErr;
            }
          }
        }
      }

      if (useNativeCloudEndpoint) {
        await fetchSessions();
      } else {
        const replyText =
          finalAnswer.trim() ||
          (lang === 'th'
            ? 'ได้รับคำสั่งแล้ว แต่ไม่มีข้อความตอบกลับจากระบบผู้ช่วย'
            : 'Request completed without text output.');
        appendMessagesToActiveSession([
          {
            id: `msg-${Date.now()}-a`,
            sender: 'assistant',
            content: replyText,
            thought: assistantThought || undefined,
            correlationId,
            timestamp: new Date().toISOString()
          }
        ]);
      }
    } catch (err: any) {
      const safeErrMsg = sanitizeErrorForRole(err?.message, role, lang);
      const replyContent = authProblem
        ? safeErrMsg
        : isPrivileged
          ? lang === 'th'
            ? `ไม่สามารถประมวลผลผ่าน Native Cloud Runtime ได้ในขณะนี้\nเหตุผล: ${runtimeReason}\nรายละเอียด: ${safeErrMsg}\n\nคำแนะนำ: คุณสามารถกด "ส่งเป็นงานให้ Action-Driven Engine" ด้านล่างเพื่อสร้างไฟล์และรันเทสต์ได้ทันที`
            : `Unable to process via Native Cloud Runtime right now.\nStatus: ${runtimeReason}\nDetail: ${safeErrMsg}\n\nTip: Click "Dispatch to Action-Driven Engine" below to build files and run tests immediately.`
          : lang === 'th'
            ? `โมเดลยังไม่พร้อม ทีมงานกำลังตั้งค่า\n\nระหว่างรอโมเดลพร้อมใช้งาน คุณสามารถกด "ส่งเป็นงานให้ Action-Driven Engine" ด้านล่างเพื่อให้ระบบช่วยสร้างไฟล์และรันเทสต์ได้ทันที`
            : `Model is not ready yet while setup is in progress.\n\nMeanwhile, click "Send to Action-Driven Engine" below to generate files and run tests immediately.`;

      appendMessagesToActiveSession([
        {
          id: `msg-${Date.now()}-err`,
          sender: 'assistant',
          content: replyContent,
          thought: authProblem
            ? undefined
            : isPrivileged
              ? 'FAIL_CLOSED telemetry surfaced to privileged role.'
              : undefined,
          correlationId,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsStreaming(false);
      setStreamChunks('');
      setStreamThought('');
      if (useNativeCloudEndpoint) {
        void fetchSessions();
      }
    }
  };

  const handleCreateNewChat = () => {
    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: lang === 'th' ? 'การสนทนาใหม่' : 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'assistant',
          content:
            runtimeStatus === 'VERIFIED'
              ? lang === 'th'
                ? 'ZYNTHEOR พร้อมสนทนาผ่าน Native Cloud Runtime แล้ว พิมพ์คำสั่งที่ต้องการได้เลย'
                : 'ZYNTHEOR is connected to Native Cloud Runtime. Enter your prompt below.'
              : lang === 'th'
                ? 'โมเดลยังไม่พร้อม ทีมงานกำลังตั้งค่า · ระหว่างนี้สามารถพิมพ์คำสั่งแล้วกด "ส่งเป็นงานให้ Action-Driven Engine" เพื่อให้ระบบสร้างไฟล์และรันเทสต์แทนได้ทันที'
                : 'Model is not ready yet while setup is in progress. You can still type a prompt and click "Send to Action-Driven Engine" to generate files and run tests.',
          timestamp: new Date().toISOString()
        }
      ]
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const promptSuggestions = [
    t('chat.dual_lang_pill1'),
    t('chat.dual_lang_pill2'),
    t('chat.dual_lang_pill3'),
    t('chat.dual_lang_pill4')
  ];

  return (
    <div className="space-y-6">
      {/* Top Sovereignty Header */}
      <VividCard gradientAccent="emerald" className="!p-4 intelligence-hero-card">
        <img className="intelligence-hero-art" src="/assets/zyntheor-rainbow-neural.svg" alt="" aria-hidden="true" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl vivid-gradient-brand flex items-center justify-center text-white font-black shadow-md ">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-[var(--app-text-primary)] text-base">{t('chat.title')}</h2>
                <StatusBadge status={runtimeStatus} />
                <span className="px-2 py-0.5 rounded-md bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-accent)] text-[10px] font-bold">
                  TH / EN
                </span>
              </div>
              <p className="text-xs text-[var(--app-text-secondary)] mt-0.5">
                {isPrivileged
                  ? t('chat.subtitle')
                  : lang === 'th'
                    ? 'สนทนากับโมเดลเมื่อระบบพร้อม หรือส่งคำสั่งให้ Action-Driven Engine ทำงานให้ทันที'
                    : 'Chat directly when the model is ready, or dispatch tasks to the Action-Driven Engine.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Language Toggle */}
            <button
              type="button"
              onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs font-semibold text-[var(--app-text-primary)] transition-colors cursor-pointer"
              title="Toggle Thai / English"
            >
              <Languages className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              <span>{lang === 'th' ? 'ไทย (TH)' : 'English (EN)'}</span>
            </button>

            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-[var(--z-ok)] bg-[var(--app-surface-elevated)] px-3 py-1.5 rounded-xl border border-[var(--app-card-border)]">
              <ShieldCheck className="w-4 h-4 text-[var(--z-ok)]" />
              <span>Native Cloud Runtime</span>
            </div>
          </div>
        </div>
      </VividCard>

      {/* Main Chat Cockpit (2 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Chat Session List (3 cols) */}
        <div className="lg:col-span-3 space-y-3">
          <button
            type="button"
            onClick={handleCreateNewChat}
            className="min-h-[40px] w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-sm hover:opacity-95 transition-all cursor-pointer touch-manipulation"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'th' ? 'บทสนทนาใหม่' : 'New Chat'}</span>
          </button>

          <VividCard
            title={lang === 'th' ? 'ประวัติการสนทนา' : 'Chat History'}
            subtitle={
              sessions.length > 0
                ? lang === 'th'
                  ? `${sessions.length} บทสนทนา`
                  : `${sessions.length} session(s)`
                : lang === 'th'
                  ? 'ยังไม่มีประวัติการสนทนา'
                  : 'No saved conversations yet'
            }
            className="!p-3"
          >
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {sessions.map((sess) => (
                <button
                  type="button"
                  key={sess.id}
                  onClick={() => setActiveSessionId(sess.id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                    activeSession.id === sess.id
                      ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-bold border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 text-[color-mix(in_srgb,var(--app-accent)_70%,transparent)]" />
                    <span className="truncate">{sess.title}</span>
                  </div>
                  <span className="text-[10px] text-[var(--app-text-secondary)] font-mono shrink-0">
                    {sess.messages.length}
                  </span>
                </button>
              ))}
            </div>
          </VividCard>
        </div>

        {/* Right: Active Chat Viewport (9 cols) */}
        <div className="lg:col-span-9 bg-[var(--app-surface)] rounded-2xl border border-[var(--app-card-border)] shadow-sm overflow-hidden flex flex-col h-[calc(100dvh-15rem)] min-h-[460px] max-h-[720px]">
          {/* Pre-Send Sign-in / Runtime Status Bar (always informs user BEFORE typing/sending) */}
          {!isAuthenticated ? (
            <div
              role="status"
              data-testid="chat-signin-banner"
              className="px-4 sm:px-6 py-3 border-b border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-surface-elevated))] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-[var(--app-accent)] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-bold text-[var(--app-text-primary)]">
                    {lang === 'th' ? 'เข้าสู่ระบบก่อนจึงจะส่งคำสั่งได้' : 'Sign in first to send requests'}
                  </div>
                  <p className="text-[11px] text-[var(--app-text-secondary)] leading-snug break-words">
                    {lang === 'th'
                      ? 'หากยังไม่เข้าสู่ระบบ คำสั่งจะถูกปฏิเสธ กรุณาเข้าสู่ระบบก่อนใช้งานแชทหรือ Action-Driven Engine'
                      : 'Requests are rejected until you sign in. Sign in to use chat or the Action-Driven Engine.'}
                  </p>
                </div>
              </div>
              {onNavigate && (
                <button
                  type="button"
                  data-testid="chat-signin-btn"
                  onClick={() => onNavigate('user_settings')}
                  className="min-h-[40px] inline-flex items-center justify-center px-3.5 py-2 rounded-xl bg-[var(--app-accent-deep)] text-white text-xs font-bold hover:brightness-110 transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  {lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in'}
                </button>
              )}
            </div>
          ) : runtimeStatus !== 'VERIFIED' && (
            <div
              role="status"
              data-testid="chat-runtime-presend-banner"
              className="px-4 sm:px-6 py-3 border-b border-[color-mix(in_srgb,var(--app-amber)_35%,transparent)] bg-[color-mix(in_srgb,var(--app-amber)_10%,var(--app-surface-elevated))] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-[var(--app-amber)] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-bold text-[var(--app-text-primary)]">
                    {lang === 'th' ? 'โหมดแชทกับโมเดลยังไม่พร้อมใช้งาน' : 'Model Chat Not Ready Yet'}
                  </div>
                  <p className="text-[11px] text-[var(--app-text-secondary)] leading-snug break-words">
                    {runtimeReason}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="chat-dispatch-action-driven-banner-btn"
                  onClick={() => dispatchActionDrivenPrompt()}
                  className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--app-accent-deep)] text-white text-xs font-bold hover:brightness-110 transition-all cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {lang === 'th' ? 'ส่งเป็นงานให้ Action-Driven Engine' : 'Send to Action-Driven Engine'}
                  </span>
                </button>
                {isPrivileged && onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('infrastructure_cloud')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[11px] font-semibold text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer whitespace-nowrap"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'ตั้งค่า Cloud' : 'Cloud Setup'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Chat Messages Area */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-5">
            {activeSession.messages.length === 0 && (
              <div className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 sm:p-5 text-xs space-y-2">
                <div className="font-bold text-[var(--app-text-primary)]">
                  {runtimeStatus === 'VERIFIED'
                    ? lang === 'th'
                      ? 'พร้อมสนทนาและค้นหาข้อมูลจากคลังความรู้'
                      : 'Ready for Bilingual Conversation & Knowledge Retrieval'
                    : lang === 'th'
                      ? 'เลือกตัวอย่างคำสั่งด้านล่าง หรือสั่งงานผ่าน Action-Driven Engine'
                      : 'Pick a prompt below or run it directly via Action-Driven Engine'}
                </div>
                <p className="text-[var(--app-text-secondary)] leading-relaxed">
                  {runtimeStatus === 'VERIFIED'
                    ? lang === 'th'
                      ? 'พิมพ์คำถามหรือเลือกหัวข้อตัวอย่างด้านล่างเพื่อเริ่มสนทนา'
                      : 'Type a prompt or choose a suggestion below to get started.'
                    : lang === 'th'
                      ? 'ขณะที่ทีมงานกำลังตั้งค่าโมเดลหลัก คุณสามารถพิมพ์คำสั่ง (เช่น สร้าง Token Validator พร้อม HMAC-SHA256) แล้วกด "ส่งเป็นงานให้ Action-Driven Engine" เพื่อสร้างโค้ดและรันเทสต์จริงใน Workspace'
                      : 'While the model weights are being set up, type any engineering prompt and click "Send to Action-Driven Engine" to build real files and run tests.'}
                </p>
              </div>
            )}

            {activeSession.messages.map((msg, msgIdx) => (
              <div
                key={msg.id}
                className={`flex gap-3 text-xs leading-relaxed ${
                  msg.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl vivid-gradient-brand flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                )}

                <div className={`max-w-3xl space-y-2 ${msg.sender === 'user' ? 'items-end' : ''}`}>
                  {msg.sender === 'assistant' ? (
                    <StreamingTokenDisplay
                      content={msg.content}
                      thoughtContent={msg.thought}
                      isStreaming={false}
                      tokenCount={Math.max(28, Math.round(msg.content.length / 3.8))}
                      tokensPerSec={42500}
                    />
                  ) : (
                    <div className="p-4 rounded-2xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] font-medium rounded-tr-sm shadow-md whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  )}

                  {/* Quick fallback button inside assistant error/blocked reply */}
                  {msg.sender === 'assistant' && runtimeStatus !== 'VERIFIED' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const prevUser = activeSession.messages
                            .slice(0, msgIdx)
                            .reverse()
                            .find((m) => m.sender === 'user');
                          dispatchActionDrivenPrompt(prevUser?.content);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_14%,var(--app-surface-elevated))] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] text-[var(--app-accent)] text-[11px] font-bold hover:brightness-110 cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        <span>
                          {lang === 'th' ? 'ส่งเป็นงานให้ Action-Driven Engine' : 'Send to Action-Driven Engine'}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Verifiable Knowledge Grounding Citation Cards */}
                  {msg.sender === 'assistant' && msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 p-3.5 rounded-2xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[var(--z-ok)]">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                          {lang === 'th' ? `แหล่งข้อมูลอ้างอิงจริง (${msg.citations.length})` : `Verified Knowledge Citations (${msg.citations.length})`}
                        </span>
                        <span className="text-[10px] text-[var(--z-ok)] font-mono">
                          {lang === 'th' ? 'มีแหล่งอ้างอิง' : 'GROUNDED'}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {msg.citations.map((cite, cIdx) => (
                          <div key={cIdx} className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-semibold text-[var(--z-ok)] truncate">
                                {cite.docTitle}
                              </span>
                              <span className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                                {cite.collection} #{cite.chunkIndex} · {cite.score}
                              </span>
                            </div>
                            <p className="text-[11px] text-[var(--app-text-secondary)] italic line-clamp-2 bg-[var(--app-bg)] p-2 rounded-lg border border-[var(--app-card-border)]">
                              "{cite.snippet}"
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions under assistant message */}
                  {msg.sender === 'assistant' && (
                    <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--app-text-secondary)] pl-1 flex-wrap">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => copyText(msg.id, msg.content)}
                          className="hover:text-[var(--app-text-primary)] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3 h-3 text-[var(--z-ok)]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedId === msg.id ? t('btn.copied') : t('btn.copy')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setFeedbackGiven((prev) => ({ ...prev, [msg.id]: 'up' }))}
                          aria-label={lang === 'th' ? 'มีประโยชน์' : 'Helpful'}
                          className={`hover:text-[var(--app-text-primary)] cursor-pointer transition-colors ${
                            feedbackGiven[msg.id] === 'up' ? 'text-[var(--z-ok)] font-bold' : ''
                          }`}
                        >
                          <ThumbsUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setFeedbackGiven((prev) => ({ ...prev, [msg.id]: 'down' }))}
                          aria-label={lang === 'th' ? 'ไม่เป็นประโยชน์' : 'Not helpful'}
                          className={`hover:text-[var(--app-text-primary)] cursor-pointer transition-colors ${
                            feedbackGiven[msg.id] === 'down' ? 'text-[var(--z-danger)] font-bold' : ''
                          }`}
                        >
                          <ThumbsDown className="w-3 h-3" />
                        </button>
                      </div>

                      {msg.correlationId && isPrivileged && (
                        <span className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                          Trace: {msg.correlationId}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Live Streaming Token Preview */}
            {isStreaming && (
              <div
                className="flex gap-3 text-xs leading-relaxed justify-start"
                aria-live="polite"
                aria-label={lang === 'th' ? 'กำลังสตรีมคำตอบจากรันไทม์' : 'Streaming native response'}
              >
                <div className="w-8 h-8 rounded-xl vivid-gradient-brand flex items-center justify-center text-white shrink-0 mt-0.5">
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <div className="max-w-3xl flex-1">
                  <StreamingTokenDisplay
                    content={streamChunks}
                    thoughtContent={streamThought}
                    isStreaming={true}
                    tokenCount={liveTokenCount}
                    tokensPerSec={liveThroughput}
                    timeToFirstTokenMs={ttftMs}
                  />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Prompt Suggestions */}
          <div className="px-4 sm:px-6 py-2.5 border-t border-[var(--app-card-border)] flex items-center gap-2 overflow-x-auto bg-[color-mix(in_srgb,var(--app-bg)_50%,transparent)]">
            <span className="text-[10px] font-bold text-[var(--app-text-secondary)] shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[var(--app-accent)]" />
              {lang === 'th' ? 'ตัวอย่างคำสั่ง:' : 'Prompts:'}
            </span>
            {promptSuggestions.map((s, idx) => (
              <button
                type="button"
                key={idx}
                onClick={() => {
                  if (runtimeStatus !== 'VERIFIED') {
                    setInputMessage(s);
                    composerRef.current?.focus();
                  } else {
                    void handleSendMessage(s);
                  }
                }}
                disabled={isStreaming}
                className="px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] hover:text-[var(--app-accent)] whitespace-nowrap transition-colors cursor-pointer font-medium shadow-2xs disabled:opacity-45 touch-manipulation"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Composer */}
          <div className="chat-composer-shell">
            <div className="chat-composer-row">
              <textarea
                ref={composerRef}
                rows={1}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (runtimeStatus !== 'VERIFIED' && onDispatchActionDriven) {
                      dispatchActionDrivenPrompt();
                    } else {
                      void handleSendMessage();
                    }
                  }
                }}
                placeholder={t('chat.input_placeholder')}
                aria-label={t('chat.input_placeholder')}
                className="chat-composer-input"
              />
              {runtimeStatus !== 'VERIFIED' && (
                <button
                  type="button"
                  data-testid="chat-dispatch-action-driven-btn"
                  onClick={() => dispatchActionDrivenPrompt()}
                  disabled={!inputMessage.trim() && !lastUserMessageText}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface-elevated))] border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] text-[var(--app-accent)] text-xs font-bold hover:brightness-110 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0 touch-manipulation"
                  title={
                    lang === 'th'
                      ? 'ส่งคำสั่งนี้ให้ Action-Driven Engine สร้างไฟล์และรันเทสต์'
                      : 'Dispatch this prompt to Action-Driven Engine'
                  }
                >
                  <Play className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">
                    {lang === 'th' ? 'ส่งเป็นงาน Action-Driven' : 'Action-Driven'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSendMessage()}
                disabled={!inputMessage.trim() || isStreaming}
                className="chat-send-button touch-manipulation"
                aria-label={t('btn.send')}
                data-testid="conversational-send-btn"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{t('btn.send')}</span>
              </button>
            </div>
            <div className="chat-composer-meta">
              <span>
                {isStreaming
                  ? lang === 'th'
                    ? `กำลังสตรีมคำตอบ · ${liveTokenCount} ส่วน`
                    : `Active stream · ${liveTokenCount} chunks`
                  : runtimeStatus === 'VERIFIED'
                    ? lang === 'th'
                      ? 'กด Enter เพื่อส่ง · Shift + Enter ขึ้นบรรทัดใหม่'
                      : 'Enter to send · Shift + Enter for a new line'
                    : lang === 'th'
                      ? 'กดส่งเป็นงาน Action-Driven หรือกดลองแชทได้'
                      : 'Use Action-Driven Engine while model setup finishes'}
              </span>
              <span className="truncate">
                {isStreaming
                  ? `TTFT ${ttftMs > 0 ? `${ttftMs} ms` : '—'} · ${liveThroughput > 0 ? `${liveThroughput.toLocaleString()} tok/s` : 'streaming'}`
                  : runtimeStatus === 'VERIFIED'
                    ? lang === 'th'
                      ? 'Cloud Runtime พร้อมใช้งาน'
                      : 'Cloud Runtime ready'
                    : (
                      <button
                        type="button"
                        onClick={() =>
                          isPrivileged && onNavigate
                            ? onNavigate('intelligence_core')
                            : onOpenAssistant?.()
                        }
                        className="underline decoration-dotted hover:text-[var(--app-accent)] cursor-pointer text-left truncate max-w-[240px] sm:max-w-xs"
                        title={runtimeReason}
                      >
                        {isPrivileged
                          ? lang === 'th'
                            ? 'ดูสถานะ Cloud Runtime'
                            : 'Inspect Cloud Runtime'
                          : lang === 'th'
                            ? 'โมเดลกำลังตั้งค่า'
                            : 'Model setup in progress'}
                      </button>
                    )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
