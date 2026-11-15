import React, { useState, useEffect, useRef } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { StreamingTokenDisplay } from '../StreamingTokenDisplay';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import { consumeNdjsonStream } from '../../lib/ndjson';
import { Citation, ChatMessage, ChatSession, SystemStatusData } from '../../types';
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
  Zap,
  Activity,
  Layers,
  Languages,
  BookOpen,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Hash,
  ShieldAlert,
  Square
} from 'lucide-react';

interface ConversationalIntelligenceProps {
  statusData?: SystemStatusData | null;
}

export const ConversationalIntelligence: React.FC<ConversationalIntelligenceProps> = ({ statusData }) => {
  const { t, lang, setLang } = useLanguage();
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const runtimeState =
    statusData?.model?.runtimeState ||
    statusData?.connectivity?.runtimeState ||
    (statusData?.model?.weightsLoaded ? 'READY' : 'NOT_LOADED');
  const executionVerified =
    statusData?.model?.executionVerified ??
    statusData?.connectivity?.executionVerified ??
    false;
  const isModelReady = Boolean(statusData?.model?.weightsLoaded && executionVerified && runtimeState === 'READY');
  const isV2Active = statusData?.model?.activeKey === 'v2_2m' || statusData?.model?.activeKey === 'v2' || statusData?.model?.activeKey === 'v2_base';
  const activeModelBadge = !statusData?.model
    ? 'Awaiting Runtime Status'
    : !isModelReady
    ? `${runtimeState} (Fail-Closed)`
    : isV2Active
    ? 'Active: NativeLM v2 (2.0M)'
    : statusData.model.name || 'ZYNTHEOR Native Cloud Model';
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
  const [lastProvenance, setLastProvenance] = useState<Record<string, any> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSessions = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/chat/sessions'), {
        headers: authHeaders()
      });
      const data = await res.json();
      if (data.success && data.sessions.length > 0) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchSessions();
    }
  }, [authReady, isAuthenticated]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || {
    id: 'session-default',
    title: lang === 'th' ? 'เซสชันสั่งการและเหตุผลใหม่' : 'New Reasoning Session',
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

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || inputMessage;
    if (!textToSend.trim() || isStreaming) return;

    setInputMessage('');
    setIsStreaming(true);
    setStreamChunks('');
    setStreamThought('');
    setLiveTokenCount(0);
    setLastProvenance(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const startTime = Date.now();
    let firstTokenReceived = false;

    // Optimistically add user message to session in memory
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'user',
      content: textToSend,
      correlationId,
      timestamp: new Date().toISOString()
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              title: s.messages.length <= 1 ? textToSend.slice(0, 36) : s.title,
              messages: [...s.messages, userMsg]
            }
          : s
      )
    );

    try {
      const response = await fetch(apiUrl('/api/chat/message'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          ...authHeaders(),
          'X-Correlation-ID': correlationId
        },
        body: JSON.stringify({
          sessionId: activeSession.id,
          message: textToSend,
          correlationId,
          model: 'target_41m',
          maxNewTokens: 32,
          temperature: 0.8,
          topK: 20,
          repetitionPenalty: 1.08
        })
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('No stream returned');

      let accumulated = '';
      let tokenCounter = 0;

      await consumeNdjsonStream<Record<string, any>>(response, async (ev) => {
        if (ev.type === 'chunk') {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            setTtftMs(Math.max(1, Date.now() - startTime));
          }
          accumulated += ev.text;
          tokenCounter += 1;
          setLiveTokenCount(tokenCounter);
          const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
          setLiveThroughput(Number((tokenCounter / elapsedSec).toFixed(1)));

          // Render incoming chunks immediately; extract <thought> blocks only when explicitly emitted
          if (accumulated.includes('<thought>') && accumulated.includes('</thought>')) {
            const thoughtMatch = accumulated.match(/<thought>([\s\S]*?)<\/thought>/);
            if (thoughtMatch) {
              setStreamThought(thoughtMatch[1].trim());
              setStreamChunks(accumulated.replace(/<thought>[\s\S]*?<\/thought>/, '').trimStart());
            } else {
              setStreamChunks(accumulated);
            }
          } else if (accumulated.includes('<thought>')) {
            const [beforeThought, afterThought] = accumulated.split('<thought>');
            setStreamThought(afterThought);
            setStreamChunks(beforeThought);
          } else {
            setStreamChunks(accumulated);
          }
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Native inference failed');
        } else if (ev.type === 'done') {
          if (typeof ev.tokensPerSec === 'number') {
            setLiveThroughput(ev.tokensPerSec);
          }
          if (ev.inferenceOrigin || ev.weightsRole || ev.groundingOrigin) {
            setLastProvenance({
              inferenceOrigin: ev.inferenceOrigin,
              weightsRole: ev.weightsRole,
              groundingOrigin: ev.groundingOrigin,
              cancelled: Boolean(ev.cancelled),
              promptTruncated: Boolean(ev.promptTruncated),
            });
          }
          await fetchSessions();
          setStreamChunks('');
          setStreamThought('');
        }
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setLastProvenance({ cancelled: true, inferenceOrigin: 'cancelled' });
        const cancelMsg: ChatMessage = {
          id: `msg-${Date.now()}-cancelled`,
          sender: 'assistant',
          content: streamChunks
            ? `${streamChunks}\n\n[Inference cancelled by user]`
            : '[Inference cancelled by user]',
          correlationId,
          provenance: { cancelled: true },
          timestamp: new Date().toISOString()
        };
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, messages: [...s.messages, cancelMsg] } : s
          )
        );
      } else {
        console.error('Chat error:', err);
        const errMsg: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          sender: 'assistant',
          content: `Error: ${err?.message || 'Native inference request failed'}`,
          correlationId,
          timestamp: new Date().toISOString()
        };
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, messages: [...s.messages, errMsg] } : s
          )
        );
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamChunks('');
      setStreamThought('');
      fetchSessions();
    }
  };

  const handleCreateNewChat = () => {
    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: lang === 'th' ? 'เซสชันสั่งการและเหตุผลใหม่' : 'New Reasoning Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'assistant',
          content: !isModelReady
            ? (lang === 'th'
                ? `เริ่มต้นเซสชันสั่งการและให้เหตุผลแล้ว · สถานะ Runtime ปัจจุบัน: **${runtimeState}** (ยังไม่ได้ยืนยัน Model Weights ในหน่วยความจำ; ระบบจะไม่จำลองคำตอบหากไม่มี Checkpoint ออนไลน์)`
                : `Reasoning session initialized · Current runtime state: **${runtimeState}** (no resident model weights verified; inference stays fail-closed until online checkpoint is READY).`)
            : (lang === 'th'
                ? `ZYNTHEOR Native Core พร้อมรับคำสั่งเชิงเหตุผลและการอ้างอิงความรู้ (${activeModelBadge} · ${statusData?.model?.architecture || 'NativeLM'} ผ่าน Sovereign Cloud runtime)`
                : `ZYNTHEOR Native Core ready for grounded reasoning & command execution (${activeModelBadge} · ${statusData?.model?.architecture || 'NativeLM'} on Sovereign Cloud runtime).`),
          thought:
            `Runtime gate: ${runtimeState} · executionVerified=${String(executionVerified)} · Active source: ${statusData?.model?.weightsSource || 'unconfigured'}`,
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
      <VividCard gradientAccent="cyan" className="!p-4 intelligence-hero-card">
        <img className="intelligence-hero-art" src="/assets/zyntheor-rainbow-neural.svg" alt="" aria-hidden="true" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl vivid-gradient-brand flex items-center justify-center text-white font-black shadow-md shadow-[#00F0FF]/20">
              <Brain className="w-5 h-5 text-[#00F0FF]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-[var(--app-text-primary)] text-base">{t('chat.title')}</h2>
                <span className="text-[10px] font-mono font-semibold tracking-wide text-[#00F0FF]">
                  TH / EN
                </span>
              </div>
              <p className="text-xs text-[var(--app-text-secondary)] mt-0.5 truncate">
                {statusData?.model
                  ? `${activeModelBadge} · ${statusData.model.architecture || 'architecture unreported'} · ${statusData.model.weightsSource || 'source unconfigured'}`
                  : t('chat.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Language Toggle */}
            <button
              onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
              className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--app-input-bg)] hover:bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs font-semibold text-[var(--app-text-primary)] transition-colors cursor-pointer"
              title="Toggle Thai / English"
            >
              <Languages className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span>{lang === 'th' ? 'ไทย (TH)' : 'English (EN)'}</span>
            </button>

            <div className="hidden sm:flex items-center px-1">
              <StatusDot
                status={isModelReady ? 'READY' : (runtimeState as any)}
                label={isModelReady ? 'READY' : runtimeState}
                detail={statusData?.model?.failClosedReason || statusData?.model?.executionError || 'Execution-gated runtime state'}
                pulse={runtimeState === 'INITIALIZING'}
              />
            </div>
          </div>
        </div>
      </VividCard>

      {/* Main Chat Cockpit (2 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Chat Session List (3 cols) */}
        <div className="lg:col-span-3 space-y-3">
          <button
            onClick={handleCreateNewChat}
            className="min-h-[44px] w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'th' ? '+ เซสชันเหตุผลใหม่' : '+ New Reasoning Session'}</span>
          </button>

          <VividCard
            title={lang === 'th' ? 'ประวัติเซสชันคำสั่งและเหตุผล' : 'Reasoning Session History'}
            subtitle={lang === 'th' ? 'บันทึกผ่าน Sovereign Runtime API' : 'Persisted through the Sovereign Runtime API'}
            className="!p-3"
          >
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {sessions.map((sess) => (
                <button
                  key={sess.id}
                  onClick={() => setActiveSessionId(sess.id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-colors ${
                    activeSession.id === sess.id
                      ? 'bg-[#131B36] text-[#00F0FF] font-bold border border-[#00F0FF]/40'
                      : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 text-[#00F0FF]/80" />
                    <span className="truncate">{sess.title}</span>
                  </div>
                  <span className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums shrink-0">
                    {sess.messages.length}
                  </span>
                </button>
              ))}
            </div>
          </VividCard>
        </div>

        {/* Right: Active Chat Viewport (9 cols) */}
        <div className="lg:col-span-9 bg-[var(--app-surface)] rounded-3xl border border-[var(--app-card-border)] shadow-sm overflow-hidden flex flex-col h-[680px]">
          {/* Chat Messages Area */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6">
            {activeSession.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 text-xs leading-relaxed ${
                  msg.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl vivid-gradient-brand flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                    <Brain className="w-4 h-4 text-[#00F0FF]" />
                  </div>
                )}

                <div className={`max-w-3xl space-y-2 ${msg.sender === 'user' ? 'items-end' : ''}`}>
                  {msg.sender === 'assistant' ? (
                    <StreamingTokenDisplay
                      content={msg.content}
                      thoughtContent={msg.thought}
                      isStreaming={false}
                      tokenCount={Math.max(28, Math.round(msg.content.length / 3.8))}
                      tokensPerSec={liveThroughput}
                      activeModelName={activeModelBadge}
                    />
                  ) : (
                    <div className="p-4 rounded-2xl bg-[#131B36] border border-[#293763] text-[#F4F7FF] font-medium rounded-tr-sm shadow-md whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  )}

                  {/* Verifiable Knowledge Grounding Citation Cards */}
                  {msg.sender === 'assistant' && msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 p-3.5 rounded-2xl bg-[#070B19] border border-[#1E294A] space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[#00F0FF]">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-[#00F0FF]" />
                          {lang === 'th' ? `แหล่งข้อมูลอ้างอิงจริง (${msg.citations.length})` : `Verified Knowledge Citations (${msg.citations.length})`}
                        </span>
                        <StatusDot status="VERIFIED" label="GROUNDED" />
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {msg.citations.map((cite, cIdx) => (
                          <div key={cIdx} className="p-2.5 rounded-xl bg-[#0D1326] border border-[#1E294A] text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-semibold text-[#F4F7FF] truncate flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#00F0FF]" />
                                {cite.docTitle}
                              </span>
                              <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums">
                                <span className="text-[#FF5E3A] font-semibold">
                                  {cite.collection} #{cite.chunkIndex}
                                </span>
                                <span className="text-[#CCFF00] font-semibold">
                                  Relevance: {cite.score}
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-[#9AA8C7] italic line-clamp-2 bg-[#070B19] p-2 rounded-lg border border-[#1E294A]">
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
                          onClick={() => copyText(msg.id, msg.content)}
                          className="hover:text-[var(--app-text-primary)] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3 h-3 text-[#CCFF00]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedId === msg.id ? t('btn.copied') : t('btn.copy')}</span>
                        </button>

                        <button
                          onClick={() => setFeedbackGiven((prev) => ({ ...prev, [msg.id]: 'up' }))}
                          className={`hover:text-[var(--app-text-primary)] cursor-pointer transition-colors ${
                            feedbackGiven[msg.id] === 'up' ? 'text-[#CCFF00] font-bold' : ''
                          }`}
                        >
                          <ThumbsUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setFeedbackGiven((prev) => ({ ...prev, [msg.id]: 'down' }))}
                          className={`hover:text-[var(--app-text-primary)] cursor-pointer transition-colors ${
                            feedbackGiven[msg.id] === 'down' ? 'text-[#FF007F] font-bold' : ''
                          }`}
                        >
                          <ThumbsDown className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {msg.provenance?.cancelled && (
                          <span className="text-[10px] font-mono text-[#FF5E3A] font-semibold">
                            CANCELLED
                          </span>
                        )}
                        {msg.provenance?.inferenceOrigin && !msg.provenance?.cancelled && (
                          <span className="text-[10px] font-mono text-[#00F0FF]">
                            origin: {msg.provenance.inferenceOrigin}
                          </span>
                        )}
                        {msg.correlationId && (
                          <span className="text-[10px] font-mono text-[var(--app-text-secondary)] truncate max-w-[220px]">
                            Trace: {msg.correlationId}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Live Streaming Token Preview with Vivid Animation Component */}
            {isStreaming && (
              <div className="flex gap-3 text-xs leading-relaxed justify-start" aria-live="polite" aria-label="Streaming native response">
                <div className="w-8 h-8 rounded-xl vivid-gradient-brand flex items-center justify-center text-white shrink-0 mt-0.5">
                  <Brain className="w-4 h-4 text-[#00F0FF]" />
                </div>
                <div className="max-w-3xl flex-1">
                  <StreamingTokenDisplay
                    content={streamChunks}
                    thoughtContent={streamThought}
                    isStreaming={true}
                    tokenCount={liveTokenCount}
                    tokensPerSec={liveThroughput}
                    timeToFirstTokenMs={ttftMs}
                    activeModelName={activeModelBadge}
                  />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Prompt Suggestions */}
          <div className="px-4 sm:px-6 py-2.5 border-t border-[var(--app-card-border)] flex items-center gap-2 overflow-x-auto bg-[var(--app-bg)]/50">
            <span className="text-[10px] uppercase font-bold text-[var(--app-text-secondary)] shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[var(--app-accent)]" />
              {lang === 'th' ? 'ตัวอย่างคำสั่ง:' : 'Prompts:'}
            </span>
            {promptSuggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(s)}
                className="px-2.5 py-1 text-[11px] rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] hover:text-[var(--app-accent)] whitespace-nowrap transition-colors cursor-pointer font-medium shadow-2xs"
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
                    handleSendMessage();
                  }
                }}
                placeholder={t('chat.input_placeholder')}
                aria-label={t('chat.input_placeholder')}
                className="chat-composer-input"
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStopStreaming}
                  className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-[#FF007F]/15 text-[#FF66B2] border border-[#FF007F]/45 hover:bg-[#FF007F]/25 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                  aria-label="Stop streaming"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">{lang === 'th' ? 'หยุด' : 'Stop'}</span>
                </button>
              ) : (
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim()}
                  className="chat-send-button"
                  aria-label={t('btn.send')}
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('btn.send')}</span>
                </button>
              )}
            </div>
            <div className="chat-composer-meta">
              <span>
                {isStreaming
                  ? <><span className="live-dot" /> Native stream active · {liveTokenCount} tokens</>
                  : lastProvenance
                    ? `Last origin: ${lastProvenance.inferenceOrigin || 'unknown'}${lastProvenance.weightsRole ? ` · weights: ${lastProvenance.weightsRole}` : ''}${lastProvenance.groundingOrigin ? ` · grounding: ${lastProvenance.groundingOrigin}` : ''}`
                    : 'Enter to send · Shift + Enter for a new line'}
              </span>
              <span>{isStreaming ? `TTFT ${ttftMs} ms · ${liveThroughput.toLocaleString()} tok/s` : 'Sovereign runtime · no external AI inference'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
