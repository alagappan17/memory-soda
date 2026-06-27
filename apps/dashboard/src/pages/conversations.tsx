import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProject } from '../providers/project-provider';
import api from '../lib/api';
import {
  RefreshCw,
  Copy,
  Check,
  MessagesSquare,
  MessageSquare,
  BookOpen,
  Clock,
  AlertCircle,
  Loader2,
  Brain,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Separator } from '../components/ui/separator';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Thread {
  threadId: string;
  userId: string;
  title: string | null;
  tags: string[];
  messageCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  lastActivityAt: string;
}

interface Message {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sequenceNumber: number;
  tokenCount: { prompt?: number; completion?: number; total?: number } | null;
  model: string | null;
  latencyMs: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  archivedAt: string | null;
}

interface Episode {
  episodeId: string;
  threadId: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'archived';
  summary: string | null;
  keyLearnings: string[] | null;
  messageCount: number;
  tokenCount: number | null;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
  retryCount: number;
  createdAt: string;
}

interface Fact {
  factId: string;
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  confidence: number;
  episodeId: string | null;
  validAt: string;
  invalidAt: string | null;
  contextEntityName?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
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
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-sm font-medium truncate text-foreground">
          {thread.title ?? 'Untitled'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span className="font-mono truncate max-w-[120px]">{thread.userId}</span>
        <span className="flex items-center gap-1 shrink-0">
          <MessageSquare className="w-3 h-3" />
          {thread.messageCount}
        </span>
        <span className="shrink-0">{relativeTime(thread.lastActivityAt)}</span>
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
  const hasTokens =
    tc &&
    (tc.prompt !== undefined ||
      tc.completion !== undefined ||
      tc.total !== undefined);
  const hasMetadata = msg.metadata && Object.keys(msg.metadata).length > 0;
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
          {msg.archivedAt && (
            <>
              <span className="text-muted-foreground">Archived</span>
              <span>
                {new Date(msg.archivedAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
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
                    <span className="font-mono">
                      {tc!.prompt.toLocaleString()}
                    </span>
                  </>
                )}
                {tc!.completion !== undefined && (
                  <>
                    <span className="text-muted-foreground">Output</span>
                    <span className="font-mono">
                      {tc!.completion.toLocaleString()}
                    </span>
                  </>
                )}
                {tc!.total !== undefined && (
                  <>
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-mono">
                      {tc!.total.toLocaleString()}
                    </span>
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
              <p className="text-muted-foreground font-medium mb-1.5">
                Metadata
              </p>
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
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const tc = msg.tokenCount;
  const hasTokens =
    tc && (tc.prompt !== undefined || tc.completion !== undefined);

  return (
    <div
      className={`flex items-center gap-1.5 mt-1 text-xs text-muted-foreground font-mono ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <span className="font-sans">{time}</span>
      <span>·</span>
      <span>#{msg.sequenceNumber}</span>
      {hasTokens && (
        <>
          <span>·</span>
          {tc!.prompt !== undefined && (
            <span>↑{tc!.prompt.toLocaleString()}</span>
          )}
          {tc!.completion !== undefined && (
            <span>↓{tc!.completion.toLocaleString()}</span>
          )}
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === 'system') {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-muted-foreground italic">
          {msg.content}
        </span>
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
    <div
      className={`px-4 py-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[75%] flex flex-col ${isUser ? 'items-end' : 'items-start'} relative group/msg`}
      >
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted text-foreground rounded-bl-sm'
          }`}
        >
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-');
                return isBlock
                  ? <code className={`block bg-black/10 dark:bg-white/10 rounded px-3 py-2 text-[0.8em] font-mono overflow-x-auto my-1.5 whitespace-pre ${className ?? ''}`}>{children}</code>
                  : <code className="bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>;
              },
              pre: ({ children }) => <>{children}</>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              blockquote: ({ children }) => <blockquote className="border-l-2 border-current/30 pl-3 italic opacity-80 my-1.5">{children}</blockquote>,
              a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 opacity-80 hover:opacity-100">{children}</a>,
              h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
              hr: () => <hr className="my-2 border-current/20" />,
              table: ({ children }) => <div className="overflow-x-auto my-1.5"><table className="text-xs border-collapse">{children}</table></div>,
              th: ({ children }) => <th className="border border-current/20 px-2 py-1 font-semibold text-left">{children}</th>,
              td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
            }}
          >
            {msg.content}
          </Markdown>
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
  const totalIn = messages.reduce((s, m) => s + (m.tokenCount?.prompt ?? 0), 0);
  const totalOut = messages.reduce(
    (s, m) => s + (m.tokenCount?.completion ?? 0),
    0,
  );
  const hasData = messages.some(
    (m) =>
      m.tokenCount?.prompt !== undefined ||
      m.tokenCount?.completion !== undefined,
  );

  if (!hasData) return null;

  return (
    <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground border border-border rounded-md px-2.5 py-1">
      <span title="Total input tokens">↑ {totalIn.toLocaleString()}</span>
      <Separator orientation="vertical" className="h-3" />
      <span title="Total output tokens">↓ {totalOut.toLocaleString()}</span>
    </div>
  );
}

// ── Episode timeline ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<Episode['status'], { dot: string; badge: string; label: string }> = {
  completed:  { dot: 'bg-green-500',  badge: 'bg-green-500/10 text-green-600 dark:text-green-400',  label: 'Completed'  },
  pending:    { dot: 'bg-yellow-400', badge: 'bg-yellow-400/10 text-yellow-600 dark:text-yellow-400', label: 'Pending'   },
  processing: { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', label: 'Processing' },
  failed:     { dot: 'bg-red-500',    badge: 'bg-red-500/10 text-red-600 dark:text-red-400',    label: 'Failed'    },
  archived:   { dot: 'bg-muted-foreground/40', badge: 'bg-muted text-muted-foreground', label: 'Archived'  },
};

function EpisodeCard({ episode, isLast }: { episode: Episode; isLast: boolean }) {
  const s = STATUS_STYLES[episode.status];
  const dateRange = [episode.startedAt, episode.endedAt]
    .filter(Boolean)
    .map((d) => new Date(d!).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))
    .join(' → ');

  return (
    <div className="relative flex gap-4 pb-6">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full shrink-0 mt-1 ring-2 ring-background ${s.dot}`} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.badge}`}>
            {s.label}
          </span>
          {dateRange && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {dateRange}
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {episode.messageCount} msg{episode.messageCount !== 1 ? 's' : ''}
            {episode.tokenCount ? ` · ${episode.tokenCount.toLocaleString()} tok` : ''}
          </span>
        </div>

        {episode.summary && (
          <p className="text-sm text-foreground leading-relaxed mb-3">
            {episode.summary}
          </p>
        )}

        {episode.keyLearnings && episode.keyLearnings.length > 0 && (
          <ul className="space-y-1">
            {episode.keyLearnings.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {episode.status === 'failed' && episode.error && (
          <div className="mt-2 flex gap-2 items-start text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-md px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{episode.error}</span>
          </div>
        )}

        {(episode.status === 'pending' || episode.status === 'processing') && !episode.summary && (
          <p className="text-xs text-muted-foreground italic">Extraction in progress…</p>
        )}
      </div>
    </div>
  );
}

// ── Fact card ──────────────────────────────────────────────────────────────────

function FactCard({ fact }: { fact: Fact }) {
  const invalidated = Boolean(fact.invalidAt);
  const confidence = Math.round(fact.confidence * 100);
  return (
    <div className={`flex gap-3 py-3 border-b border-border last:border-b-0 ${invalidated ? 'opacity-40' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed">
          <span className="font-medium text-foreground">{fact.subject}</span>
          {' '}
          <span className="text-muted-foreground italic">{fact.predicate}</span>
          {' '}
          <span className={fact.objectIsEntity ? 'font-medium text-foreground' : 'text-foreground'}>{fact.object}</span>
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
            confidence >= 80 ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
            confidence >= 50 ? 'bg-yellow-400/10 text-yellow-600 dark:text-yellow-400' :
            'bg-red-500/10 text-red-600 dark:text-red-400'
          }`}>
            {confidence}%
          </span>
          {fact.contextEntityName && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-mono">
              @{fact.contextEntityName}
            </span>
          )}
          {fact.episodeId && (
            <span className="text-xs text-muted-foreground font-mono truncate max-w-40" title={fact.episodeId}>
              ep:{fact.episodeId.slice(0, 8)}
            </span>
          )}
          {invalidated && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">superseded</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
  const { selectedProject } = useProject();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [userIdFilter, setUserIdFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgsError, setMsgsError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'messages' | 'episodes' | 'facts'>('messages');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);

  const [facts, setFacts] = useState<Fact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchThreads = useCallback(async () => {
    if (!selectedProject) return;
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await api.get('/dashboard/threads', {
        params: { projectId: selectedProject.id, limit: '100' },
      });
      setThreads(res.data.threads);
    } catch {
      setThreadsError('Failed to load threads');
    } finally {
      setThreadsLoading(false);
    }
  }, [selectedProject]);

  const fetchMessages = useCallback(async (threadId: string) => {
    if (!selectedProject) return;
    setMsgsLoading(true);
    setMsgsError(null);
    try {
      const res = await api.get(`/dashboard/threads/${threadId}/messages`, {
        params: { projectId: selectedProject.id },
      });
      setMessages(res.data.messages);
      setSelectedThread(res.data.thread);
    } catch {
      setMsgsError('Failed to load messages');
    } finally {
      setMsgsLoading(false);
    }
  }, [selectedProject]);

  const fetchEpisodes = useCallback(async (threadId: string) => {
    if (!selectedProject) return;
    setEpisodesLoading(true);
    setEpisodesError(null);
    try {
      const res = await api.get(`/dashboard/threads/${threadId}/episodes`, {
        params: { projectId: selectedProject.id },
      });
      setEpisodes(res.data.episodes);
    } catch {
      setEpisodesError('Failed to load episodes');
    } finally {
      setEpisodesLoading(false);
    }
  }, [selectedProject]);

  const fetchFacts = useCallback(async (threadId: string) => {
    if (!selectedProject) return;
    setFactsLoading(true);
    setFactsError(null);
    try {
      const res = await api.get(`/dashboard/threads/${threadId}/facts`, {
        params: { projectId: selectedProject.id },
      });
      setFacts(res.data.facts);
    } catch {
      setFactsError('Failed to load facts');
    } finally {
      setFactsLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedThread(null);
    setMessages([]);
    setEpisodes([]);
    setFacts([]);
  }, [selectedProject?.id]);
  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);
  useEffect(() => {
    if (selectedId) {
      fetchMessages(selectedId);
      fetchEpisodes(selectedId);
      fetchFacts(selectedId);
    }
  }, [selectedId, fetchMessages, fetchEpisodes, fetchFacts]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!selectedId || activeTab !== 'episodes') return;
    const id = setInterval(() => fetchEpisodes(selectedId), 8_000);
    return () => clearInterval(id);
  }, [selectedId, activeTab, fetchEpisodes]);

  const visibleThreads = threads.filter((t) => {
    if (
      userIdFilter.trim() &&
      !t.userId.toLowerCase().includes(userIdFilter.toLowerCase())
    )
      return false;
    if (
      tagFilter.trim() &&
      !t.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()))
    )
      return false;
    return true;
  });

  function handleRefresh() {
    fetchThreads();
    if (selectedId) {
      fetchMessages(selectedId);
      fetchEpisodes(selectedId);
      fetchFacts(selectedId);
    }
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
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
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
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <span className="text-xs font-mono text-foreground">
                    {selectedThread.userId}
                  </span>
                  {selectedThread.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded bg-accent text-accent-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                  <div className="ml-auto flex items-center gap-3">
                    <ThreadTokenTotals messages={messages} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(selectedThread.createdAt).toLocaleDateString(
                        [],
                        {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        },
                      )}
                    </span>
                    <div className="flex items-center rounded-md border border-border overflow-hidden">
                      <button
                        onClick={() => setActiveTab('messages')}
                        className={`flex items-center gap-1.5 px-3 py-1 text-xs transition-colors ${
                          activeTab === 'messages'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <MessageSquare className="w-3 h-3" />
                        Messages
                      </button>
                      <button
                        onClick={() => setActiveTab('episodes')}
                        className={`flex items-center gap-1.5 px-3 py-1 text-xs border-l border-border transition-colors ${
                          activeTab === 'episodes'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <BookOpen className="w-3 h-3" />
                        Episodes
                        {episodes.length > 0 && (
                          <span className={`ml-0.5 text-[10px] font-mono ${activeTab === 'episodes' ? 'opacity-80' : 'text-muted-foreground'}`}>
                            {episodes.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab('facts')}
                        className={`flex items-center gap-1.5 px-3 py-1 text-xs border-l border-border transition-colors ${
                          activeTab === 'facts'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <Brain className="w-3 h-3" />
                        Facts
                        {facts.length > 0 && (
                          <span className={`ml-0.5 text-[10px] font-mono ${activeTab === 'facts' ? 'opacity-80' : 'text-muted-foreground'}`}>
                            {facts.length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-4 w-64 bg-muted rounded animate-pulse" />
              )}
            </div>

            {activeTab === 'messages' && (
              <div className="flex-1 overflow-y-auto py-4">
                {msgsError && (
                  <div className="mx-6 my-2 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    {msgsError}
                  </div>
                )}
                {msgsLoading ? (
                  <div className="space-y-3 px-4">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className="h-12 w-64 bg-muted rounded-2xl animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                    No messages in this thread.
                  </div>
                ) : (
                  messages.map((msg) => (
                    <MessageBubble key={msg.messageId} msg={msg} />
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
            )}
            {activeTab === 'episodes' && (
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {episodesError && (
                  <div className="mb-4 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    {episodesError}
                  </div>
                )}
                {episodesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading episodes…
                  </div>
                ) : episodes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                    <BookOpen className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No episodes for this thread yet.</p>
                    <p className="text-xs opacity-70">Call <code className="font-mono">POST /v1/threads/:id/end</code> to trigger extraction.</p>
                  </div>
                ) : (
                  <div className="max-w-2xl">
                    <p className="text-xs text-muted-foreground mb-6">
                      {episodes.length} episode{episodes.length !== 1 ? 's' : ''} · most recent first
                    </p>
                    {episodes.map((ep, i) => (
                      <EpisodeCard key={ep.episodeId} episode={ep} isLast={i === episodes.length - 1} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'facts' && (
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {factsError && (
                  <div className="mb-4 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    {factsError}
                  </div>
                )}
                {factsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading facts…
                  </div>
                ) : facts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                    <Brain className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No facts extracted for this user yet.</p>
                    <p className="text-xs opacity-70">Facts are extracted when threads are ended and semantic memory is enabled.</p>
                  </div>
                ) : (
                  <div className="max-w-2xl">
                    <p className="text-xs text-muted-foreground mb-4">
                      {facts.filter(f => !f.invalidAt).length} active · {facts.filter(f => f.invalidAt).length} superseded
                    </p>
                    <Card>
                      <CardContent className="p-0 divide-y divide-border">
                        {facts.map((fact) => (
                          <div key={fact.factId} className="px-4">
                            <FactCard fact={fact} />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
