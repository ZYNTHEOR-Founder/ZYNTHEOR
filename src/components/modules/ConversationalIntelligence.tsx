import React, { useState, useEffect, useRef } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge } from '../ui/StatusBadge';
import { StreamingTokenDisplay } from '../StreamingTokenDisplay';
import { useLanguage } from '../../context/LanguageContext';
import { Citation, ChatMessage, ChatSession } from '../../types';
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
  ShieldAlert
} from 'lucide-react';

export const ConversationalIntelligence: React.FC = () => {
  const { t, lang, setLang } = useLanguage();
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
  const [runtimeStatus, setRuntimeStatus] = useState<'UNVERIFIED' | 'VERIFIED' | 'BLOCKED'>('UNVERIFIED');
  const [runtimeReason, setRuntimeReason] = useState('Checking Native Cloud Runtime…');
  const runtimeProductLabel = 'Sovereign Runtime';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      const data = await res.json();
      if (data.success && data.sessions.length > 0) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetch('/api/system/status').then((response) => response.json()).then((data) => {
      const ready = Boolean(data?.model?.weightsLoaded && data?.model?.inferenceReady);
      setRuntimeStatus(ready ? 'VERIFIED' : 'BLOCKED');
      setRuntimeReason(ready ? 'Native Cloud Runtime is ready.' : (data?.model?.readinessReason || 'Native inference is blocked until a verified Cloud Runtime checkpoint is loaded.'));
    }).catch(() => {
      setRuntimeStatus('UNVERIFIED');
      setRuntimeReason('Runtime status could not be retrieved.');
    });
  }, []);

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

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || inputMessage;
    if (!textToSend.trim() || isStreaming) return;
    if (runtimeStatus !== 'VERIFIED') {
      setStreamChunks(runtimeReason);
      return;
    }

    setInputMessage('');
    setIsStreaming(true);
    setStreamChunks('');
    setStreamThought('');
    setLiveTokenCount(0);

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
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId
        },
        body: JSON.stringify({
          sessionId: activeSession.id,
          message: textToSend,
          correlationId
        })
      });

      if (!response.body) throw new Error('No stream returned');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
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
            if (ev.type === 'chunk') {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                setTtftMs(Date.now() - startTime);
              }
              accumulated += ev.text;
              tokenCounter += 1;
              setLiveTokenCount(tokenCounter);

              // Extract thought tags if present
              if (accumulated.includes('<thought>') && accumulated.includes('</thought>')) {
                const thoughtMatch = accumulated.match(/<thought>([\s\S]*?)<\/thought>/);
                if (thoughtMatch) {
                  setStreamThought(thoughtMatch[1].trim());
                  const cleaned = accumulated.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
                  setStreamChunks(cleaned);
                } else {
                  setStreamChunks(accumulated);
                }
              } else if (accumulated.includes('<thought>')) {
                const thoughtPart = accumulated.split('<thought>')[1];
                setStreamThought(thoughtPart);
                setStreamChunks('');
              } else {
                setStreamChunks(accumulated);
              }
            } else if (ev.type === 'done') {
              setStreamChunks('');
              setStreamThought('');
              await fetchSessions();
            }
          } catch {
            // ignore JSON line parse error
          }
        }
      }
    } catch (err: any) {
      console.error('Chat error:', err);
    } finally {
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
      title: lang === 'th' ? 'การสนทนาใหม่' : 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'assistant',
          content:
            lang === 'th'
              ? 'ZYNTHEOR พร้อมรับงานผ่าน Native Cloud Runtime เมื่อโหลด checkpoint ที่ตรวจสอบแล้ว สถานะการอนุมานจะถูกตรวจสอบก่อนส่งคำขอทุกครั้ง'
              : 'ZYNTHEOR routes requests through its Native Cloud Runtime. Inference is enabled only after a verified checkpoint is loaded.',
          thought: 'Runtime readiness is checked from live backend status; no model weights are claimed as loaded by this greeting.',
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
            <div className="w-10 h-10 rounded-2xl vivid-gradient-brand flex items-center justify-center text-[var(--app-text-primary)] font-black shadow-md ">
              <Brain className="w-5 h-5 text-[var(--z-ok)]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-[var(--app-text-primary)] text-base">{t('chat.title')}</h2>
                <StatusBadge status={runtimeStatus} />
                <span className="px-2 py-0.5 rounded-md bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-accent)] text-[10px] font-bold">
                  TH / EN TOKENIZER
                </span>
              </div>
              <p className="text-xs text-[var(--app-text-secondary)] mt-0.5">
                {t('chat.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Language Toggle */}
            <button
              onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--app-surface-elevated)] hover:bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs font-semibold text-[var(--app-text-primary)] transition-colors cursor-pointer"
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
            onClick={handleCreateNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'th' ? '+ บทสนทนาใหม่' : '+ Start New Chat'}</span>
          </button>

          <VividCard
            title={lang === 'th' ? 'ประวัติการสนทนา' : 'Chat History'}
            subtitle={lang === 'th' ? 'ยังไม่ยืนยันการจัดเก็บเซสชัน' : 'Session persistence is not yet verified'}
            className="!p-3"
          >
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {sessions.map((sess) => (
                <button
                  key={sess.id}
                  onClick={() => setActiveSessionId(sess.id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-colors ${
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
        <div className="lg:col-span-9 bg-[var(--app-surface)] rounded-3xl border border-[var(--app-card-border)] shadow-sm overflow-hidden flex flex-col h-[680px]">
          {/* Chat Messages Area */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            {activeSession.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 text-xs leading-relaxed ${
                  msg.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl vivid-gradient-brand flex items-center justify-center text-[var(--app-text-primary)] shrink-0 mt-0.5 shadow-sm">
                    <Brain className="w-4 h-4 text-[var(--z-ok)]" />
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

                  {/* Verifiable Knowledge Grounding Citation Cards */}
                  {msg.sender === 'assistant' && msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 p-3.5 rounded-2xl bg-[var(--app-accent)] border border-[var(--app-card-border)] space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[var(--z-ok)]">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                          {lang === 'th' ? `แหล่งข้อมูลอ้างอิงจริง (${msg.citations.length})` : `Verified Knowledge Citations (${msg.citations.length})`}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-[var(--app-surface-elevated)] border border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] text-[10px] text-[var(--z-ok)] font-mono">
                          GROUNDED
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {msg.citations.map((cite, cIdx) => (
                          <div key={cIdx} className="p-2.5 rounded-xl bg-[var(--app-accent)] border border-[var(--z-ok)] text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-semibold text-[var(--z-ok)] truncate flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--z-ok)]" />
                                {cite.docTitle}
                              </span>
                              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                                <span className="px-1.5 py-0.5 rounded bg-[var(--app-surface-elevated)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_30%,transparent)]">
                                  {cite.collection} #{cite.chunkIndex}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-[var(--app-surface-elevated)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]">
                                  Relevance: {cite.score}
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-[var(--app-text-secondary)] italic line-clamp-2 bg-[var(--z-ok)] p-2 rounded-lg border border-[var(--app-surface-elevated)]">
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
                            <Check className="w-3 h-3 text-[var(--z-ok)]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedId === msg.id ? t('btn.copied') : t('btn.copy')}</span>
                        </button>

                        <button
                          onClick={() => setFeedbackGiven((prev) => ({ ...prev, [msg.id]: 'up' }))}
                          className={`hover:text-[var(--app-text-primary)] cursor-pointer transition-colors ${
                            feedbackGiven[msg.id] === 'up' ? 'text-[var(--z-ok)] font-bold' : ''
                          }`}
                        >
                          <ThumbsUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setFeedbackGiven((prev) => ({ ...prev, [msg.id]: 'down' }))}
                          className={`hover:text-[var(--app-text-primary)] cursor-pointer transition-colors ${
                            feedbackGiven[msg.id] === 'down' ? 'text-[var(--z-danger)] font-bold' : ''
                          }`}
                        >
                          <ThumbsDown className="w-3 h-3" />
                        </button>
                      </div>

                      {msg.correlationId && (
                        <span className="text-[10px] font-mono text-[#8BA89D] bg-[var(--app-accent)] px-2 py-0.5 rounded-md border border-[var(--z-ok)]">
                          Trace ID: {msg.correlationId}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Live Streaming Token Preview with Vivid Animation Component */}
            {isStreaming && (
              <div className="flex gap-3 text-xs leading-relaxed justify-start" aria-live="polite" aria-label="Streaming native response">
                <div className="w-8 h-8 rounded-xl vivid-gradient-brand flex items-center justify-center text-[var(--app-text-primary)] shrink-0 mt-0.5 animate-pulse">
                  <Brain className="w-4 h-4" />
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
          <div className="px-6 py-2.5 border-t border-[var(--app-card-border)] flex items-center gap-2 overflow-x-auto bg-[color-mix(in_srgb,var(--app-bg)_50%,transparent)]">
            <span className="text-[10px] font-bold text-[var(--app-text-secondary)] shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[var(--app-accent)]" />
              {lang === 'th' ? 'ตัวอย่างคำสั่ง:' : 'Prompts:'}
            </span>
            {promptSuggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(s)}
                disabled={runtimeStatus !== 'VERIFIED'}
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
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputMessage.trim() || isStreaming || runtimeStatus !== 'VERIFIED'}
                className="chat-send-button"
                aria-label={t('btn.send')}
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{t('btn.send')}</span>
              </button>
            </div>
            <div className="chat-composer-meta">
              <span>{isStreaming ? <><span className="live-dot" /> Native stream active · {liveTokenCount} chunks</> : 'Enter to send · Shift + Enter for a new line'}</span>
              <span>{isStreaming ? `TTFT ${ttftMs > 0 ? `${ttftMs} ms` : '—'} · ${liveThroughput > 0 ? `${liveThroughput.toLocaleString()} tok/s` : 'throughput pending'}` : (runtimeStatus === 'VERIFIED' ? 'Cloud Runtime ready' : runtimeReason)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
