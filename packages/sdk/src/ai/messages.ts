import type { MessageRole, WMAddMessageRequest } from '@memory-soda/types';

/**
 * Bridging AI SDK messages to memory messages.
 *
 * The AI SDK models a message as a role plus an array of parts — text, tool
 * calls, tool results, files. Memory stores text. Flattening that correctly is
 * fiddly enough that every integrator gets some corner of it wrong, so it lives
 * here rather than in each caller's `onFinish`.
 */

/** The shape of an AI SDK message this module can read, structurally typed. */
export interface ModelMessageLike {
  role: string;
  content: unknown;
}

const STORABLE_ROLES: ReadonlySet<string> = new Set([
  'user',
  'assistant',
  'system',
  'tool',
]);

function isStorableRole(role: string): role is MessageRole {
  return STORABLE_ROLES.has(role);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Flatten one message's content to text.
 *
 * Tool calls and tool results are rendered rather than dropped: "what the agent
 * looked up and what came back" is often the only durable fact in a turn, and
 * an agent that silently forgets its own tool use is the main failure this
 * package exists to prevent.
 */
export function partsToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const chunks: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      chunks.push(part);
      continue;
    }
    if (!isRecord(part)) continue;

    const type = part['type'];
    if ((type === 'text' || type === 'reasoning') && typeof part['text'] === 'string') {
      chunks.push(part['text']);
    } else if (type === 'tool-call') {
      const name = String(part['toolName'] ?? 'tool');
      chunks.push(`[called ${name}(${stringify(part['input'] ?? part['args'])})]`);
    } else if (type === 'tool-result') {
      const name = String(part['toolName'] ?? 'tool');
      chunks.push(`[${name} returned ${stringify(part['output'] ?? part['result'])}]`);
    }
  }
  return chunks.join('\n').trim();
}

function stringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * Convert AI SDK messages into the messages memory stores.
 *
 * Messages that flatten to nothing — a bare file attachment, an empty
 * assistant turn — are dropped rather than stored blank, and unknown roles are
 * skipped rather than coerced.
 */
export function toMemoryMessages(
  messages: readonly ModelMessageLike[],
): WMAddMessageRequest[] {
  const out: WMAddMessageRequest[] = [];
  for (const message of messages) {
    if (!isStorableRole(message.role)) continue;
    const content = partsToText(message.content);
    if (content.length === 0) continue;
    out.push({ role: message.role, content });
  }
  return out;
}
