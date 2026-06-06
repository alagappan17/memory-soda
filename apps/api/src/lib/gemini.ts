import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

const google = createGoogleGenerativeAI({
  apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? '',
});

export async function generateReply(
  contextMessages: { role: string; content: string }[],
  systemPrompt?: string,
): Promise<string> {
  const systemParts: string[] = [];

  const compactSummaries = contextMessages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);

  if (compactSummaries.length > 0) {
    systemParts.push(`Conversation summary (covers earlier messages):\n${compactSummaries.join('\n\n')}`);
  }
  if (systemPrompt) systemParts.push(systemPrompt);

  const chatMessages = contextMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: chatMessages,
  });

  return text;
}

export async function summarizeMessages(
  messages: { role: string; content: string }[],
  existingSummary: string | null,
): Promise<string> {
  const contextBlock = existingSummary
    ? `Previous conversation summary (covers all earlier messages):\n${existingSummary}\n\n`
    : '';

  const transcript = messages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n');

  const prompt = `${contextBlock}New messages to incorporate:\n${transcript}\n\nWrite a concise factual summary of the full conversation so far, preserving all key decisions, facts, context, and unresolved questions. Do not add commentary or analysis.`;

  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    prompt,
  });

  return text;
}
