import { useMemo, useRef, useState } from 'react';
import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  WMAddMessageRequest,
  WMAddMessageResponse,
  WMChatRequest,
  WMChatResponse,
  WMCompactResult,
  WMMessage,
  WMPrepareResponse,
  WMThreadStatsResponse,
} from '@memory-soda/types';
import { trackedFetch, quietFetch, describeError } from './api';
import { CopyButton } from '../../components/copy-button';
import type { WMSettings } from './types';
import { useOps } from './use-ops';
import { useExtractionPoller } from './use-extraction-poller';
import { ChatPanel } from './chat-panel';
import {
  EpisodicPanel,
  SemanticPanel,
  WorkingMemoryPanel,
} from './settings-panels';
import { ThreadStats } from './thread-stats';
import { OpsTab } from './ops-tab';
import { RecallTab } from './recall-tab';
import { FactsTab } from './facts-tab';
import { EpisodesTab } from './episodes-tab';

const WM_BASE = '/v1/memory/working';
const THREADS_BASE = '/v1/threads';

const DEFAULT_EPISODIC: ProjectEpisodicSettings = {
  enabled: true,
  autoEpisodeIntervalMs: 10_000,
  maxMessages: 100,
  maxRetries: 3,
  contextEpisodes: 3,
  similarityWeight: 0.7,
  recencyWeight: 0.3,
};

let requestIdSeq = 0;

type RightTab = 'ops' | 'episodes' | 'recall' | 'facts';

