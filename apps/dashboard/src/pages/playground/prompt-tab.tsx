import { useEffect, useState } from 'react';
import type { RecallResponse, WMPrepareResponse } from '@memory-soda/types';
import { call, describeError } from './api';
import type { AddOp } from './types';
import { CopyButton } from '../../components/copy-button';

/** Rough, model-agnostic: ~4 chars per token. */
const estTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * The prompt the model would see on the next turn: the recall context block
 * followed by the prepared thread — exactly what `prepareAndRecall()` hands an
 * integrator. Re-fetched whenever the thread changes.
 */
export function PromptTab({
  apiKey,
  threadId,
  dataset,
  messageLimit,
  active,
  addOp,
  refreshKey,
}: {
  apiKey: string;
  threadId: string | null;
  dataset: string;
  messageLimit: number;
  active: boolean;
  addOp: AddOp;
  refreshKey: number;
}) {
  const [data, setData] = useState<{
    prepared: WMPrepareResponse;
    recalled: RecallResponse;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [apiKey, threadId]);

  useEffect(() => {
    if (!active || !threadId || !apiKey.trim()) return;
    let cancelled = false;
    setLoading(true);
    call(apiKey, (m) =>
      m.prepareAndRecall(threadId, {
        dataset: dataset.trim(),
        messageLimit,
        include: ['episodes'],
      }),
    )
      .then(({ data: d, trace }) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        addOp(
          'prepare',
          {
            messageCount: d.prepared.messageCount,
            truncated: d.prepared.truncated,
            compacted: d.prepared.compacted,
            facts: d.recalled.factCount,
            episodes: d.recalled.episodes?.episodeCount ?? 0,
          },
          trace,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        const { message, trace } = describeError(err, 'Prompt preview failed');
        setError(message);
        addOp('error', { message }, trace);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // addOp is stable; dataset/messageLimit are read at fetch time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, threadId, apiKey, refreshKey]);

  const ctx = data?.recalled.context ?? '';
  const msgs = data?.prepared.messages ?? [];
  const full = [
    ctx ? `[system]\n${ctx}` : '',
    ...msgs.map((m) => `[${m.role}]\n${m.content}`),
  ]
    .filter(Boolean)
    .join('\n\n');
  const total = estTokens(full);

  return (
    <div className={active ? 'flex-1 overflow-y-auto min-h-0' : 'hidden'}>
      {!threadId ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
          Start a thread to preview the prompt the model will see.
        </div>
      ) : error ? (
        <div className="mx-3 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
          {loading ? 'Building prompt…' : ''}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
            <span>~{total.toLocaleString()} tokens</span>
            <span>memory ~{estTokens(ctx).toLocaleString()}</span>
            <span>
              thread ~
              {estTokens(msgs.map((m) => m.content).join('')).toLocaleString()}
            </span>
            <span>
              {msgs.length} msgs{data.prepared.truncated ? ' · truncated' : ''}
            </span>
            {loading && <span>refreshing…</span>}
            <CopyButton
              text={full}
              label="copy"
              copiedLabel="✓ copied"
              className="ml-auto font-sans hover:text-foreground transition-colors"
            />
          </div>
          {data.prepared.warning && (
            <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1">
              {data.prepared.warning}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            What the next turn would send: recall context as a system block,
            then the prepared thread. Estimate at ~4 chars/token.
          </p>

          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Memory context · {data.recalled.factCount} facts
              {data.recalled.episodes?.episodeCount
                ? ` · ${data.recalled.episodes.episodeCount} episodes`
                : ''}
            </h4>
            {ctx ? (
              <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded-md p-2 border border-border">
                {ctx}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                Empty — no facts recalled.
              </p>
            )}
          </section>

          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Thread · {msgs.length} messages
            </h4>
            <div className="space-y-1">
              {msgs.map((m, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border px-2 py-1.5 text-xs"
                >
                  <span className="block text-[10px] font-mono text-muted-foreground mb-0.5">
                    {m.role} · ~{estTokens(m.content)} tok
                  </span>
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
