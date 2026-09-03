import { Fragment, useEffect, useRef, useState } from 'react';
import type {
  MessageRole,
  WMAddMessageRequest,
  WMMessage,
} from '@memory-soda/types';
import { Markdown } from '../../components/markdown';
import { Card, CardContent } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// ── Message meta + detail card ────────────────────────────────────────────────
//
// `sequenceNumber` is the message's stable position within the thread (1, 2, 3…),
// assigned by the server on insert. It's used as the prepare/pagination cursor and
// to track what's been compacted (lastCompactedSequence), independent of timestamps.

function MessageMeta({ msg, isUser }: { msg: WMMessage; isUser: boolean }) {
  const tc = msg.tokens;
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
  const tc = msg.tokens;
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
    <Card className="border-border text-xs w-72">
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

const ROLES: { value: MessageRole; hint: string }[] = [
  { value: 'user', hint: 'what the person said' },
  { value: 'assistant', hint: 'a reply your own model produced' },
  { value: 'system', hint: 'instructions, kept out of extraction' },
  { value: 'tool', hint: 'a tool result the model saw' },
];

const FIELD = 'h-7 text-xs md:text-xs font-mono placeholder:font-sans';
// Compact, bordered textarea matching the inputs around it; the shadcn default
// is a tall filled block meant for forms, not a dev tool.
const AREA =
  'min-h-0 rounded-md border border-input bg-background px-3 py-2 text-xs md:text-xs font-mono placeholder:font-sans';
const SECTION_HEADER =
  'h-8 w-full justify-start gap-1.5 rounded-none px-4 text-xs md:text-xs font-normal text-muted-foreground';

function ManualMessageForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (req: WMAddMessageRequest) => Promise<boolean>;
  disabled: boolean;
}) {
  const [role, setRole] = useState<MessageRole>('user');
  const [content, setContent] = useState('');
  const [showMeta, setShowMeta] = useState(false);
  const [model, setModel] = useState('');
  const [latencyMs, setLatencyMs] = useState('');
  const [tokensIn, setTokensIn] = useState('');
  const [tokensOut, setTokensOut] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !disabled && !!content.trim() && !submitting;
  const metaCount = [model, latencyMs, tokensIn, tokensOut].filter(
    Boolean,
  ).length;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const input = tokensIn ? parseInt(tokensIn, 10) : undefined;
    const output = tokensOut ? parseInt(tokensOut, 10) : undefined;
    const req: WMAddMessageRequest = { role, content: content.trim() };
    if (model.trim()) req.model = model.trim();
    if (latencyMs) req.latencyMs = parseInt(latencyMs, 10);
    if (input !== undefined || output !== undefined) {
      req.tokens = {
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        total: (input ?? 0) + (output ?? 0),
      };
    }
    const ok = await onSubmit(req);
    if (ok) setContent('');
    setSubmitting(false);
  }

  const digits =
    (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
      set(e.target.value.replace(/\D/g, ''));

  return (
    <div className="px-4 pb-3 pt-1 space-y-2">
      <div className="flex items-center gap-2">
        <Select value={role} onValueChange={(v) => setRole(v as MessageRole)}>
          <SelectTrigger className="h-7 w-32 rounded-md px-2 text-xs font-mono">
            <SelectValue>{role}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value} className="text-xs">
                <span className="font-mono">{r.value}</span>
                <span className="ml-2 text-muted-foreground">{r.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => setShowMeta((v) => !v)}
        >
          {showMeta ? 'hide' : 'add'} metadata
          {metaCount ? ` (${metaCount})` : ''}
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          inserts without an AI reply
        </span>
      </div>

      {showMeta && (
        <div className="grid grid-cols-4 gap-2">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model"
            className={FIELD}
          />
          <Input
            value={latencyMs}
            onChange={digits(setLatencyMs)}
            inputMode="numeric"
            placeholder="latency ms"
            className={FIELD}
          />
          <Input
            value={tokensIn}
            onChange={digits(setTokensIn)}
            inputMode="numeric"
            placeholder="tokens in"
            className={FIELD}
          />
          <Input
            value={tokensOut}
            onChange={digits(setTokensOut)}
            inputMode="numeric"
            placeholder="tokens out"
            className={FIELD}
          />
        </div>
      )}

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={`${role} message…`}
        rows={3}
        className={`w-full resize-none ${AREA}`}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">⌘↵ to add</span>
        <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Adding…' : `Add ${role} message`}
        </Button>
      </div>
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
  ready,
  inputRef,
}: {
  messages: WMMessage[];
  sending: boolean;
  error: string | null;
  onSend: (content: string, systemPrompt: string) => void;
  onAddManualMessage: (req: WMAddMessageRequest) => Promise<boolean>;
  ready: boolean;
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

  const canSend = ready && !!input.trim() && !sending;

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
        <Button
          variant="ghost"
          size="sm"
          className={SECTION_HEADER}
          onClick={() => setShowSystemPrompt((v) => !v)}
        >
          <span className="font-mono">{showSystemPrompt ? '▾' : '▸'}</span>
          System prompt
        </Button>
        {showSystemPrompt && (
          <div className="px-4 pb-3 pt-1">
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant…"
              rows={3}
              className={`w-full resize-none ${AREA}`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Sent to the AI with each message (user role only).
            </p>
          </div>
        )}
      </div>

      {/* Manual raw message */}
      <div className="border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className={SECTION_HEADER}
          onClick={() => setShowManual((v) => !v)}
        >
          <span className="font-mono">{showManual ? '▾' : '▸'}</span>
          Add raw message
        </Button>
        {showManual && (
          <ManualMessageForm
            onSubmit={onAddManualMessage}
            disabled={!ready || sending}
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
                {ready
                  ? 'Type a message to start a thread.'
                  : 'Select a project above first.'}
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
                  className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    msg.compactedAt
                      ? 'opacity-35 line-through decoration-muted-foreground'
                      : isUser
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : msg.role === 'system'
                          ? 'bg-background border border-border rounded-bl-sm'
                          : isTool
                            ? 'bg-muted/50 border border-border font-mono text-xs rounded-bl-sm'
                            : 'bg-muted rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'system' && (
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
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
            <div className="bg-muted rounded-lg rounded-bl-sm px-4 py-3 text-sm text-muted-foreground">
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
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message… (Enter to send)"
            rows={1}
            disabled={sending}
            className="min-h-9 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm max-h-40 overflow-y-auto"
          />
          <Button
            size="lg"
            className="shrink-0"
            onClick={send}
            disabled={!canSend}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
