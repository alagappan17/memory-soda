import { useState, useRef, useEffect } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Separator } from '../components/ui/separator';

// ── API ───────────────────────────────────────────────────────────────────────

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3004';
const BASE = `${API_URL}/v1/memory/working`;

async function wmFetch<T>(apiKey: string, path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sequenceNumber: number;
  tokenCount: { input?: number; output?: number; total?: number } | null;
  model: string | null;
  latencyMs: number | null;
  compactedAt: string | null;
  createdAt: string;
}

interface WMSettings {
  autoCompactEnabled: boolean;
  autoCompactThreshold: number;
  messageLimit: number;
}

type OpType = 'thread_created' | 'message_added' | 'ai_replied' | 'prepare' | 'auto_compacted' | 'compacted' | 'error';

interface Operation {
  id: number;
  type: OpType;
  ts: number;
  data: unknown;
}

// ── Message meta + detail card ────────────────────────────────────────────────
//
// `sequenceNumber` is the message's stable position within the thread (1, 2, 3…),
// assigned by the server on insert. It's used as the prepare/pagination cursor and
// to track what's been compacted (lastCompactedSequence), independent of timestamps.

function MessageMeta({ msg, isUser }: { msg: ChatMessage; isUser: boolean }) {
  const tc = msg.tokenCount;
  const hasTokens = tc && (tc.input !== undefined || tc.output !== undefined);
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground font-mono ${isUser ? 'flex-row-reverse' : ''}`}>
      <span className="font-sans">{time}</span>
      <span>·</span>
      <span>seq:{msg.sequenceNumber}</span>
      {hasTokens && (
        <>
          <span>·</span>
          {tc!.input !== undefined && <span>↑{tc!.input.toLocaleString()}</span>}
          {tc!.output !== undefined && <span>↓{tc!.output.toLocaleString()}</span>}
        </>
      )}
      {msg.model && (
        <>
          <span>·</span>
          <span>{msg.model}</span>
        </>
      )}
    </div>
  );
}

function MessageDetailCard({ msg }: { msg: ChatMessage }) {
  const tc = msg.tokenCount;
  const hasTokens = tc && (tc.input !== undefined || tc.output !== undefined || tc.total !== undefined);
  const time = new Date(msg.createdAt).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <Card className="shadow-xl border-border text-xs w-72">
      <CardContent className="p-3 space-y-2.5">
        <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
          <span className="text-muted-foreground">Message</span>
          <span className="font-mono text-[10px] truncate">{msg.messageId}</span>
          <span className="text-muted-foreground">Role</span>
          <span className="font-medium capitalize">{msg.role}</span>
          <span className="text-muted-foreground">Sequence</span>
          <span className="font-mono">#{msg.sequenceNumber}</span>
          <span className="text-muted-foreground">Created</span>
          <span>{time}</span>
          {msg.model && (
            <>
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono">{msg.model}</span>
            </>
          )}
          {msg.latencyMs !== null && (
            <>
              <span className="text-muted-foreground">Latency</span>
              <span className="font-mono">{msg.latencyMs.toLocaleString()} ms</span>
            </>
          )}
          {msg.compactedAt && (
            <>
              <span className="text-muted-foreground">Compacted</span>
              <span>{new Date(msg.compactedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </>
          )}
        </div>

        {hasTokens && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground font-medium mb-1.5">Tokens</p>
              <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
                {tc!.input !== undefined && (
                  <>
                    <span className="text-muted-foreground">Input</span>
                    <span className="font-mono">{tc!.input.toLocaleString()}</span>
                  </>
                )}
                {tc!.output !== undefined && (
                  <>
                    <span className="text-muted-foreground">Output</span>
                    <span className="font-mono">{tc!.output.toLocaleString()}</span>
                  </>
                )}
                {tc!.total !== undefined && (
                  <>
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-mono">{tc!.total.toLocaleString()}</span>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

let opIdSeq = 0;
let requestIdSeq = 0;

export default function PlaygroundPage() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadStartedAt, setThreadStartedAt] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentRequestId, setCurrentRequestId] = useState<number | null>(null);

  const [settings, setSettings] = useState<WMSettings>({
    autoCompactEnabled: false,
    autoCompactThreshold: 10,
    messageLimit: 20,
  });
  const [settingsOpen, setSettingsOpen] = useState(true);

  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const [ops, setOps] = useState<Operation[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const opsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    opsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ops]);

  function addOp(type: OpType, data: unknown) {
    setOps((prev) => [...prev, { id: ++opIdSeq, type, ts: Date.now(), data }]);
  }

  function relTime(ts: number) {
    if (!threadStartedAt) return '+0.0s';
    return `+${((ts - threadStartedAt) / 1000).toFixed(1)}s`;
  }

  async function refreshMessages(key: string, tid: string) {
    const result = await wmFetch<{ messages: ChatMessage[] }>(key, `/threads/${tid}/messages?limit=100&order=asc`);
    setMessages(result.messages);
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || sending || compacting || !apiKey.trim()) return;
    setError(null);
    setSending(true);
    setInput('');

    const requestId = ++requestIdSeq;
    setCurrentRequestId(requestId);

    try {
      let tid = threadId;
      const startedAt = threadStartedAt ?? Date.now();

      if (!tid) {
        const threadRes = await wmFetch<{ threadId: string }>(apiKey, '/threads', {
          method: 'POST',
          body: JSON.stringify({
            autoCompactThreshold:
              settings.autoCompactEnabled ? settings.autoCompactThreshold : undefined,
          }),
        });
        tid = threadRes.threadId;
        setThreadId(tid);
        setThreadStartedAt(startedAt);
        addOp('thread_created', {
          threadId: tid,
          autoCompact: settings.autoCompactEnabled ? settings.autoCompactThreshold : 'off',
        });
      }

      // Optimistically show the user's message immediately
      const optimisticSeq = (messages[messages.length - 1]?.sequenceNumber ?? 0) + 1;
      const optimisticId = `optimistic-${optimisticSeq}`;
      setMessages((prev) => [
        ...prev,
        {
          messageId: optimisticId,
          role: 'user',
          content,
          sequenceNumber: optimisticSeq,
          tokenCount: null,
          model: null,
          latencyMs: null,
          compactedAt: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      const chatRes = await wmFetch<{
        userMessage: { messageId: string; sequenceNumber: number; role: string; createdAt: string };
        assistantMessage: { messageId: string; sequenceNumber: number; role: string; content: string; createdAt: string };
        compacted: boolean;
        prepare: { messageCount: number; truncated: boolean; compacted: boolean };
      }>(apiKey, `/threads/${tid}/chat`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          systemPrompt: systemPrompt.trim() || undefined,
          messageLimit: settings.messageLimit,
        }),
      });

      addOp('message_added', {
        role: 'user',
        sequenceNumber: chatRes.userMessage.sequenceNumber,
        compacted: chatRes.compacted,
      });
      addOp('prepare', {
        messageCount: chatRes.prepare.messageCount,
        truncated: chatRes.prepare.truncated,
        compacted: chatRes.prepare.compacted,
      });
      addOp('ai_replied', {
        sequenceNumber: chatRes.assistantMessage.sequenceNumber,
        preview: chatRes.assistantMessage.content.slice(0, 120),
      });

      if (chatRes.compacted) {
        addOp('auto_compacted', { triggered: true, summary: 'Auto-compaction triggered after message threshold' });
      }

      if (requestId === currentRequestId) {
        // Remove optimistic message before refreshing with real data
        setMessages((prev) => prev.filter((m) => m.messageId !== optimisticId));
        await refreshMessages(apiKey, tid);
      }
    } catch (err: unknown) {
      if (requestId === currentRequestId) {
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.messageId !== optimisticId));
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        addOp('error', { message: msg });
      }
    } finally {
      if (requestId === currentRequestId) {
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  }

  async function compactNow() {
    if (!threadId || !apiKey.trim() || compacting) return;
    setCompacting(true);
    setError(null);

    const requestId = ++requestIdSeq;
    setCurrentRequestId(requestId);

    try {
      const result = await wmFetch<{
        summaryMessageId: string;
        compactedCount: number;
        fromSequence: number;
        toSequence: number;
      }>(apiKey, `/threads/${threadId}/compact`, { method: 'POST' });

      // Fetch summary text from prepare
      const prepRes = await wmFetch<{
        messages: { role: string; content: string }[];
        messageCount: number;
        truncated: boolean;
        compacted: boolean;
      }>(apiKey, `/threads/${threadId}/prepare`, {
        method: 'POST',
        body: JSON.stringify({ messageLimit: settings.messageLimit }),
      });

      const summary = prepRes.messages.find((m) => m.role === 'system');

      addOp('compacted', {
        compactedCount: result.compactedCount,
        fromSequence: result.fromSequence,
        toSequence: result.toSequence,
        summary: summary?.content ?? '(summary not found)',
      });

      addOp('prepare', {
        messageCount: prepRes.messageCount,
        truncated: prepRes.truncated,
        compacted: prepRes.compacted,
        roles: prepRes.messages.map((m) => m.role),
        contextPreview: prepRes.messages
          .map((m) => `[${m.role}]: ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`)
          .join('\n'),
      });

      if (requestId === currentRequestId) {
        await refreshMessages(apiKey, threadId);
      }
    } catch (err: unknown) {
      if (requestId === currentRequestId) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        addOp('error', { message: msg });
      }
    } finally {
      if (requestId === currentRequestId) {
        setCompacting(false);
      }
    }
  }

  function newThread() {
    setThreadId(null);
    setThreadStartedAt(null);
    setMessages([]);
    setOps([]);
    setError(null);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const hasThread = !!threadId;
  const canSend = !!apiKey.trim() && !!input.trim() && !sending;


  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar — API key + actions */}
      <div className="border-b border-border px-4 py-2 bg-card flex items-center gap-3 flex-wrap text-sm shrink-0">
        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">API Key</span>
        <div className="flex items-center gap-1 flex-1 min-w-0 max-w-xs">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setThreadId(null);
              setThreadStartedAt(null);
              setMessages([]);
              setOps([]);
              setError(null);
            }}
            placeholder="ms_..."
            className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring font-mono"
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-1.5 py-1 rounded transition-colors"
          >
            {showKey ? 'hide' : 'show'}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={compactNow}
            disabled={!hasThread || !apiKey.trim() || compacting || sending}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            {compacting ? 'Compacting…' : 'Compact now'}
          </button>
          <button
            onClick={newThread}
            disabled={sending || compacting}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            New thread
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT — Chat */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">
          {/* System prompt */}
          <div className="border-b border-border shrink-0">
            <button
              onClick={() => setShowSystemPrompt((v) => !v)}
              className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors text-left"
            >
              <span className="font-mono">{showSystemPrompt ? '▾' : '▸'}</span>
              System prompt
            </button>
            {showSystemPrompt && (
              <div className="px-4 pb-3">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful assistant…"
                  rows={3}
                  className="w-full text-xs rounded border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sent to the AI with each message (user role only).
                </p>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && !sending && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                <div className="text-center space-y-1">
                  <p>No messages yet.</p>
                  <p className="text-xs">
                    {apiKey.trim() ? 'Type a message to start a thread.' : 'Enter your API key above first.'}
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.sequenceNumber}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[78%] flex flex-col group/msg relative ${isUser ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.compactedAt
                          ? 'opacity-35 line-through decoration-muted-foreground'
                          : isUser
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : msg.role === 'system'
                          ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-bl-sm dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200'
                          : 'bg-muted rounded-bl-sm'
                      }`}
                    >
                      {msg.role === 'system' && (
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
                          compact summary
                        </span>
                      )}
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                      {msg.compactedAt && (
                        <span className="block text-[10px] text-muted-foreground mt-1 no-underline" style={{ textDecoration: 'none' }}>
                          compacted
                        </span>
                      )}
                    </div>
                    <MessageMeta msg={msg} isUser={isUser} />

                    {/* Detail card on hover */}
                    <div
                      className={`absolute ${isUser ? 'right-0' : 'left-0'} top-full mt-1 z-50
                        invisible opacity-0 group-hover/msg:visible group-hover/msg:opacity-100
                        transition-opacity duration-150 pointer-events-none`}
                    >
                      <MessageDetailCard msg={msg} />
                    </div>
                  </div>
                </div>
              );
            })}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-muted-foreground">
                  <span className="animate-pulse">Thinking…</span>
                </div>
              </div>
            )}

            {(messages.length > 0 || sending) && <div ref={messagesEndRef} className="h-6" />}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs shrink-0">
              {error}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border px-4 py-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message… (Enter to send)"
                rows={1}
                disabled={sending}
                className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 max-h-40 overflow-y-auto"
                style={{ minHeight: '42px' }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!canSend}
                className="shrink-0 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — Settings + Operations */}
        <div className="w-[400px] shrink-0 flex flex-col min-h-0">
          {/* Settings panel */}
          <div className="border-b border-border shrink-0">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors bg-card"
            >
              <span className="font-mono">{settingsOpen ? '▾' : '▸'}</span>
              Working Memory Settings
            </button>

            {settingsOpen && (
              <div className="px-4 pb-4 pt-1 bg-card space-y-3">
                {/* Auto-compact toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Auto-compact</label>
                  <button
                    onClick={() =>
                      setSettings((s) => ({ ...s, autoCompactEnabled: !s.autoCompactEnabled }))
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      settings.autoCompactEnabled ? 'bg-primary' : 'bg-input'
                    }`}
                    disabled={hasThread}
                    title={hasThread ? 'Cannot change after thread is started' : undefined}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        settings.autoCompactEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Threshold */}
                {settings.autoCompactEnabled && (
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Compact threshold
                      <span className="block text-[10px] opacity-60">messages before compact</span>
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={500}
                      value={settings.autoCompactThreshold}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          autoCompactThreshold: Math.max(2, parseInt(e.target.value, 10) || 2),
                        }))
                      }
                      disabled={hasThread}
                      className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    />
                  </div>
                )}

                {/* Message limit */}
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    Message limit
                    <span className="block text-[10px] opacity-60">messages fetched for prepare</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.messageLimit}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        messageLimit: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 20)),
                      }))
                    }
                    className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {hasThread && (
                  <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
                    Thread active — start a new thread to change compact settings.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Operations log */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-3 py-2 border-b border-border bg-card sticky top-0 z-10">
              <p className="text-xs font-medium text-muted-foreground">Memory Operations</p>
            </div>

            {ops.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
                Operations will appear here as you interact with the thread.
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {ops.map((op) => (
                  <OperationEntry key={op.id} op={op} relTime={relTime(op.ts)} />
                ))}
                <div ref={opsEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Operation Entry ───────────────────────────────────────────────────────────

function OperationEntry({ op, relTime }: { op: Operation; relTime: string }) {
  const [expanded, setExpanded] = useState(false);

  const { label, subtitle, borderColor, bgColor, icon } = opMeta(op);

  return (
    <div
      className={`rounded-md border-l-2 text-xs cursor-pointer select-none ${borderColor} ${bgColor}`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="font-mono shrink-0 text-[11px] mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{label}</span>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{relTime}</span>
          </div>
          {subtitle && (
            <p className="text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        <span className="text-muted-foreground text-[10px] shrink-0 mt-0.5">
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div className="border-t border-border/50 mx-3 mb-2 pt-2">
          <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
            {formatData(op.data)}
          </pre>
        </div>
      )}
    </div>
  );
}

function opMeta(op: Operation): {
  label: string;
  subtitle: string;
  borderColor: string;
  bgColor: string;
  icon: string;
} {
  const d = op.data as Record<string, unknown>;

  switch (op.type) {
    case 'thread_created':
      return {
        label: 'Thread created',
        subtitle: `id: ${String(d['threadId']).slice(0, 8)}… · auto-compact: ${d['autoCompact']}`,
        borderColor: 'border-emerald-400 dark:border-emerald-600',
        bgColor: 'bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
        icon: '✦',
      };
    case 'message_added':
      return {
        label: `Message added`,
        subtitle: `role: ${d['role']} · seq: ${d['sequenceNumber']}${d['compacted'] ? ' · auto-compacted' : ''}`,
        borderColor: 'border-blue-400 dark:border-blue-600',
        bgColor: 'bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30',
        icon: '→',
      };
    case 'ai_replied':
      return {
        label: 'AI replied',
        subtitle: `seq: ${d['sequenceNumber']} · ${String(d['preview']).slice(0, 55)}${String(d['preview']).length > 55 ? '…' : ''}`,
        borderColor: 'border-teal-400 dark:border-teal-600',
        bgColor: 'bg-teal-50/60 dark:bg-teal-950/20 hover:bg-teal-50 dark:hover:bg-teal-950/30',
        icon: '✦',
      };
    case 'prepare':
      return {
        label: 'Prepare',
        subtitle: `${d['messageCount']} msgs · compacted: ${d['compacted']}${d['truncated'] ? ' · truncated' : ''}`,
        borderColor: 'border-violet-400 dark:border-violet-600',
        bgColor: 'bg-violet-50/60 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/30',
        icon: '⟳',
      };
    case 'auto_compacted':
      return {
        label: 'Auto-compacted',
        subtitle: String(d['summary']).slice(0, 60) + (String(d['summary']).length > 60 ? '…' : ''),
        borderColor: 'border-orange-400 dark:border-orange-600',
        bgColor: 'bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/30',
        icon: '⊙',
      };
    case 'compacted':
      return {
        label: 'Manual compact',
        subtitle: `${d['compactedCount']} msgs · seq ${d['fromSequence']}–${d['toSequence']}`,
        borderColor: 'border-orange-400 dark:border-orange-600',
        bgColor: 'bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/30',
        icon: '⊙',
      };
    case 'error':
      return {
        label: 'Error',
        subtitle: String(d['message']),
        borderColor: 'border-red-400 dark:border-red-600',
        bgColor: 'bg-red-50/60 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30',
        icon: '✕',
      };
  }
}

function formatData(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        return `${k}: ${val}`;
      })
      .join('\n');
  }
  return String(data);
}
