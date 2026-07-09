import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useProject } from '../providers/project-provider';
import { Markdown } from '../components/markdown';
import { EPISODE_STATUS_STYLES } from '../lib/episode-status';
import {
  day,
  factStatus,
  applyFactDeletion,
  FACT_STATUS_DOT,
} from '../lib/fact-status';
import { EntityChip } from '../components/entity-chip';
import api, { getProjectSettings } from '../lib/api';
import type {
  SemanticFact,
  SemanticEntity,
  Episode,
  EpisodeStatus,
} from '@memory-soda/types';
import {
  RefreshCw,
  Search,
  Trash2,
  MessagesSquare,
  BookOpen,
  Layers,
  AlertCircle,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardUser {
  dataset: string;
  threadCount: number;
  factCount: number;
  lastActivityAt: string | null;
}

interface Thread {
  threadId: string;
  dataset: string;
  messageCount: number;
  createdAt: string;
  lastActivityAt: string;
}

interface Message {
  messageId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sequenceNumber: number;
  tokenCount: { prompt?: number; completion?: number; total?: number } | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

// ── Page ────────────────────────────────────────────────────────────────────────

type Tab = 'dossier' | 'conversations' | 'episodes';

export default function DatasetsPage() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  const [datasets, setDatasets] = useState<DashboardUser[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cross-tab shared state.
  const [tab, setTab] = useState<Tab>('dossier');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [episodeThreadFilter, setEpisodeThreadFilter] = useState<string | null>(null);

  const fetchDatasets = useCallback(async () => {
    if (!projectId) return;
    setLoadingDatasets(true);
    setError(null);
    try {
      const res = await api.get<{ users: DashboardUser[] }>('/dashboard/datasets', {
        params: { projectId, q: query.trim() || undefined, limit: 100 },
      });
      setDatasets(res.data.users);
    } catch {
      setError('Failed to load datasets');
    } finally {
      setLoadingDatasets(false);
    }
  }, [projectId, query]);

  useEffect(() => {
    fetchDatasets();
    setSelectedDataset(null);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectDataset(dataset: string) {
    setSelectedDataset(dataset);
    setTab('dossier');
    setActiveThreadId(null);
    setEpisodeThreadFilter(null);
  }

  // Cross-tab navigation.
  const viewEpisodesForThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setEpisodeThreadFilter(threadId);
    setTab('episodes');
  };
  const viewConversation = (threadId: string) => {
    setActiveThreadId(threadId);
    setTab('conversations');
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — dataset list */}
      <aside className="w-72 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-semibold">Datasets</h1>
            <button onClick={() => void fetchDatasets()} className="text-muted-foreground hover:text-foreground" title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingDatasets ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void fetchDatasets()}
              placeholder="Search dataset…"
              className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!projectId ? (
            <p className="p-3 text-xs text-muted-foreground">Select a project first.</p>
          ) : datasets.length === 0 && !loadingDatasets ? (
            <p className="p-3 text-xs text-muted-foreground">No datasets yet.</p>
          ) : (
            datasets.map((u) => (
              <button
                key={u.dataset}
                onClick={() => selectDataset(u.dataset)}
                className={`w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/40 ${selectedDataset === u.dataset ? 'bg-muted/60' : ''}`}
              >
                <div className="font-mono text-xs truncate">{u.dataset}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {u.threadCount} thread{u.threadCount !== 1 ? 's' : ''} · {u.factCount} fact{u.factCount !== 1 ? 's' : ''} · {relTime(u.lastActivityAt)}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Right pane — detail */}
      <section className="flex-1 flex flex-col min-h-0">
        {error && (
          <div className="m-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {!selectedDataset ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a dataset to view its memory, conversations, and episodes.
          </div>
        ) : (
          <>
            <div className="px-4 pt-3 shrink-0">
              <div className="font-mono text-sm font-medium">{selectedDataset}</div>
              <div className="flex gap-4 mt-2 border-b border-border">
                <TabButton active={tab === 'dossier'} onClick={() => setTab('dossier')} icon={<BookOpen className="h-3.5 w-3.5" />}>Dossier</TabButton>
                <TabButton active={tab === 'conversations'} onClick={() => setTab('conversations')} icon={<MessagesSquare className="h-3.5 w-3.5" />}>Conversations</TabButton>
                <TabButton active={tab === 'episodes'} onClick={() => { setTab('episodes'); setEpisodeThreadFilter(null); }} icon={<Layers className="h-3.5 w-3.5" />}>Episodes</TabButton>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {projectId && tab === 'dossier' && <DossierTab projectId={projectId} dataset={selectedDataset} />}
              {projectId && tab === 'conversations' && (
                <ConversationsTab
                  projectId={projectId}
                  dataset={selectedDataset}
                  selectedThreadId={activeThreadId}
                  onSelectThread={setActiveThreadId}
                  onViewEpisodes={viewEpisodesForThread}
                />
              )}
              {projectId && tab === 'episodes' && (
                <EpisodesTab
                  projectId={projectId}
                  dataset={selectedDataset}
                  threadFilter={episodeThreadFilter}
                  onClearFilter={() => setEpisodeThreadFilter(null)}
                  onViewConversation={viewConversation}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 pb-2 text-xs font-medium border-b-2 -mb-px transition-colors ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Dossier tab ───────────────────────────────────────────────────────────────

function DossierTab({ projectId, dataset }: { projectId: string; dataset: string }) {
  const [facts, setFacts] = useState<SemanticFact[]>([]);
  const [entities, setEntities] = useState<SemanticEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInvalidated, setShowInvalidated] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjectSettings(projectId)
      .then((res) => setThreshold(res.settings.semantic.retrievalMinConfidence))
      .catch(() => setThreshold(null));
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, e] = await Promise.all([
        api.get<{ facts: SemanticFact[] }>(`/dashboard/datasets/${encodeURIComponent(dataset)}/facts`, { params: { projectId, includeInvalidated: showInvalidated, limit: 200 } }),
        api.get<{ entities: SemanticEntity[] }>(`/dashboard/datasets/${encodeURIComponent(dataset)}/entities`, { params: { projectId } }),
      ]);
      setFacts(f.data.facts);
      setEntities(e.data.entities);
    } catch {
      setError('Failed to load dossier');
    } finally {
      setLoading(false);
    }
  }, [projectId, dataset, showInvalidated]);

  useEffect(() => { void load(); }, [load]);

  async function remove(factId: string) {
    try {
      await api.delete(`/dashboard/datasets/${encodeURIComponent(dataset)}/facts/${factId}`, { params: { projectId } });
      setFacts((prev) => applyFactDeletion(prev, factId, showInvalidated));
    } catch {
      setError('Failed to delete fact');
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, SemanticFact[]>();
    for (const f of facts) {
      const key = f.objectIsEntity ? f.object : f.subject;
      const arr = m.get(key) ?? [];
      arr.push(f);
      m.set(key, arr);
    }
    return m;
  }, [facts]);

  return (
    <div className="h-full overflow-y-auto p-4 max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{loading ? 'Loading…' : `${facts.length} fact${facts.length !== 1 ? 's' : ''}`}</span>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={showInvalidated} onChange={(e) => setShowInvalidated(e.target.checked)} />
          Show invalidated
        </label>
      </div>
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {entities.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-semibold mb-2">Entities</h3>
          <div className="flex flex-wrap gap-2">
            {entities.map((e) => (
              <EntityChip key={e.entityId} entity={e} />
            ))}
          </div>
        </div>
      )}
      {facts.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No facts yet — they extract automatically after conversations.</p>
      )}
      {[...groups.entries()].map(([anchor, items]) => (
        <div key={anchor} className="mb-5">
          <h3 className="text-xs font-semibold mb-2 capitalize">{anchor}</h3>
          <ul className="space-y-1.5">
            {items.map((f) => {
              const { status, inactive } = factStatus(f, threshold);
              const invalidated = status === 'invalidated';
              const rangeEnd = f.validUntil ? ` – ${day(f.validUntil)}` : '';
              return (
                <li key={f.factId} className={`group flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm ${inactive ? 'opacity-50' : ''}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${FACT_STATUS_DOT[status]}`} />
                  <span className={invalidated ? 'line-through' : ''} title={f.sourceQuote ? `“${f.sourceQuote}”` : undefined}>
                    {f.subject} {f.predicate} {f.object}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                    {f.confidence.toFixed(2)} · {status} · {day(f.validAt)}{rangeEnd}
                  </span>
                  {!invalidated && (
                    <button onClick={() => void remove(f.factId)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete fact">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Message bubble (chat) ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (msg.role === 'system') {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-muted-foreground italic">{msg.content}</span>
      </div>
    );
  }
  if (msg.role === 'tool') {
    return (
      <div className="px-4 py-2">
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words">{msg.content}</div>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  return (
    <div className={`px-4 py-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm break-words ${isUser ? 'bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap' : 'bg-muted text-foreground rounded-bl-sm'}`}>
          {isUser ? msg.content : <Markdown>{msg.content}</Markdown>}
        </div>
        <div className={`flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground font-mono ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="font-sans">{time}</span>
          <span>·</span>
          <span>#{msg.sequenceNumber}</span>
        </div>
      </div>
    </div>
  );
}

// ── Conversations tab ─────────────────────────────────────────────────────────

function ConversationsTab({
  projectId,
  dataset,
  selectedThreadId,
  onSelectThread,
  onViewEpisodes,
}: {
  projectId: string;
  dataset: string;
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onViewEpisodes: (threadId: string) => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<{ threads: Thread[] }>('/dashboard/threads', { params: { projectId, dataset, limit: 100 } });
        setThreads(res.data.threads);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, dataset]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }
    (async () => {
      const m = await api.get<{ messages: Message[] }>(`/dashboard/threads/${selectedThreadId}/messages`, { params: { projectId } });
      setMessages(m.data.messages);
    })();
  }, [selectedThreadId, projectId]);

  return (
    <div className="flex h-full min-h-0">
      <div className="w-60 shrink-0 border-r border-border overflow-y-auto">
        {loading ? (
          <p className="p-3 text-xs text-muted-foreground">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No conversations.</p>
        ) : (
          threads.map((t) => (
            <button
              key={t.threadId}
              onClick={() => onSelectThread(t.threadId)}
              className={`w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/40 ${selectedThreadId === t.threadId ? 'bg-muted/60' : ''}`}
            >
              <div className="font-mono text-[11px] truncate">{t.threadId.slice(0, 8)}…</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{t.messageCount} msgs · {relTime(t.lastActivityAt)}</div>
            </button>
          ))
        )}
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {!selectedThreadId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Select a conversation.</div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="font-mono text-xs text-muted-foreground">{selectedThreadId.slice(0, 12)}…</span>
              <button
                onClick={() => onViewEpisodes(selectedThreadId)}
                className="flex items-center gap-1.5 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted/50 transition-colors"
              >
                <Layers className="h-3.5 w-3.5" /> View episodes
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              {messages.map((m) => (
                <MessageBubble key={m.messageId} msg={m} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Episodes tab ────────────────────────────────────────────────────────────────

function EpisodesTab({
  projectId,
  dataset,
  threadFilter,
  onClearFilter,
  onViewConversation,
}: {
  projectId: string;
  dataset: string;
  threadFilter: string | null;
  onClearFilter: () => void;
  onViewConversation: (threadId: string) => void;
}) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'all' | EpisodeStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ episodes: Episode[] }>(`/dashboard/datasets/${encodeURIComponent(dataset)}/episodes`, { params: { projectId, status, limit: 100 } });
      setEpisodes(res.data.episodes);
    } catch {
      setError('Failed to load episodes');
    } finally {
      setLoading(false);
    }
  }, [projectId, dataset, status]);

  useEffect(() => { void load(); }, [load]);

  const shown = threadFilter ? episodes.filter((e) => e.threadId === threadFilter) : episodes;

  return (
    <div className="h-full overflow-y-auto p-4 max-w-3xl">
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted-foreground">
          {loading ? 'Loading…' : `${shown.length} episode${shown.length !== 1 ? 's' : ''}`}
        </span>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | EpisodeStatus)} className="text-xs rounded-md border border-border bg-background px-2 py-1">
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="archived">Archived</option>
          </select>
          <button onClick={() => void load()} className="text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {threadFilter && (
        <div className="flex items-center justify-between mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span>Filtered to conversation <span className="font-mono">{threadFilter.slice(0, 8)}…</span></span>
          <button onClick={onClearFilter} className="text-primary hover:underline">Show all</button>
        </div>
      )}

      {shown.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No episodes{threadFilter ? ' for this conversation' : ''} yet.</p>
      )}

      <div className="space-y-2">
        {shown.map((ep) => {
          const s = EPISODE_STATUS_STYLES[ep.status];
          const open = expanded === ep.episodeId;
          return (
            <div key={ep.episodeId} className="rounded-md border border-border">
              <button
                onClick={() => setExpanded(open ? null : ep.episodeId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
              >
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.badge}`}>{s.label}</span>
                <span className="text-sm truncate flex-1">{ep.summary ?? <span className="text-muted-foreground italic">No summary</span>}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{ep.messageCount} msg{ep.messageCount !== 1 ? 's' : ''} · {relTime(ep.endedAt ?? ep.createdAt)}</span>
              </button>

              {open && (
                <div className="border-t border-border px-3 py-3 text-xs space-y-3">
                  {/* Identifying metadata */}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                    <Meta label="episodeId" value={ep.episodeId} />
                    <Meta label="threadId" value={ep.threadId ?? '—'} />
                    <Meta label="status" value={ep.status} />
                    <Meta label="messages" value={String(ep.messageCount)} />
                    <Meta label="tokens" value={ep.tokenCount != null ? ep.tokenCount.toLocaleString() : '—'} />
                    <Meta label="retries" value={String(ep.retryCount)} />
                    <Meta label="startedAt" value={dateTime(ep.startedAt)} />
                    <Meta label="endedAt" value={dateTime(ep.endedAt)} />
                    <Meta label="processingStartedAt" value={dateTime(ep.processingStartedAt)} />
                    <Meta label="processingCompletedAt" value={dateTime(ep.processingCompletedAt)} />
                    <Meta label="createdAt" value={dateTime(ep.createdAt)} />
                  </dl>

                  {ep.summary && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Summary</div>
                      <p className="text-sm leading-relaxed">{ep.summary}</p>
                    </div>
                  )}

                  {ep.keyLearnings && ep.keyLearnings.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Key learnings</div>
                      <ul className="space-y-1">
                        {ep.keyLearnings.map((k, i) => (
                          <li key={i} className="flex gap-2 text-muted-foreground">
                            <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0" />
                            <span>{k}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {ep.status === 'failed' && ep.error && (
                    <div className="flex gap-2 items-start text-red-600 dark:text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="break-all">{ep.error}</span>
                    </div>
                  )}

                  {ep.threadId && (
                    <button
                      onClick={() => onViewConversation(ep.threadId!)}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-muted/50 transition-colors"
                    >
                      <MessagesSquare className="h-3.5 w-3.5" /> View conversation <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Fragment>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate" title={value}>{value}</dd>
    </Fragment>
  );
}
