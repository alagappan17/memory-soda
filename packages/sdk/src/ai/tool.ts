import type { MemorySoda } from '../client.js';

/**
 * Memory as a tool the model can choose to call.
 *
 * The middleware recalls on every turn, which is right for a chat assistant and
 * wasteful for an agent that mostly runs tools. A tool inverts it: the model
 * decides when a lookup is worth a round trip, and says what it is looking for
 * — which is usually a better retrieval query than the raw user message.
 *
 * Returned as a plain object rather than through the AI SDK's `tool()` helper
 * so this package does not take a dependency on `ai` just to describe a schema.
 * Pass it straight into `tools: { recallMemory: memoryTool({ ... }) }`.
 */

export interface MemoryToolOptions {
  memory: MemorySoda;
  dataset: string;
  /** Facts per lookup. Defaults to the project's setting. */
  limit?: number;
  /** Override the description the model sees. */
  description?: string;
}

export interface MemoryTool {
  description: string;
  inputSchema: {
    type: 'object';
    properties: {
      query: { type: 'string'; description: string };
    };
    required: ['query'];
    additionalProperties: false;
  };
  execute: (input: { query: string }) => Promise<string>;
}

const DEFAULT_DESCRIPTION =
  'Look up what is remembered about this user — their preferences, history, ' +
  'stated goals and personal details. Call this before answering anything ' +
  'that depends on who they are, rather than guessing or asking them to ' +
  'repeat themselves.';

export function memoryTool(options: MemoryToolOptions): MemoryTool {
  const { memory, dataset, limit, description = DEFAULT_DESCRIPTION } = options;

  return {
    description,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What you want to know, in natural language. For example: ' +
            '"favourite movies" or "what car did they decide on".',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute({ query }) {
      try {
        const { context } = await memory.recall({
          dataset,
          query,
          ...(limit === undefined ? {} : { limit }),
        });
        // A plain sentence rather than an error: "nothing known" is a valid
        // answer the model should act on, not a failure it should retry.
        return context.length > 0
          ? context
          : 'Nothing is recorded about this user for that query yet.';
      } catch (error) {
        console.warn('[memory-soda] recall tool failed:', error);
        return 'Memory is temporarily unavailable. Answer without it.';
      }
    },
  };
}
