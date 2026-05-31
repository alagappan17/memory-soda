import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, Copy, Check, MessagesSquare, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Separator } from '../components/ui/separator';

const api = axios.create({ baseURL: import.meta.env['VITE_API_URL'] ?? 'http://localhost:3004' });

// ── Types ─────────────────────────────────────────────────────────────────────

interface Thread {
  threadId:       string;
  userId:         string;
  tags:           string[];
  messageCount:   number;
  metadata:       Record<string, unknown> | null;
  createdAt:      string;
  lastActivityAt: string;
  endedAt:        string | null;
}

interface Message {
  messageId:      string;
  threadId:       string;
  role:           'user' | 'assistant' | 'system' | 'tool';
  content:        string;
  sequenceNumber: number;
  tokenCount:     { prompt?: number; completion?: number; total?: number } | null;
  model:          string | null;
  latencyMs:      number | null;
  metadata:       Record<string, unknown> | null;
  createdAt:      string;
  archivedAt:     string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SkeletonRow() {
  return (
    <div className="px-4 py-3 border-b border-border animate-pulse">
      <div className="h-3 bg-muted rounded w-3/4 mb-2" />
      <div className="h-3 bg-muted rounded w-1/2" />
    </div>
  );
}

// ── Thread list item ──────────────────────────────────────────────────────────

function ThreadItem({
  thread,
  selected,
  onClick,
}: {
  thread: Thread;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-muted/50 ${
        selected ? 'bg-muted' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-mono truncate text-foreground">
          {thread.userId}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1">
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {thread.messageCount}
        </span>
        <span>{relativeTime(thread.lastActivityAt)}</span>
      </div>
      {thread.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {thread.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Message detail card (shown on hover) ─────────────────────────────────────

function MessageDetailCard({ msg }: { msg: Message }) {
  const tc = msg.tokenCount;
  const hasTokens = tc && (tc.prompt !== undefined || tc.completion !== undefined || tc.total !== undefined);
  const hasMetadata = msg.metadata && Object.keys(msg.metadata).length > 0;
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
          {msg.archivedAt && (
            <>
              <span className="text-muted-foreground">Archived</span>
              <span>{new Date(msg.archivedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </>
          )}
        </div>

        {hasTokens && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground font-medium mb-1.5">Tokens</p>
              <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
                {tc!.prompt !== undefined && (
                  <>
                    <span className="text-muted-foreground">Input</span>
                    <span className="font-mono">{tc!.prompt.toLocaleString()}</span>
                  </>
                )}
                {tc!.completion !== undefined && (
                  <>
                    <span className="text-muted-foreground">Output</span>
                    <span className="font-mono">{tc!.completion.toLocaleString()}</span>
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

        {hasMetadata && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground font-medium mb-1.5">Metadata</p>
              <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
                {Object.entries(msg.metadata!).map(([k, v]) => (
                  <Fragment key={k}>
                    <span className="text-muted-foreground truncate">{k}</span>
                    <span className="font-mono text-[10px] break-all">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
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

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageMeta({ msg, isUser }: { msg: Message; isUser?: boolean }) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tc = msg.tokenCount;
  const hasTokens = tc && (tc.prompt !== undefined || tc.completion !== undefined);

  return (
    <div className={`flex items-center gap-1.5 mt-1 text-xs text-muted-foreground font-mono ${isUser ? 'flex-row-reverse' : ''}`}>
      <span className="font-sans">{time}</span>
      <span>·</span>
      <span>#{msg.sequenceNumber}</span>
      {hasTokens && (
        <>
          <span>·</span>
          {tc!.prompt !== undefined && <span>↑{tc!.prompt.toLocaleString()}</span>}
          {tc!.completion !== undefined && <span>↓{tc!.completion.toLocaleString()}</span>}
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === 'system') {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-muted-foreground italic">{msg.content}</span>
        <MessageMeta msg={msg} />
      </div>
    );
  }

  if (msg.role === 'tool') {
    return (
      <div className="px-4 py-2">
        <div className="relative group/msg inline-block w-full">
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words">
            {msg.content}
          </div>
          <div className="absolute left-0 top-full mt-1 z-50 invisible opacity-0 group-hover/msg:visible group-hover/msg:opacity-100 transition-opacity duration-150 pointer-events-none">
            <MessageDetailCard msg={msg} />
          </div>
        </div>
        <MessageMeta msg={msg} />
      </div>
    );
  }

  const isUser = msg.role === 'user';
  return (
    <div className={`px-4 py-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] flex flex-col ${isUser ? 'items-end' : 'items-start'} relative group/msg`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted text-foreground rounded-bl-sm'
          }`}
        >
          {msg.content}
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
}

// ── Thread token totals ───────────────────────────────────────────────────────

function ThreadTokenTotals({ messages }: { messages: Message[] }) {
  const totalIn  = messages.reduce((s, m) => s + (m.tokenCount?.prompt     ?? 0), 0);
  const totalOut = messages.reduce((s, m) => s + (m.tokenCount?.completion ?? 0), 0);
  const hasData  = messages.some(m => m.tokenCount?.prompt !== undefined || m.tokenCount?.completion !== undefined);

  if (!hasData) return null;

  return (
    <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground border border-border rounded-md px-2.5 py-1">
      <span title="Total input tokens">↑ {totalIn.toLocaleString()}</span>
      <Separator orientation="vertical" className="h-3" />
      <span title="Total output tokens">↓ {totalOut.toLocaleString()}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
  const [threads, setThreads]               = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError]     = useState<string | null>(null);

  const [userIdFilter, setUserIdFilter] = useState('');
  const [tagFilter, setTagFilter]       = useState('');

  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [msgsLoading, setMsgsLoading]       = useState(false);
  const [msgsError, setMsgsError]           = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await api.get('/dashboard/threads', { params: { limit: '100' } });
      setThreads(res.data.threads);
    } catch {
      setThreadsError('Failed to load threads');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async (threadId: string) => {
    setMsgsLoading(true);
    setMsgsError(null);
    try {
      const res = await api.get(`/dashboard/threads/${threadId}/messages`);
      setMessages(res.data.messages);
      setSelectedThread(res.data.thread);
    } catch {
      setMsgsError('Failed to load messages');
    } finally {
      setMsgsLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);
  useEffect(() => { if (selectedId) fetchMessages(selectedId); }, [selectedId, fetchMessages]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const visibleThreads = threads.filter((t) => {
    if (userIdFilter.trim() && !t.userId.toLowerCase().includes(userIdFilter.toLowerCase())) return false;
    if (tagFilter.trim() && !t.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()))) return false;
    return true;
  });

  function handleRefresh() {
    fetchThreads();
    if (selectedId) fetchMessages(selectedId);
  }

  async function copyThreadId(id: string) {
    await navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Thread list ─────────────────────────────────────── */}
      <div className="w-80 shrink-0 flex flex-col border-r border-border overflow-hidden">

        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold">Threads</span>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 border-b border-border shrink-0 space-y-2">
          <input
            type="text"
            placeholder="Filter by user ID…"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Filter by tag…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {threadsError && (
            <div className="mx-4 my-3 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
              {threadsError}
            </div>
          )}
          {threadsLoading ? (
            <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
          ) : visibleThreads.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No threads found.
            </div>
          ) : (
            visibleThreads.map((t) => (
              <ThreadItem
                key={t.threadId}
                thread={t}
                selected={selectedId === t.threadId}
                onClick={() => setSelectedId(t.threadId)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: Chat window ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <MessagesSquare className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a conversation to view messages</p>
          </div>
        ) : (
          <>
            <div className="shrink-0 px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
              {selectedThread ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-xs font-mono text-muted-foreground truncate max-w-48">
                      {selectedThread.threadId}
                    </code>
                    <button
                      onClick={() => copyThreadId(selectedThread.threadId)}
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy thread ID"
                    >
                      {copied
                        ? <Check className="w-3.5 h-3.5 text-green-500" />
                        : <Copy className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                  <span className="text-xs font-mono text-foreground">{selectedThread.userId}</span>
                  {selectedThread.tags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded bg-accent text-accent-foreground">
                      {tag}
                    </span>
                  ))}
                  <div className="ml-auto flex items-center gap-3">
                    <ThreadTokenTotals messages={messages} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(selectedThread.createdAt).toLocaleDateString([], {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                  </div>
                </>
              ) : (
                <div className="h-4 w-64 bg-muted rounded animate-pulse" />
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-4">
              {msgsError && (
                <div className="mx-6 my-2 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {msgsError}
                </div>
              )}
              {msgsLoading ? (
                <div className="space-y-3 px-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                      <div className="h-12 w-64 bg-muted rounded-2xl animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                  No messages in this thread.
                </div>
              ) : (
                messages.map((msg) => <MessageBubble key={msg.messageId} msg={msg} />)
              )}
              <div ref={chatEndRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