export default function PlaygroundPage() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [dataset, setDataset] = useState(
    () => `ds_${Math.random().toString(36).slice(2, 10)}`,
  );

  const [threadId, setThreadId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [threadStartedAt, setThreadStartedAt] = useState<number | null>(null);
  const [messages, setMessages] = useState<WMMessage[]>([]);
  const [rightTab, setRightTab] = useState<RightTab>('ops');
  const currentRequestId = useRef<number>(0);

  const [episodicSettings, setEpisodicSettings] =
    useState<ProjectEpisodicSettings>(DEFAULT_EPISODIC);
  const [settings, setSettings] = useState<WMSettings>({
    autoCompactEnabled: false,
    autoCompactThreshold: 10,
    messageLimit: 20,
  });
  const [semanticSettings, setSemanticSettings] =
    useState<ProjectSemanticSettings | null>(null);

  const [sending, setSending] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<WMThreadStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [episodesRefreshKey, setEpisodesRefreshKey] = useState(0);

  const { ops, addOp, clearOps } = useOps();

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const poller = useExtractionPoller({
    apiKey,
    dataset,
    addOp,
    onEpisodesChanged: () => setEpisodesRefreshKey((k) => k + 1),
  });

  function relTime(ts: number) {
    if (!threadStartedAt) return '+0.0s';
    return `+${((ts - threadStartedAt) / 1000).toFixed(1)}s`;
  }

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user')?.content ?? '',
    [messages],
  );

  async function refreshMessages(key: string, tid: string) {
    const result = await quietFetch<{ messages: WMMessage[] }>(
      key,
      `${WM_BASE}/threads/${tid}/messages?limit=100&order=asc`,
    );
    setMessages(result.messages);
  }

  async function refreshStats(key: string, tid: string) {
    setStatsLoading(true);
    try {
      const res = await quietFetch<WMThreadStatsResponse>(
        key,
        `${WM_BASE}/threads/${tid}/stats`,
      );
      // Ignore a stale response after the thread changed.
      setStats((prev) => (threadIdRef.current === tid ? res : prev));
    } catch {
      // Stats are decorative — don't surface transient failures.
    } finally {
      setStatsLoading(false);
    }
  }
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  /** Create the thread on first use; settings freeze at creation. */
  async function ensureThread(): Promise<string> {
    if (threadId) return threadId;
    const { data, trace } = await trackedFetch<{
      threadId: string;
      projectId: string;
      dataset: string;
    }>(apiKey, THREADS_BASE, {
      method: 'POST',
      body: {
        dataset: dataset.trim() || undefined,
        autoCompactThreshold: settings.autoCompactEnabled
          ? settings.autoCompactThreshold
          : undefined,
        settings: { episodic: episodicSettings },
      },
    });
    setThreadId(data.threadId);
    threadIdRef.current = data.threadId;
    setProjectId(data.projectId);
    setThreadStartedAt((prev) => prev ?? Date.now());
    addOp(
      'thread_created',
      {
        threadId: data.threadId,
        autoCompact: settings.autoCompactEnabled
          ? settings.autoCompactThreshold
          : 'off',
      },
      trace,
    );
    return data.threadId;
  }

  function noteEpisodeScheduling() {
    if (episodicSettings.enabled && episodicSettings.autoEpisodeIntervalMs) {
      addOp('episode_scheduled', {
        note: 'Auto-episode timer reset — episode will generate after inactivity window',
        intervalMs: episodicSettings.autoEpisodeIntervalMs,
      });
      poller.schedule(episodicSettings.autoEpisodeIntervalMs);
    }
  }

  async function sendMessage(content: string, systemPrompt: string) {
    if (!content || sending || compacting || !apiKey.trim()) return;
    setError(null);
    setSending(true);

    const requestId = ++requestIdSeq;
    currentRequestId.current = requestId;
    let optimisticId: string | null = null;

    try {
      const tid = await ensureThread();

      // Optimistically show the user's message immediately
      const optimisticSeq =
        (messages[messages.length - 1]?.sequenceNumber ?? 0) + 1;
      optimisticId = `optimistic-${optimisticSeq}`;
      setMessages((prev) => [
        ...prev,
        {
          messageId: optimisticId!,
          threadId: tid,
          role: 'user',
          content,
          sequenceNumber: optimisticSeq,
          tokenCount: null,
          model: null,
          latencyMs: null,
          metadata: null,
          compactedAt: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      const body: WMChatRequest = {
        content,
        systemPrompt: systemPrompt.trim() || undefined,
        messageLimit: settings.messageLimit,
        // Playground always inspects the injected recall payload.
        verbose: true,
      };
      const { data: chatRes, trace } = await trackedFetch<WMChatResponse>(
        apiKey,
        `${WM_BASE}/threads/${tid}/chat`,
        { method: 'POST', body },
      );

      // One HTTP call, four logical memory ops — each gets the response
      // slice it's about; the recall op carries the full injected payload.
      addOp(
        'message_added',
        {
          role: 'user',
          sequenceNumber: chatRes.userMessage.sequenceNumber,
          compacted: chatRes.compacted,
        },
        trace,
        { userMessage: chatRes.userMessage, compacted: chatRes.compacted },
      );
      addOp(
        'prepare',
        {
          messageCount: chatRes.prepare.messageCount,
          truncated: chatRes.prepare.truncated,
          compacted: chatRes.prepare.compacted,
        },
        trace,
        { prepare: chatRes.prepare },
      );
      addOp(
        'recall',
        {
          factCount: chatRes.recallSummary.factCount,
          contextChars: chatRes.recall?.context.length ?? 0,
          synthesis: chatRes.recallSummary.hasSynthesis,
          episodes: chatRes.recallSummary.episodeCount,
        },
        trace,
        { recallSummary: chatRes.recallSummary, recall: chatRes.recall ?? null },
      );
      addOp(
        'ai_replied',
        {
          sequenceNumber: chatRes.assistantMessage.sequenceNumber,
          preview: chatRes.assistantMessage.content.slice(0, 120),
        },
        trace,
        { assistantMessage: chatRes.assistantMessage },
      );

      if (chatRes.compacted) {
        addOp('auto_compacted', {
          triggered: true,
          summary: 'Auto-compaction triggered after message threshold',
        });
      }

      noteEpisodeScheduling();

      if (requestId === currentRequestId.current) {
        if (chatRes.compacted) {
          // Compaction rewrote history server-side — refetch the real state.
          setMessages((prev) =>
            prev.filter((m) => m.messageId !== optimisticId),
          );
          await refreshMessages(apiKey, tid);
        } else {
          // The response already carries both rows — no refetch needed.
          const blank = {
            threadId: tid,
            tokenCount: null,
            model: null,
            latencyMs: null,
            metadata: null,
            compactedAt: null,
          };
          setMessages((prev) => [
            ...prev.filter((m) => m.messageId !== optimisticId),
            { ...blank, ...chatRes.userMessage, content },
            { ...blank, ...chatRes.assistantMessage },
          ]);
        }
        void refreshStats(apiKey, tid);
      }
    } catch (err: unknown) {
      if (requestId === currentRequestId.current) {
        setMessages((prev) => prev.filter((m) => m.messageId !== optimisticId));
        const { message, trace } = describeError(err, 'Unknown error');
        setError(message);
        addOp('error', { message }, trace);
      }
    } finally {
      if (requestId === currentRequestId.current) {
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  }

  /** Raw addMessage — inserts without triggering an AI reply. */
  async function addManualMessage(req: WMAddMessageRequest): Promise<boolean> {
    if (!apiKey.trim()) return false;
    setError(null);
    try {
      const tid = await ensureThread();
      const { data, trace } = await trackedFetch<WMAddMessageResponse>(
        apiKey,
        `${WM_BASE}/threads/${tid}/messages`,
        { method: 'POST', body: req },
      );
      addOp(
        'manual_message_added',
        { role: data.role, sequenceNumber: data.sequenceNumber },
        trace,
      );
      if (data.compacted) {
        addOp('auto_compacted', {
          triggered: true,
          summary: 'Auto-compaction triggered after message threshold',
        });
      }
      noteEpisodeScheduling();
      await refreshMessages(apiKey, tid);
      void refreshStats(apiKey, tid);
      return true;
    } catch (err) {
      const { message, trace } = describeError(err, 'Failed to add message');
      setError(message);
      addOp('error', { message }, trace);
      return false;
    }
  }

  async function compactNow() {
    if (!threadId || !apiKey.trim() || compacting) return;
    setCompacting(true);
    setError(null);

    const requestId = ++requestIdSeq;
    currentRequestId.current = requestId;

    try {
      const { data: result, trace: compactTrace } =
        await trackedFetch<WMCompactResult>(
          apiKey,
          `${WM_BASE}/threads/${threadId}/compact`,
          { method: 'POST' },
        );

      // Fetch summary text from prepare
      const { data: prepRes, trace: prepTrace } =
        await trackedFetch<WMPrepareResponse>(
          apiKey,
          `${WM_BASE}/threads/${threadId}/prepare`,
          { method: 'POST', body: { messageLimit: settings.messageLimit } },
        );

      const summary = prepRes.messages.find((m) => m.role === 'system');

      addOp(
        'compacted',
        {
          compactedCount: result.compactedCount,
          fromSequence: result.fromSequence,
          toSequence: result.toSequence,
          summary: summary?.content ?? '(summary not found)',
        },
        compactTrace,
      );

      addOp(
        'prepare',
        {
          messageCount: prepRes.messageCount,
          truncated: prepRes.truncated,
          compacted: prepRes.compacted,
        },
        prepTrace,
      );

      if (requestId === currentRequestId.current) {
        await refreshMessages(apiKey, threadId);
        void refreshStats(apiKey, threadId);
      }
    } catch (err: unknown) {
      if (requestId === currentRequestId.current) {
        const { message, trace } = describeError(err, 'Unknown error');
        setError(message);
        addOp('error', { message }, trace);
      }
    } finally {
      if (requestId === currentRequestId.current) {
        setCompacting(false);
      }
    }
  }

  async function endThreadNow() {
    if (!threadId || !apiKey.trim() || sending || compacting) return;
    setError(null);
    setSending(true);

    const requestId = ++requestIdSeq;
    currentRequestId.current = requestId;

    try {
      const { data: ended, trace } = await trackedFetch<{
        threadId: string;
        episodeQueued: boolean;
      }>(apiKey, `${THREADS_BASE}/${threadId}/end`, { method: 'POST' });
      addOp('thread_ended', { episodeQueued: ended.episodeQueued }, trace);
      if (ended.episodeQueued) {
        poller.startNow();
      }
    } catch (err: unknown) {
      if (requestId === currentRequestId.current) {
        const { message, trace } = describeError(err, 'Unknown error');
        setError(message);
        addOp('error', { message }, trace);
      }
    } finally {
      if (requestId === currentRequestId.current) {
        setSending(false);
      }
    }
  }

  /**
   * New thread keeps the dataset — episodes/facts/recall are dataset-scoped
   * and survive. Only thread-scoped state resets.
   */
  function newThread() {
    currentRequestId.current = ++requestIdSeq;
    setThreadId(null);
    setThreadStartedAt(null);
    setMessages([]);
    clearOps();
    setStats(null);
    setError(null);
    setSending(false);
    setCompacting(false);
    setEpisodicSettings(DEFAULT_EPISODIC);
    poller.reset();
  }

  function handleApiKeyChange(value: string) {
    currentRequestId.current = ++requestIdSeq;
    setApiKey(value);
    // New key = possibly a new project; everything resets. Dataset-scoped
    // tabs watch apiKey themselves.
    setThreadId(null);
    setProjectId(null);
    setSemanticSettings(null);
    setThreadStartedAt(null);
    setMessages([]);
    clearOps();
    setStats(null);
    setError(null);
    setSending(false);
    setCompacting(false);
  }

  const hasThread = !!threadId;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar — API key + actions */}
      <div className="border-b border-border px-4 py-2 bg-card flex items-center gap-3 flex-wrap text-sm shrink-0">
        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          API Key
        </span>
        <div className="flex items-center gap-1 flex-1 min-w-0 max-w-xs">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
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

        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Dataset
          </span>
          <input
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
            disabled={hasThread}
            placeholder="ds_..."
            className="w-32 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono disabled:opacity-50"
          />
          <CopyButton text={dataset} title="Copy dataset" />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => void compactNow()}
            disabled={!hasThread || !apiKey.trim() || compacting || sending}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            {compacting ? 'Compacting…' : 'Compact now'}
          </button>
          <button
            onClick={() => void endThreadNow()}
            disabled={!hasThread || !apiKey.trim() || sending || compacting}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            End thread
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
        <ChatPanel
          messages={messages}
          sending={sending}
          error={error}
          onSend={(content, systemPrompt) =>
            void sendMessage(content, systemPrompt)
          }
          onAddManualMessage={addManualMessage}
          apiKeySet={!!apiKey.trim()}
          inputRef={inputRef}
        />

        {/* RIGHT — Settings + tabs */}
        <div className="w-[440px] shrink-0 flex flex-col min-h-0">
          <WorkingMemoryPanel
            settings={settings}
            onChange={setSettings}
            hasThread={hasThread}
          />
          <EpisodicPanel
            settings={episodicSettings}
            onChange={setEpisodicSettings}
            hasThread={hasThread}
          />
          <SemanticPanel
            projectId={projectId}
            semantic={semanticSettings}
            onLoaded={setSemanticSettings}
          />

          <ThreadStats
            stats={stats}
            onRefresh={() => {
              if (threadId) void refreshStats(apiKey, threadId);
            }}
            loading={statsLoading}
          />

          {/* Tab bar */}
          <div className="flex border-b border-border shrink-0 bg-card">
            {(
              [
                ['ops', 'Ops'],
                ['episodes', 'Episodes'],
                ['recall', 'Recall'],
                ['facts', 'Facts'],
              ] as [RightTab, string][]
            ).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  rightTab === tab
                    ? 'text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tabs stay mounted so their state (filters, results) survives
              switching; each hides itself when inactive. */}
          <div
            className={rightTab === 'ops' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}
          >
            <OpsTab ops={ops} relTime={relTime} />
          </div>
          <EpisodesTab
            apiKey={apiKey}
            dataset={dataset}
            active={rightTab === 'episodes'}
            addOp={addOp}
            refreshKey={episodesRefreshKey}
            onWatchEpisode={poller.watch}
          />
          <RecallTab
            apiKey={apiKey}
            dataset={dataset}
            active={rightTab === 'recall'}
            addOp={addOp}
            defaultMinConfidence={
              semanticSettings?.retrievalMinConfidence ?? null
            }
            defaultLimit={semanticSettings?.factsInContext ?? null}
            lastUserMessage={lastUserMessage}
          />
          <FactsTab
            apiKey={apiKey}
            dataset={dataset}
            active={rightTab === 'facts'}
            addOp={addOp}
            threshold={semanticSettings?.retrievalMinConfidence ?? null}
          />
        </div>
      </div>
    </div>
  );
}
