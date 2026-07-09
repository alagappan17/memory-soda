import { Fragment, useEffect, useRef, useState } from 'react';
import type {
  MessageRole,
  WMAddMessageRequest,
  WMMessage,
} from '@memory-soda/types';
import { Markdown } from '../../components/markdown';
import { Card, CardContent } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';

// ── Message meta + detail card ────────────────────────────────────────────────
//
// `sequenceNumber` is the message's stable position within the thread (1, 2, 3…),
// assigned by the server on insert. It's used as the prepare/pagination cursor and
// to track what's been compacted (lastCompactedSequence), independent of timestamps.

function MessageMeta({ msg, isUser }: { msg: WMMessage; isUser: boolean }) {
  const tc = msg.tokenCount;
  const hasTokens = tc && (tc.input !== undefined || tc.output !== undefined);
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground font-mono ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <span className="font-sans">{time}</span>
      <span>·</span>
      <span>seq:{msg.sequenceNumber}</span>
      {hasTokens && (
        <>
          <span>·</span>
          {tc!.input !== undefined && (
            <span>↑{tc!.input.toLocaleString()}</span>
          )}
          {tc!.output !== undefined && (
            <span>↓{tc!.output.toLocaleString()}</span>
          )}
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

function MessageDetailCard({ msg }: { msg: WMMessage }) {
  const tc = msg.tokenCount;
  const hasTokens =
    tc &&
    (tc.input !== undefined ||
      tc.output !== undefined ||
      tc.total !== undefined);
  const time = new Date(msg.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <Card className="shadow-xl border-border text-xs w-72">
      <CardContent className="p-3 space-y-2.5">
        <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
          <span className="text-muted-foreground">Message</span>
          <span className="font-mono text-[10px] truncate">
            {msg.messageId}
          </span>
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
              <span className="font-mono">
                {msg.latencyMs.toLocaleString()} ms
              </span>
            </>
          )}
          {msg.metadata?.agentName && (
            <>
              <span className="text-muted-foreground">Agent</span>
              <span className="font-mono">{msg.metadata.agentName}</span>
            </>
          )}
          {msg.metadata?.stopReason && (
            <>
              <span className="text-muted-foreground">Stop reason</span>
              <span className="font-mono">{msg.metadata.stopReason}</span>
            </>
          )}
          {msg.compactedAt && (
            <>
              <span className="text-muted-foreground">Compacted</span>
              <span>
                {new Date(msg.compactedAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </>
          )}
        </div>

        {tc && hasTokens && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground font-medium mb-1.5">Tokens</p>
              <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
                {(
                  [
                    ['Input', tc.input],
                    ['Output', tc.output],
                    ['Total', tc.total],
                  ] as const
                )
                  .filter(([, v]) => v !== undefined)
                  .map(([label, v]) => (
                    <Fragment key={label}>
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono">{v!.toLocaleString()}</span>
                    </Fragment>
                  ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Manual message form ───────────────────────────────────────────────────────

const ROLES: MessageRole[] = ['user', 'assistant', 'system', 'tool'];

function ManualMessageForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (req: WMAddMessageRequest) => Promise<boolean>;
  disabled: boolean;
}) {
  const [role, setRole] = useState<MessageRole>('user');
  const [content, setContent] = useState('');
  const [model, setModel] = useState('');
  const [latencyMs, setLatencyMs] = useState('');
  const [tokensIn, setTokensIn] = useState('');
  const [tokensOut, setTokensOut] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!content.trim() || submitting || disabled) return;
    setSubmitting(true);
    const input = tokensIn ? parseInt(tokensIn, 10) : undefined;
    const output = tokensOut ? parseInt(tokensOut, 10) : undefined;
    const req: WMAddMessageRequest = { role, content: content.trim() };
    if (model.trim()) req.model = model.trim();
    if (latencyMs) req.latencyMs = parseInt(latencyMs, 10);
    if (input !== undefined || output !== undefined) {
      req.tokenCount = {
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        total: (input ?? 0) + (output ?? 0),
      };
    }
    const ok = await onSubmit(req);
    if (ok) setContent('');
    setSubmitting(false);
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as MessageRole)}
          className="rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model (optional)"
          className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
        />
        <input
          value={latencyMs}
          onChange={(e) => setLatencyMs(e.target.value.replace(/\D/g, ''))}
          placeholder="latency ms"
          className="w-20 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          value={tokensIn}
          onChange={(e) => setTokensIn(e.target.value.replace(/\D/g, ''))}
          placeholder="tokens in"
          className="w-24 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
        />
        <input
          value={tokensOut}
          onChange={(e) => setTokensOut(e.target.value.replace(/\D/g, ''))}
          placeholder="tokens out"
          className="w-24 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
        />
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Raw ${role} message content…`}
          rows={2}
          className="flex-1 text-xs rounded border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || !content.trim() || submitting}
          className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-40 transition-colors"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Calls addMessage directly — inserts into the thread without triggering
        an AI reply. Demos tool/system messages, tokenCount, model, latencyMs.
      </p>
    </div>
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────

export function ChatPanel({
  messages,
  sending,
  error,
  onSend,
  onAddManualMessage,
  apiKeySet,
  inputRef,
}: {
  messages: WMMessage[];
  sending: boolean;
  error: string | null;
  onSend: (content: string, systemPrompt: string) => void;
  onAddManualMessage: (req: WMAddMessageRequest) => Promise<boolean>;
  apiKeySet: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  // Draft text stays local so keystrokes don't re-render the whole page
  // (markdown re-parse of every message + all four tabs).
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const canSend = apiKeySet && !!input.trim() && !sending;

  function send() {
    if (!canSend) return;
    const content = input.trim();
    setInput('');
    onSend(content, systemPrompt);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
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

      {/* Manual raw message */}
      <div className="border-b border-border shrink-0">
        <button
          onClick={() => setShowManual((v) => !v)}
          className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors text-left"
        >
          <span className="font-mono">{showManual ? '▾' : '▸'}</span>
          Add raw message
        </button>
        {showManual && (
          <ManualMessageForm
            onSubmit={onAddManualMessage}
            disabled={!apiKeySet || sending}
          />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !sending && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <div className="text-center space-y-1">
              <p>No messages yet.</p>
              <p className="text-xs">
                {apiKeySet
                  ? 'Type a message to start a thread.'
                  : 'Enter your API key above first.'}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isTool = msg.role === 'tool';
          return (
            <div
              key={msg.sequenceNumber}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[78%] flex flex-col group/msg relative ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.compactedAt
                      ? 'opacity-35 line-through decoration-muted-foreground'
                      : isUser
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : msg.role === 'system'
                          ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-bl-sm dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200'
                          : isTool
                            ? 'bg-muted/50 border border-border font-mono text-xs rounded-bl-sm'
                            : 'bg-muted rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'system' && (
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
                      {msg.metadata &&
                      (msg.metadata as Record<string, unknown>)['type'] ===
                        'compact_summary'
                        ? 'compact summary'
                        : 'system'}
                    </span>
                  )}
                  {isTool && (
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      tool
                    </span>
                  )}
                  {msg.role === 'assistant' ? (
                    <Markdown>{msg.content}</Markdown>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                  {msg.compactedAt && (
                    <span
                      className="block text-[10px] text-muted-foreground mt-1 no-underline"
                      style={{ textDecoration: 'none' }}
                    >
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

        {(messages.length > 0 || sending) && (
          <div ref={messagesEndRef} className="h-6" />
        )}
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
            onClick={send}
            disabled={!canSend}
            className="shrink-0 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
