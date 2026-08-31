import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProjectSemanticSettings,
  WMAddMessageRequest,
  WMChatRequest,
  WMMessage,
  WMThreadStatsResponse,
} from '@memory-soda/types';
import {
  DEFAULT_EPISODIC_SETTINGS,
  type ProjectEpisodicSettings,
} from '@memory-soda/types';
import { call, quiet, chatTurn, adminCall, describeError } from './api';
import { CopyButton } from '../../components/copy-button';
import { useProject } from '../../providers/project-provider';
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
import { PromptTab } from './prompt-tab';

const DEFAULT_EPISODIC = DEFAULT_EPISODIC_SETTINGS;

let requestIdSeq = 0;

type RightTab = 'ops' | 'prompt' | 'episodes' | 'recall' | 'facts';

export default function PlaygroundPage() {
  // The playground runs against the project picked in the sidebar, under the
  // dashboard session; there is no key to paste.
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';
  const [dataset, setDataset] = useState(
    () => `ds_${Math.random().toString(36).slice(2, 10)}`,
  );

  const [threadId, setThreadId] = useState<string | null>(null);
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
  /** Facts the model has already been shown on this thread, drives the "new" markers. */
  const seenFactIds = useRef<Set<string>>(new Set());

  const poller = useExtractionPoller({
    projectId,
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
    const result = await quiet(key, (memory) =>
      memory.listMessages(tid, { limit: 100, order: 'asc' }),
    );
    setMessages(result.messages);
  }

  async function refreshStats(tid: string) {
    if (!projectId) return;
    setStatsLoading(true);
    try {
      // Thread stats are arithmetic over token counts the caller supplied, so
      // they are a dashboard readout rather than part of the SDK.
      const { data: res } = await adminCall<WMThreadStatsResponse>(
        projectId,
        'get',
        `/memory/working/threads/${tid}/stats`,
      );
      // Ignore a stale response after the thread changed.
      setStats((prev) => (threadIdRef.current === tid ? res : prev));
    } catch {
      // Stats are decorative, don't surface transient failures.
    } finally {
      setStatsLoading(false);
    }
  }
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;
  /** Create the thread on first use; settings freeze at creation. */
  async function ensureThread(): Promise<string> {
    if (threadId) return threadId;
    const { data, trace } = await call(projectId, (memory) =>
      memory.createThread({
        ...(dataset.trim() ? { dataset: dataset.trim() } : {}),
        ...(settings.autoCompactEnabled
          ? { autoCompactThreshold: settings.autoCompactThreshold }
          : {}),
        settings: { episodic: episodicSettings },
      }),
    );
    setThreadId(data.threadId);
    threadIdRef.current = data.threadId;
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
        note: 'Auto-episode timer reset, episode will generate after inactivity window',
        intervalMs: episodicSettings.autoEpisodeIntervalMs,
      });
      poller.schedule(episodicSettings.autoEpisodeIntervalMs);
    }
  }

  async function sendMessage(content: string, systemPrompt: string) {
    if (!content || sending || compacting || !projectId) return;
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
          tokens: null,
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
      // Chat runs the model server-side, so it goes over the dashboard's own
      // session route rather than the SDK, the project comes from the thread
      // the playground just created.
      const { data: chatRes, trace } = await chatTurn(projectId, tid, body);

      // One HTTP call, four logical memory ops, each gets the response
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
      const recalledIds = (chatRes.recall?.facts ?? []).map((f) => f.factId);
      const newFactIds = recalledIds.filter(
        (id) => !seenFactIds.current.has(id),
      );
      for (const id of recalledIds) seenFactIds.current.add(id);
      addOp(
        'recall',
        {
          factCount: chatRes.recallSummary.factCount,
          newFacts: newFactIds.length,
          newFactIds,
          contextChars: chatRes.recall?.context.length ?? 0,
          synthesis: chatRes.recallSummary.hasSynthesis,
          episodes: chatRes.recallSummary.episodeCount,
        },
        trace,
        {
          recallSummary: chatRes.recallSummary,
          recall: chatRes.recall ?? null,
        },
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
          // Compaction rewrote history server-side, refetch the real state.
          setMessages((prev) =>
            prev.filter((m) => m.messageId !== optimisticId),
          );
          await refreshMessages(projectId, tid);
        } else {
          // The response already carries both rows, no refetch needed.
          const blank = {
            threadId: tid,
            tokens: null,
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
        void refreshStats(tid);
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

  /** Raw addMessage, inserts without triggering an AI reply. */
  async function addManualMessage(req: WMAddMessageRequest): Promise<boolean> {
    if (!projectId) return false;
    setError(null);
    try {
      const tid = await ensureThread();
      const { data, trace } = await call(projectId, (memory) =>
        memory.addMessage(tid, req),
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
      await refreshMessages(projectId, tid);
      void refreshStats(tid);
      return true;
    } catch (err) {
      const { message, trace } = describeError(err, 'Failed to add message');
      setError(message);
      addOp('error', { message }, trace);
      return false;
    }
  }

  async function compactNow() {
    if (!threadId || !projectId || compacting) return;
    setCompacting(true);
    setError(null);

    const requestId = ++requestIdSeq;
    currentRequestId.current = requestId;

    try {
      const { data: result, trace: compactTrace } = await call(
        projectId,
        (memory) => memory.compact(threadId),
      );

      // Compacting a thread with nothing to fold answers a different shape.
      if (!('summaryMessageId' in result)) {
        addOp(
          'compacted',
          { compacted: false, summary: result.message },
          compactTrace,
        );
        return;
      }

      // The summary text itself comes back through prepare.
      const { data: prepRes, trace: prepTrace } = await call(
        projectId,
        (memory) =>
          memory.prepare(threadId, {
            messageLimit: settings.messageLimit,
          }),
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
        await refreshMessages(projectId, threadId);
        void refreshStats(threadId);
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
    if (!threadId || !projectId || sending || compacting) return;
    setError(null);
    setSending(true);

    const requestId = ++requestIdSeq;
    currentRequestId.current = requestId;

    try {
      const { data: ended, trace } = await call(projectId, (memory) =>
        memory.endThread(threadId),
      );
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
   * New thread keeps the dataset, episodes/facts/recall are dataset-scoped
   * and survive. Only thread-scoped state resets.
   */
  function newThread() {
    currentRequestId.current = ++requestIdSeq;
    setThreadId(null);
    setThreadStartedAt(null);
    setMessages([]);
    clearOps();
    seenFactIds.current = new Set();
    setStats(null);
    setError(null);
    setSending(false);
    setCompacting(false);
    setEpisodicSettings(DEFAULT_EPISODIC);
    poller.reset();
  }

  // New project = new memory scope; everything resets. Dataset-scoped tabs
  // watch projectId themselves.
  useEffect(() => {
    // '' means projects have not loaded yet; nothing to reset.
    if (!projectId) return;
    currentRequestId.current = ++requestIdSeq;
    setThreadId(null);
    setSemanticSettings(null);
    setThreadStartedAt(null);
    setMessages([]);
    clearOps();
    seenFactIds.current = new Set();
    setStats(null);
    setError(null);
    setSending(false);
    setCompacting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on project change
  }, [projectId]);

  const hasThread = !!threadId;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar, project + actions */}
      <div className="border-b border-border px-4 py-2 bg-card flex items-center gap-3 flex-wrap text-sm shrink-0">
        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          Project
        </span>
        <span className="text-xs font-mono truncate max-w-xs">
          {selectedProject?.name ?? 'none selected'}
        </span>

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
            disabled={!hasThread || !projectId || compacting || sending}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            {compacting ? 'Compacting…' : 'Compact now'}
          </button>
          <button
            onClick={() => void endThreadNow()}
            disabled={!hasThread || !projectId || sending || compacting}
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
        {/* LEFT, Chat */}
        <ChatPanel
          messages={messages}
          sending={sending}
          error={error}
          onSend={(content, systemPrompt) =>
            void sendMessage(content, systemPrompt)
          }
          onAddManualMessage={addManualMessage}
          ready={!!projectId}
          inputRef={inputRef}
        />

        {/* RIGHT, Settings + tabs */}
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
              if (threadId) void refreshStats(threadId);
            }}
            loading={statsLoading}
          />

          {/* Tab bar */}
          <div className="flex border-b border-border shrink-0 bg-card">
            {(
              [
                ['ops', 'Ops'],
                ['prompt', 'Prompt'],
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
            className={
              rightTab === 'ops' ? 'flex-1 flex flex-col min-h-0' : 'hidden'
            }
          >
            <OpsTab ops={ops} relTime={relTime} onClear={clearOps} />
          </div>
          <PromptTab
            projectId={projectId}
            threadId={threadId}
            dataset={dataset}
            messageLimit={settings.messageLimit}
            active={rightTab === 'prompt'}
            addOp={addOp}
            refreshKey={messages.length}
          />
          <EpisodesTab
            projectId={projectId}
            dataset={dataset}
            active={rightTab === 'episodes'}
            addOp={addOp}
            refreshKey={episodesRefreshKey}
            onWatchEpisode={poller.watch}
          />
          <RecallTab
            projectId={projectId}
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
            projectId={projectId}
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
