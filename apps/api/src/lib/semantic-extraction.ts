import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { EntityType } from '@memory-soda/types';

const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? '';
const google = createGoogleGenerativeAI({ apiKey });
const TIMEOUT_MS = 30_000;

// ── Output types ──────────────────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  attributes: Record<string, string | string[]>;
}

export interface ExtractedRelationship {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface ExtractedLiteralFact {
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
}

export interface ExtractedGraph {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  literalFacts: ExtractedLiteralFact[];
}

export type ContradictionVerdict = 'old' | 'new' | 'neither';

// ── LLM helpers ───────────────────────────────────────────────────────────────

async function callGemini(system: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      system,
      prompt,
      abortSignal: controller.signal,
    });
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(trimmed) as T;
}

async function attemptExtract<T>(
  system: string,
  prompt: string,
  parse: (text: string) => T,
): Promise<T> {
  const attempt = async (extraNote?: string): Promise<T> => {
    const fullPrompt = extraNote ? `${extraNote}\n\n${prompt}` : prompt;
    const text = await callGemini(system, fullPrompt);
    return parse(text);
  };
  try {
    return await attempt();
  } catch {
    return await attempt('Your previous response was not valid JSON. Respond with raw JSON only, no markdown.');
  }
}

// ── Graph extraction ──────────────────────────────────────────────────────────

const buildGraphSystem = (minConfidence: number) => `You are a knowledge graph extraction system. Given a conversation transcript between a user and an assistant, extract a structured knowledge graph of durable facts about the user and the real-world entities they mention.

Output a single JSON object — no markdown, no explanation:
{
  "entities": [
    {
      "name": "canonical entity name",
      "type": "PERSON|ORG|PLACE|PRODUCT|SKILL|TOPIC|EVENT|FOOD|ROLE|CONCEPT|THING|DATE",
      "attributes": { "role": "...", "location": "...", "age": "..." }
    }
  ],
  "relationships": [
    {
      "subject": "entity name",
      "predicate": "short verb phrase describing the connection",
      "object": "entity name",
      "confidence": 0.9
    }
  ],
  "literalFacts": [
    {
      "subject": "entity name",
      "predicate": "short verb phrase",
      "value": "non-entity string value",
      "confidence": 0.8
    }
  ]
}

Rules for entities:
- Only extract clearly named, specific entities — not pronouns, not "the user", not vague references
- Use lowercase canonical form (e.g. "openai" not "OpenAI", "alice" not "Alice")
- attributes: store intrinsic properties directly on the entity (role, age, location string, category). Omit if none.
- If no entities, return []

Rules for relationships:
- subject and object must both be entity names from the entities list
- predicate: short, natural, present-tense phrase the LLM invents freely — no fixed vocabulary
- Only include if confidence >= ${minConfidence}
- If no relationships, return []

Rules for literalFacts:
- subject must be an entity name from the entities list
- value must be a plain string, not another entity name
- predicate: short present-tense phrase
- Capture durable user facts: preferences, traits, decisions, relationships to places/products/foods
- Only include if confidence >= ${minConfidence}
- NEVER extract facts where the subject is the assistant, AI, bot, or any agent — only extract facts about human users and real-world entities
- Ignore transient pleasantries and one-off task chatter
- If no literal facts, return []`;

/**
 * Extract a knowledge graph from a raw conversation transcript. Working from raw
 * messages (rather than a lossy episode summary) preserves the direct signal.
 */
