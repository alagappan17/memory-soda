import { useCallback, useState } from 'react';
import type { Operation, OpTrace, OpType } from './types';

let opIdSeq = 0;

export function useOps() {
  const [ops, setOps] = useState<Operation[]>([]);

  const addOp = useCallback(
    (
      type: OpType,
      summary: Record<string, unknown>,
      trace?: OpTrace,
      // One HTTP call can produce several ops (chat → message_added + prepare
      // + ai_replied); this narrows each op's Response block to its slice.
      responseOverride?: unknown,
    ) => {
      setOps((prev) => [
        ...prev,
        {
          id: ++opIdSeq,
          type,
          ts: Date.now(),
          durationMs: trace?.durationMs,
          summary,
          request: trace
            ? { method: trace.method, path: trace.path, body: trace.requestBody }
            : undefined,
          response:
            responseOverride !== undefined
              ? responseOverride
              : trace?.responseBody,
        },
      ]);
    },
    [],
  );

  const clearOps = useCallback(() => setOps([]), []);

  return { ops, addOp, clearOps };
}
