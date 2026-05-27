'use client';

import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import type { MemoryOperationStep, ContextFact, GraphChatUsage } from '@memory-soda/types';
import { useProject } from '@/providers/project-provider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3004';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface TurnMeta {
  systemPrompt: string;
  memoryContext: ContextFact[];
  memoryLog: MemoryOperationStep[];
  usage: GraphChatUsage;
  latencyMs: number;
}

type RightTab = 'memory' | 'context' | 'metrics';

export default function PlaygroundPage() {
  const { selectedProject } = useProject();
  const [userId, setUserId] = useState('demo-user');
  const [systemPromptTemplate, setSystemPromptTemplate] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lastMeta, setLastMeta] = useState<TurnMeta | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('memory');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);


  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function sendMessage() {
    const content = input.trim();
    if (!content || sending) return;
    setError(null);
    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    try {
      const res = await axios.post(
        `${API_URL}/graph/chat`,
        {
          userId,
          messages: newMessages,
          systemPromptTemplate: systemPromptTemplate || undefined,
        },
        {},
      );

      const data = res.data;
      setMessages([...newMessages, { role: 'assistant', content: data.message }]);
      setLastMeta({
        systemPrompt: data.systemPrompt,
        memoryContext: data.memoryContext,
        memoryLog: data.memoryLog,
        usage: data.usage,
        latencyMs: data.latencyMs,
      });
      setRightTab('memory');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error ?? err.message : 'Unknown error';
      setError(msg);
      // Remove the user message on error
      setMessages(messages);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([]);
    setLastMeta(null);
  }

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-49px)] text-sm text-muted-foreground">
        Select or create a project to use the playground.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-49px)]">
      {/* Config bar */}
      <div className="border-b border-border px-4 py-2 bg-card flex items-center gap-4 flex-wrap text-sm">
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          {selectedProject.name}
        </span>
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground whitespace-nowrap">User ID</label>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-36 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <button
          onClick={() => setShowSystemPrompt((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSystemPrompt ? 'Hide' : 'System prompt'} ↕
        </button>

        <button
          onClick={clearChat}
          disabled={messages.length === 0}
          className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* System prompt */}
      {showSystemPrompt && (
        <div className="border-b border-border px-4 py-3 bg-muted/30">
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            System prompt template (memory context will be appended automatically)
          </label>
          <textarea
            value={systemPromptTemplate}
            onChange={(e) => setSystemPromptTemplate(e.target.value)}
            placeholder="You are a helpful, friendly assistant with memory..."
            rows={3}
            className="w-full text-sm rounded border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
          />
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Chat panel (left) */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                <div className="text-center space-y-1">
                  <p>Start a conversation to test memory.</p>
                  <p className="text-xs">Tell the AI something about yourself — it will remember it.</p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-muted-foreground">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
              {error}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message… (Enter to send, Shift+Enter for newline)"
                rows={1}
                disabled={sending}
                className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 max-h-40 overflow-y-auto"
                style={{ minHeight: '42px' }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                className="shrink-0 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[420px] shrink-0 flex flex-col min-h-0">
          {/* Tabs */}
          <div className="flex border-b border-border bg-card">
            {([['memory', 'Memory Steps'], ['context', 'Retrieved Context'], ['metrics', 'Metrics']] as const).map(
              ([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    rightTab === tab
                      ? 'border-b-2 border-primary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {!lastMeta ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4 text-center">
                Send a message to see memory operations here.
              </div>
            ) : rightTab === 'memory' ? (
              <MemoryStepsPanel log={lastMeta.memoryLog} />
            ) : rightTab === 'context' ? (
              <ContextPanel systemPrompt={lastMeta.systemPrompt} facts={lastMeta.memoryContext} />
            ) : (
              <MetricsPanel usage={lastMeta.usage} latencyMs={lastMeta.latencyMs} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Memory Steps Panel ────────────────────────────────────────────────────────

function MemoryStepsPanel({ log }: { log: MemoryOperationStep[] }) {
  if (log.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">No memory operations.</div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {log.map((step, i) => (
        <div
          key={i}
          className={`rounded-md px-3 py-2.5 text-xs border ${stepStyle(step.type)}`}
        >
          <div className="flex items-start gap-2">
            <span className="font-mono font-semibold shrink-0">{stepIcon(step.type)}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{step.message}</p>
              {step.fact && (
                <p className="mt-0.5 text-muted-foreground">
                  {step.fact.subject} → <span className="font-mono">{step.fact.predicate}</span> → {step.fact.object}
                  <span className="ml-1 opacity-60">({step.fact.subjectType} / {step.fact.objectType})</span>
                </p>
              )}
              {step.existingFact && (
                <p className="mt-0.5 text-muted-foreground italic">
                  existing: "{step.existingFact.text}"
                </p>
              )}
              {step.classification && (
                <span className={`inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${classificationStyle(step.classification)}`}>
                  {step.classification}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function stepIcon(type: MemoryOperationStep['type']): string {
  switch (type) {
    case 'extract': return '⟳';
    case 'resolve': return '◎';
    case 'classify': return '?';
    case 'create': return '+';
    case 'update': return '↑';
    case 'invalidate': return '✕';
    case 'skip': return '–';
    case 'retrieve': return '↓';
    default: return '·';
  }
}

function stepStyle(type: MemoryOperationStep['type']): string {
  switch (type) {
    case 'create': return 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30';
    case 'invalidate': return 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30';
    case 'update': return 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30';
    case 'classify': return 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30';
    default: return 'border-border bg-muted/30';
  }
}

function classificationStyle(c: string): string {
  switch (c) {
    case 'CONTRADICTION': return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
    case 'REINFORCEMENT': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400';
    case 'NEW': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

// ── Context Panel ─────────────────────────────────────────────────────────────

function ContextPanel({ systemPrompt, facts }: { systemPrompt: string; facts: ContextFact[] }) {
  return (
    <div className="p-3 space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Constructed system prompt</p>
        <pre className="text-xs bg-muted/50 rounded-md border border-border p-3 whitespace-pre-wrap font-mono leading-relaxed overflow-x-hidden break-words">
          {systemPrompt}
        </pre>
      </div>

      {facts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Retrieved facts ({facts.length})
          </p>
          <div className="space-y-1.5">
            {facts.map((f, i) => (
              <div key={i} className="text-xs rounded-md border border-border bg-card px-3 py-2">
                <p className="text-foreground">{f.text}</p>
                <p className="text-muted-foreground mt-0.5">
                  <span className="font-mono">{f.predicate}</span>
                  {f.score !== undefined && (
                    <span className="ml-2 opacity-60">score: {f.score.toFixed(3)}</span>
                  )}
                  <span className="ml-2 opacity-60">conf: {Math.round(f.confidence * 100)}%</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Metrics Panel ─────────────────────────────────────────────────────────────

function MetricsPanel({ usage, latencyMs }: { usage: GraphChatUsage; latencyMs: number }) {
  const rows = [
    { label: 'Model', value: 'gemini-2.5-flash' },
    { label: 'Response time', value: `${(latencyMs / 1000).toFixed(2)}s` },
    { label: 'Input tokens', value: usage.promptTokens.toLocaleString() },
    { label: 'Output tokens', value: usage.completionTokens.toLocaleString() },
    { label: 'Total tokens', value: usage.totalTokens.toLocaleString() },
  ];

  return (
    <div className="p-4">
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-muted-foreground font-medium w-40">{row.label}</td>
                <td className="px-4 py-2.5 font-mono">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