export async function extractGraph(
  transcript: string,
  minConfidence = 0.5,
): Promise<ExtractedGraph> {
  const prompt = `Conversation transcript:\n${transcript}`;

  const raw = await attemptExtract<{
    entities?: { name?: string; type?: string; attributes?: Record<string, unknown> }[];
    relationships?: { subject?: string; predicate?: string; object?: string; confidence?: number }[];
    literalFacts?: { subject?: string; predicate?: string; value?: string; confidence?: number }[];
  }>(buildGraphSystem(minConfidence), prompt, (text) => parseJson(text));

  const validTypes = new Set<string>([
    'PERSON', 'ORG', 'PLACE', 'PRODUCT', 'SKILL', 'TOPIC',
    'EVENT', 'FOOD', 'ROLE', 'CONCEPT', 'THING', 'DATE',
  ]);

  const entities: ExtractedEntity[] = (raw.entities ?? [])
    .filter((e) => typeof e.name === 'string' && e.name.trim().length > 0)
    .map((e) => ({
      name: e.name!.toLowerCase().trim(),
      type: (validTypes.has(e.type ?? '') ? e.type : 'THING') as EntityType,
      attributes: sanitizeAttributes(e.attributes ?? {}),
    }));

  const entityNames = new Set(entities.map((e) => e.name));

  const relationships: ExtractedRelationship[] = (raw.relationships ?? [])
    .filter(
      (r) =>
        typeof r.subject === 'string' &&
        typeof r.predicate === 'string' &&
        typeof r.object === 'string' &&
        typeof r.confidence === 'number' &&
        r.confidence >= minConfidence &&
        entityNames.has(r.subject.toLowerCase().trim()) &&
        entityNames.has(r.object.toLowerCase().trim()),
    )
    .map((r) => ({
      subject: r.subject!.toLowerCase().trim(),
      predicate: normalizePredicate(r.predicate!),
      object: r.object!.toLowerCase().trim(),
      confidence: r.confidence!,
    }));

  const NON_USER_SUBJECTS = new Set(['assistant', 'ai', 'bot', 'system', 'agent']);
  const literalFacts: ExtractedLiteralFact[] = (raw.literalFacts ?? [])
    .filter(
      (f) =>
        typeof f.subject === 'string' &&
        typeof f.predicate === 'string' &&
        typeof f.value === 'string' &&
        typeof f.confidence === 'number' &&
        f.confidence >= minConfidence &&
        entityNames.has(f.subject.toLowerCase().trim()) &&
        !NON_USER_SUBJECTS.has(f.subject.toLowerCase().trim()),
    )
    .map((f) => ({
      subject: f.subject!.toLowerCase().trim(),
      predicate: normalizePredicate(f.predicate!),
      value: f.value!.trim(),
      confidence: f.confidence!,
    }));

  return { entities, relationships, literalFacts };
}

// ── Contradiction resolution ───────────────────────────────────────────────────

const CONTRADICTION_SYSTEM = `You are a fact consistency checker. Two facts claim different things about the same subject and relationship.

Respond with JSON only — no markdown, no explanation:
{"contradicts":true,"invalidate":"old"}

invalidate values:
- "old" — new fact supersedes old (change of job, location, status, preference)
- "new" — old fact is still correct and new is wrong or redundant
- "neither" — both can coexist (multiple skills, multiple interests, etc.) or you are uncertain`;

export async function resolveContradiction(
  subject: string,
  predicate: string,
  oldObject: string,
  oldValidAt: string,
  newObject: string,
  newValidAt: string,
): Promise<ContradictionVerdict> {
  const prompt = `Old: "${subject} ${predicate} ${oldObject}" (as of ${oldValidAt})\nNew: "${subject} ${predicate} ${newObject}" (as of ${newValidAt})`;

  try {
    const text = await callGemini(CONTRADICTION_SYSTEM, prompt);
    const trimmed = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(trimmed) as { contradicts?: boolean; invalidate?: string };
    if (!parsed.contradicts) return 'neither';
    if (parsed.invalidate === 'old' || parsed.invalidate === 'new') return parsed.invalidate;
    return 'neither';
  } catch {
    return 'neither';
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizePredicate(predicate: string): string {
  return predicate.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

function sanitizeAttributes(
  raw: Record<string, unknown>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && v.every((item) => typeof item === 'string')) out[k] = v as string[];
  }
  return out;
}
