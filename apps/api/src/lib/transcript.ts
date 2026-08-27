/**
 * Format messages as a `role: content` transcript, truncating the middle
 * (head 20 + tail) when over `maxMessages` so extraction prompts stay bounded.
 *
 * The head is kept because a conversation's opening turns carry the framing,
 * and the tail because the user's final position is the one that counts.
 */
export function buildTranscript(
  messages: { role: string; content: string }[],
  maxMessages: number,
): string {
  const fmt = (m: { role: string; content: string }) =>
    `${m.role}: ${m.content}`;
  if (messages.length <= maxMessages) return messages.map(fmt).join('\n');

  const headSize = Math.min(20, Math.max(0, maxMessages - 1));
  const head = messages.slice(0, headSize);
  const tail = messages.slice(-(maxMessages - headSize));
  const skipped = messages.length - head.length - tail.length;
  return [
    ...head.map(fmt),
    `[... ${skipped} messages omitted ...]`,
    ...tail.map(fmt),
  ].join('\n');
}
