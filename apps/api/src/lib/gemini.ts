import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import axios from 'axios';
import type { EpisodeContext, SemanticContext } from '@memory-soda/types';

const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
if (!apiKey || apiKey.trim().length === 0) {
  throw new Error(
    'GOOGLE_GENERATIVE_AI_API_KEY environment variable is required but not set',
  );
}
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
  episodicContext?: EpisodeContext | null,
  semanticContext?: SemanticContext | null,
): Promise<string> {
  const systemParts: string[] = [];

  // Inject past episode memories as the first system block so the AI has
  // cross-thread context (e.g. from a previous chat session).
  if (episodicContext?.episodes && episodicContext.episodes.length > 0) {
    const episodeLines = episodicContext.episodes
      .map((ep, i) => {
        const facts = (ep.userFacts && ep.userFacts.length > 0)
          ? ep.userFacts
          : (ep.keyLearnings ?? []);
        const learnings =
          facts.length > 0
            ? `\n  User facts:\n${facts.map((l) => `    - ${l}`).join('\n')}`
            : '';
        return `Episode ${i + 1} (ended ${ep.endedAt ? new Date(ep.endedAt).toLocaleDateString() : 'unknown'}):\n  ${ep.summary}${learnings}`;
      })
      .join('\n\n');
    systemParts.push(
      `Past conversation memories (${episodicContext.episodeCount} total episode${episodicContext.episodeCount !== 1 ? 's' : ''} for this user):\n\n${episodeLines}`,
    );
  }

  if (semanticContext && (semanticContext.facts.length > 0 || semanticContext.relationships.length > 0)) {
    const lines: string[] = [];
    for (const f of semanticContext.facts) {
      lines.push(`- ${f.subject} ${f.predicate} ${f.object} (confidence: ${f.confidence.toFixed(2)})`);
    }
    for (const r of semanticContext.relationships) {
      lines.push(`- ${r.subject} ${r.predicate} ${r.object} (confidence: ${r.confidence.toFixed(2)})`);
    }
    systemParts.push(`Semantic memory (known facts and connections about this user):\n${lines.join('\n')}`);
  }

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

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Your job is to analyse a conversation between a user and an AI assistant and extract three things:

1. A concise narrative summary of what the conversation was about (2-4 sentences).
2. userFacts — atomic facts that are true about the USER: their preferences, goals, constraints, personal context, relationships, habits, or history. Each item must be a single present-tense statement grounded in what the user actually said or revealed. Do not infer or assume.
3. assistantActions — what the ASSISTANT said, offered, recommended, or did during the conversation (e.g. "assistant recommended X", "assistant offered Y"). These capture the assistant's behaviour, not user facts.

The separation is critical: userFacts feeds the long-term user knowledge graph. assistantActions is stored for context but never written to the graph.

Respond with valid JSON only. No explanation, no markdown, no code blocks. Exactly this structure:
{"summary":"string","userFacts":["string"],"assistantActions":["string"]}

If nothing meaningful can be learned about the user, return an empty array for userFacts. Return an empty array for assistantActions if the assistant did nothing notable. If the conversation is too short or trivial to summarise, return a brief summary anyway.`;

interface ExtractionResult {
  summary: string;
  keyLearnings: string[];
  userFacts: string[];
  assistantActions: string[];
}

function buildTranscript(
  messages: { role: string; content: string }[],
  maxMessages: number,
): string {
  const fmt = (m: { role: string; content: string }) => `${m.role}: ${m.content}`;
  if (messages.length <= maxMessages) return messages.map(fmt).join('\n');
  const head = messages.slice(0, 20);
  const tail = messages.slice(-(maxMessages - 20));
  const skipped = messages.length - maxMessages;
  return [...head.map(fmt), `[... ${skipped} messages omitted ...]`, ...tail.map(fmt)].join('\n');
}

function parseExtractionResponse(text: string): ExtractionResult {
  const parsed = JSON.parse(text) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['summary'] !== 'string' ||
    !(parsed as Record<string, unknown>)['summary']
  ) {
    throw new Error('Invalid extraction response shape');
  }
  const raw = parsed as { summary: string; key_learnings?: unknown[]; userFacts?: unknown[]; assistantActions?: unknown[] };
  const toStringArray = (arr: unknown) =>
    (Array.isArray(arr) ? arr : []).filter((l): l is string => typeof l === 'string').map((l) => l.slice(0, 500)).slice(0, 30);
  const userFacts = toStringArray(raw.userFacts);
  const assistantActions = toStringArray(raw.assistantActions);
  // keyLearnings kept for backward compat — mirrors userFacts for new episodes
  const keyLearnings = userFacts.length > 0 ? userFacts : toStringArray(raw.key_learnings);
  return { summary: raw.summary, keyLearnings, userFacts, assistantActions };
}

export async function extractEpisode(
  messages: { role: string; content: string }[],
  maxMessages = 100,
): Promise<ExtractionResult> {
  const transcript = buildTranscript(messages, maxMessages);
  const prompt = `Conversation transcript:\n\n${transcript}\n\nExtract the summary, userFacts, and assistantActions from this conversation.`;

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
      'Your previous response was not valid JSON. Respond with raw JSON only, no markdown. Required keys: summary, userFacts, assistantActions.',
    );
  }
}

export async function generateThreadTitle(
  messages: { role: string; content: string }[],
): Promise<string> {
  const preview = messages
    .slice(0, 6)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  return generateTextWithTimeout(async (signal) => {
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      abortSignal: signal,
      system:
        'Generate a short title (4–7 words) for this conversation. Return only the title, no punctuation, no quotes.',
      prompt: preview,
    });
    return text.trim().slice(0, 80);
  });
}

export async function embedText(text: string): Promise<number[]> {
  const res = await axios.post<{ embedding: { values: number[] } }>(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    },
    {
      headers: { 'x-goog-api-key': apiKey },
      timeout: GEMINI_TIMEOUT_MS,
    },
  );
  return res.data.embedding.values;
}
