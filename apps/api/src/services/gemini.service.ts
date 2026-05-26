import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { ExtractedFact, FactClassification, MemoryFact, Message } from '@memory-soda/types';

// ── Embeddings ────────────────────────────────────────────────────────────────
// gemini-embedding-001 only supports embedContent (not batchEmbedContents),
// so we call the REST API directly.

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { embedding: { values: number[] } };
  return data.embedding.values;
}

// ── Fact extraction ───────────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `You are a semantic fact extractor. Given a conversation, extract factual statements about the user as JSON.

Rules:
- Only extract facts that are clearly stated or strongly implied
- Use "user" as the subject name when the fact is about the person speaking as the user
- Keep subject/object names concise and consistent (e.g. "Acme Corp" not "the company Acme Corp")
- Predicates should be SCREAMING_SNAKE_CASE (e.g. WORKS_AT, KNOWS, BASED_IN, INTERESTED_IN, WORKING_ON, PREFERS, HAS_SKILL)
- EntityType must be one of: User, Person, Organization, Place, Topic, Concept, Value
- Confidence 0.0–1.0 (use 0.9+ for directly stated facts, 0.6–0.8 for inferred)
- Return ONLY a JSON array, no other text`;

export async function extractFacts(messages: Message[]): Promise<ExtractedFact[]> {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    system: EXTRACT_SYSTEM,
    prompt: `Extract semantic facts from this conversation:\n\n${conversation}\n\nReturn a JSON array of fact objects with fields: subject, subjectType, predicate, object, objectType, confidence.`,
  });

  try {
    // Strip markdown code fences if present
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f: unknown) =>
        typeof f === 'object' &&
        f !== null &&
        'subject' in f &&
        'predicate' in f &&
        'object' in f,
    ) as ExtractedFact[];
  } catch {
    console.warn('[gemini] failed to parse extracted facts:', text.slice(0, 200));
    return [];
  }
}

// ── Fact classification ───────────────────────────────────────────────────────

export async function classifyFact(
  newFact: ExtractedFact,
  existingFacts: MemoryFact[],
): Promise<FactClassification> {
  const existingList = existingFacts
    .map((f) => `  - "${f.text}" (confidence: ${f.confidence}, since: ${f.validAt})`)
    .join('\n');

  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    prompt: `Classify the relationship between a new fact and existing facts.

New fact: ${newFact.subject} ${newFact.predicate} ${newFact.object}

Existing facts with same subject+predicate:
${existingList}

Respond with exactly one word:
- CONTRADICTION  (new fact directly contradicts an existing one, e.g. different employer for WORKS_AT)
- REINFORCEMENT  (new fact confirms or repeats an existing one)
- NEW            (new fact adds genuinely new information, no contradiction)

Your response (one word only):`,
  });

  const word = text.trim().toUpperCase().split(/\s+/)[0];
  if (word === 'CONTRADICTION' || word === 'REINFORCEMENT' || word === 'NEW') {
    return word as FactClassification;
  }
  return 'NEW';
}

// ── Chat completion ───────────────────────────────────────────────────────────

export interface ChatResult {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function generateChatResponse(
  systemPrompt: string,
  messages: Message[],
): Promise<ChatResult> {
  const { text, usage } = await generateText({
    model: google('gemini-2.5-flash'),
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  return {
    text,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    },
  };
}
