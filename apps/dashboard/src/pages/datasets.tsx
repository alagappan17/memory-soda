import { useState, useEffect, useCallback, Suspense } from 'react';
import { useProject } from '../providers/project-provider';
import { Markdown } from '../components/markdown';
import api, { getProjectSettings } from '../lib/api';
import { FactsTab } from './playground/facts-tab';
import { EpisodesTab } from './playground/episodes-tab';
import { LazyGraphTab as GraphTab } from './playground/graph-tab-lazy';
import type { DatasetSummary } from '@memory-soda/types';
import {
  RefreshCw,
  Search,
  MessagesSquare,
  BookOpen,
  Layers,
  Network,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Page ────────────────────────────────────────────────────────────────────────

type Tab = 'dossier' | 'conversations' | 'episodes' | 'graph';

export default function DatasetsPage() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cross-tab shared state.
  const [tab, setTab] = useState<Tab>('dossier');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [episodeThreadFilter, setEpisodeThreadFilter] = useState<string | null>(
    null,
  );
  const [graphThreadFilter, setGraphThreadFilter] = useState<string | null>(
    null,
  );

  // Semantic settings' confidence floor, same fetch the playground's
  // SemanticPanel does, hoisted here so the Dossier (Facts) tab has it.
  const [threshold, setThreshold] = useState<number | null>(null);
  useEffect(() => {
    if (!projectId) return;
    getProjectSettings(projectId)
      .then((res) => setThreshold(res.settings.semantic.retrievalMinConfidence))
      .catch(() => setThreshold(null));
  }, [projectId]);

  const fetchDatasets = useCallback(async () => {
    if (!projectId) return;
    setLoadingDatasets(true);
    setError(null);
    try {
      const res = await api.get<{ datasets: DatasetSummary[] }>(
        `/dashboard/projects/${projectId}/browse/datasets`,
        {
          params: { q: query.trim() || undefined, limit: 100 },
        },
      );
      setDatasets(res.data.datasets);
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
    setGraphThreadFilter(null);
  }

  // Cross-tab navigation.
  const viewEpisodesForThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setEpisodeThreadFilter(threadId);
    setTab('episodes');
  };
  const viewGraphForThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setGraphThreadFilter(threadId);
    setTab('graph');
  };
  const viewConversation = (threadId: string) => {
    setActiveThreadId(threadId);
    setTab('conversations');
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail, dataset list */}
      <aside className="w-72 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-semibold">Datasets</h1>
            <button
              onClick={() => void fetchDatasets()}
              className="text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingDatasets ? 'animate-spin' : ''}`}
              />
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
            <p className="p-3 text-xs text-muted-foreground">
              Select a project first.
            </p>
          ) : datasets.length === 0 && !loadingDatasets ? (
            <p className="p-3 text-xs text-muted-foreground">
              No datasets yet.
            </p>
          ) : (
            datasets.map((u) => (
              <button
                key={u.dataset}
                onClick={() => selectDataset(u.dataset)}
                className={`w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/40 ${selectedDataset === u.dataset ? 'bg-muted/60' : ''}`}
              >
                <div className="font-mono text-xs truncate">{u.dataset}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {u.threadCount} thread{u.threadCount !== 1 ? 's' : ''} ·{' '}
                  {u.factCount} fact{u.factCount !== 1 ? 's' : ''} ·{' '}
                  {relTime(u.lastActivityAt)}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Right pane, detail */}
      <section className="flex-1 flex flex-col min-h-0">
        {error && (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
              <div className="font-mono text-sm font-medium">
                {selectedDataset}
              </div>
              <div className="flex gap-4 mt-2 border-b border-border">
                <TabButton
                  active={tab === 'dossier'}
                  onClick={() => setTab('dossier')}
                  icon={<BookOpen className="h-3.5 w-3.5" />}
                >
                  Dossier
                </TabButton>
                <TabButton
                  active={tab === 'conversations'}
                  onClick={() => setTab('conversations')}
                  icon={<MessagesSquare className="h-3.5 w-3.5" />}
                >
                  Conversations
                </TabButton>
                <TabButton
                  active={tab === 'episodes'}
                  onClick={() => {
                    setTab('episodes');
                    setEpisodeThreadFilter(null);
                  }}
                  icon={<Layers className="h-3.5 w-3.5" />}
                >
                  Episodes
                </TabButton>
                <TabButton
                  active={tab === 'graph'}
                  onClick={() => {
                    setTab('graph');
                    setGraphThreadFilter(null);
                  }}
                  icon={<Network className="h-3.5 w-3.5" />}
                >
                  Graph
                </TabButton>
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {projectId && tab === 'dossier' && (
                <FactsTab
                  projectId={projectId}
                  dataset={selectedDataset}
                  active={true}
                  threshold={threshold}
                />
              )}
              {projectId && tab === 'conversations' && (
                <ConversationsTab
                  projectId={projectId}
                  dataset={selectedDataset}
                  selectedThreadId={activeThreadId}
                  onSelectThread={setActiveThreadId}
                  onViewEpisodes={viewEpisodesForThread}
                  onViewGraph={viewGraphForThread}
                />
              )}
              {projectId && tab === 'episodes' && (
                <EpisodesTab
                  projectId={projectId}
                  dataset={selectedDataset}
                  active={true}
                  limit={100}
                  threadFilter={episodeThreadFilter}
                  onClearThreadFilter={() => setEpisodeThreadFilter(null)}
                  onViewConversation={viewConversation}
                />
              )}
              {projectId && tab === 'graph' && (
                <Suspense
                  fallback={
                    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                      Loading graph…
                    </div>
                  }
                >
                  <GraphTab
                    key={`${projectId}:${selectedDataset}`}
                    projectId={projectId}
                    dataset={selectedDataset}
                    active={true}
                    threadId={graphThreadFilter}
                  />
                </Suspense>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
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

// ── Message bubble (chat) ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (msg.role === 'system') {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-muted-foreground italic">
          {msg.content}
        </span>
      </div>
    );
  }
  if (msg.role === 'tool') {
    return (
      <div className="px-4 py-2">
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  return (
    <div
      className={`px-4 py-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
      >
        <div
          className={`rounded-lg px-4 py-2.5 text-sm break-words ${isUser ? 'bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap' : 'bg-muted text-foreground rounded-bl-sm'}`}
        >
          {isUser ? msg.content : <Markdown>{msg.content}</Markdown>}
        </div>
        <div
          className={`flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground font-mono ${isUser ? 'flex-row-reverse' : ''}`}
        >
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
  onViewGraph,
}: {
  projectId: string;
  dataset: string;
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onViewEpisodes: (threadId: string) => void;
  onViewGraph: (threadId: string) => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<{ threads: Thread[] }>(
          `/dashboard/projects/${projectId}/browse/threads`,
          { params: { dataset, limit: 100 } },
        );
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
      const m = await api.get<{ messages: Message[] }>(
        `/dashboard/projects/${projectId}/browse/threads/${selectedThreadId}/messages`,
      );
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
              <div className="font-mono text-[11px] truncate">
                {t.threadId.slice(0, 8)}…
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {t.messageCount} msgs · {relTime(t.lastActivityAt)}
              </div>
            </button>
          ))
        )}
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {!selectedThreadId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a conversation.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="font-mono text-xs text-muted-foreground">
                {selectedThreadId.slice(0, 12)}…
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onViewGraph(selectedThreadId)}
                  className="flex items-center gap-1.5 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted/50 transition-colors"
                >
                  <Network className="h-3.5 w-3.5" /> View graph
                </button>
                <button
                  onClick={() => onViewEpisodes(selectedThreadId)}
                  className="flex items-center gap-1.5 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted/50 transition-colors"
                >
                  <Layers className="h-3.5 w-3.5" /> View episodes
                </button>
              </div>
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
