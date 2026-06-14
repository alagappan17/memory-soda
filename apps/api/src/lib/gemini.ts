import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
if (!apiKey || apiKey.trim().length === 0) {
  throw new Error(
    'GOOGLE_GENERATIVE_AI_API_KEY environment variable is required but not set',
  );
}
const geminiApiKey: string = apiKey;

const google = createGoogleGenerativeAI({
  apiKey,
});

const GEMINI_TIMEOUT_MS = 30000; // 30 seconds

async function generateTextWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = GEMINI_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(
            new Error(`Gemini API request timed out after ${timeoutMs}ms`),
          );
        });
      }),
    ]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function generateReply(
  contextMessages: { role: string; content: string }[],
  systemPrompt?: string,
): Promise<string> {
  const systemParts: string[] = [];

  const compactSummaries = contextMessages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);

  if (compactSummaries.length > 0) {
    systemParts.push(
      `Conversation summary (covers earlier messages):\n${compactSummaries.join('\n\n')}`,
    );
  }
  if (systemPrompt) systemParts.push(systemPrompt);

  const chatMessages = contextMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const { text } = await generateTextWithTimeout((signal) =>
    generateText({
      model: google('gemini-2.5-flash'),
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      messages: chatMessages,
      abortSignal: signal,
    }),
  );

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

  const { text } = await generateTextWithTimeout((signal) =>
    generateText({
      model: google('gemini-2.5-flash'),
      prompt,
      abortSignal: signal,
    }),
  );

  return text;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Your job is to analyse a conversation between a user and an AI assistant and extract two things:

1. A concise narrative summary of what the conversation was about (2-4 sentences).
2. A list of atomic observations about the user that can be learned from this conversation. Each observation should be a single, specific, present-tense statement about the user. Only include things that are genuinely revealed by the conversation — do not infer or assume.

Respond with valid JSON only. No explanation, no markdown, no code blocks. Exactly this structure:
{"summary":"string","key_learnings":["string"]}

If nothing meaningful can be learned about the user, return an empty array for key_learnings. If the conversation is too short or trivial to summarise, return a brief summary anyway.`;

interface ExtractionResult {
  summary: string;
  keyLearnings: string[];
}

function buildTranscript(
  messages: { role: string; content: string }[],
  maxMessages: number,
): string {
  let lines: string[];
  if (messages.length > maxMessages) {
    const head = messages.slice(0, 20);
    const tail = messages.slice(-(maxMessages - 20));
    const skipped = messages.length - maxMessages;
    lines = [
      ...head.map((m) => `${m.role}: ${m.content}`),
      `[... ${skipped} messages omitted ...]`,
      ...tail.map((m) => `${m.role}: ${m.content}`),
    ];
  } else {
    lines = messages.map((m) => `${m.role}: ${m.content}`);
  }
  return lines.join('\n');
}

function parseExtractionResponse(text: string): ExtractionResult {
  const parsed = JSON.parse(text) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['summary'] !== 'string' ||
    !(parsed as Record<string, unknown>)['summary'] ||
    !Array.isArray((parsed as Record<string, unknown>)['key_learnings'])
  ) {
    throw new Error('Invalid extraction response shape');
  }
  const raw = parsed as { summary: string; key_learnings: unknown[] };
  const keyLearnings = raw.key_learnings
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.slice(0, 500))
    .slice(0, 20);
  return { summary: raw.summary, keyLearnings };
}

export async function extractEpisode(
  messages: { role: string; content: string }[],
  maxMessages = 100,
): Promise<ExtractionResult> {
  const transcript = buildTranscript(messages, maxMessages);
  const prompt = `Conversation transcript:\n\n${transcript}\n\nExtract the summary and key learnings from this conversation.`;

  const attempt = async (extraNote?: string): Promise<ExtractionResult> => {
    const fullPrompt = extraNote ? `${extraNote}\n\n${prompt}` : prompt;
    const { text } = await generateTextWithTimeout((signal) =>
      generateText({
        model: google('gemini-2.5-flash'),
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: fullPrompt,
        abortSignal: signal,
      }),
    );
    return parseExtractionResponse(text);
  };

  try {
    return await attempt();
  } catch {
    return await attempt(
      'Your previous response was not valid JSON. Respond with raw JSON only, no markdown.',
    );
  }
}

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}
