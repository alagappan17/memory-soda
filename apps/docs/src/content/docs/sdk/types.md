---
title: 'Type reference'
description: 'Every type exported from @memory-soda/sdk. All are type-only exports.'
---

Every type exported from `@memory-soda/sdk`. All are type-only exports.

```ts
import type { RecallResponse, SemanticFact } from '@memory-soda/sdk';
```

## Client

```ts
interface MemorySodaConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number; // ms, default 60_000
}

type ServiceStatus = 'ok' | 'error';

interface HealthResponse {
  status: ServiceStatus;
  services: { postgres: ServiceStatus };
}
```

## Threads

```ts
interface WMThread {
  threadId: string;
  dataset: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO 8601
  lastActivityAt: string;
  settings: WMThreadSettings;
  lastCompactedAt: string | null;
  lastCompactedSequence: number;
}

interface WMThreadSettings {
  autoCompactThreshold: number | null;
  episodic: ProjectEpisodicSettings;
}

interface WMCreateThreadRequest {
  dataset?: string; // generated if omitted
  tags?: string[];
  metadata?: Record<string, unknown>;
  autoCompactThreshold?: number; // >= 2
  settings?: { episodic?: Partial<ProjectEpisodicSettings> };
}

interface WMCreateThreadResponse {
  threadId: string;
  projectId: string; // the project the API key belongs to
  dataset: string;
  createdAt: string;
  settings: WMThreadSettings;
}

interface WMPatchThreadRequest {
  metadata: Record<string, unknown>; // merged, not replaced
}

interface WMEndThreadResponse {
  threadId: string;
  episodeQueued: boolean;
}
```

> `WMThread` has **no** `messageCount`. Use `WMThreadStatsResponse`.

## Messages

```ts
type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

interface WMTokenCount {
  input?: number;
  output?: number;
  total?: number;
}

interface WMMessageMetadata {
  stopReason?: string;
  agentName?: string;
}

interface WMMessage {
  messageId: string;
  threadId: string;
  role: MessageRole;
  content: string;
  sequenceNumber: number;
  tokens: WMTokenCount | null;
  model: string | null;
  latencyMs: number | null;
  metadata: WMMessageMetadata | null;
  compactedAt: string | null;
  createdAt: string;
}

interface WMAddMessageRequest {
  role: MessageRole;
  content: string; // non-empty
  tokens?: WMTokenCount;
  model?: string;
  latencyMs?: number;
  metadata?: WMMessageMetadata;
}

interface WMAddMessageResponse {
  messageId: string;
  threadId: string;
  sequenceNumber: number;
  role: MessageRole;
  createdAt: string;
  compacted: boolean; // this insert triggered compaction
}

interface WMListMessagesQuery {
  limit?: number; // 1–100, default 20
  before?: number; // cursor on sequenceNumber
  order?: 'asc' | 'desc'; // default 'asc'
}

interface WMListMessagesResponse {
  messages: WMMessage[];
  total: number;
  hasMore: boolean;
}
```

> The token field is `tokens`. It was renamed from `tokenCount`; the old name is
> silently ignored if sent.

## Prepare

```ts
interface WMPrepareRequest {
  messageLimit?: number; // 1–100, default 20
}

interface WMPrepareResponse {
  threadId: string;
  dataset: string;
  messages: { role: string; content: string }[];
  messageCount: number;
  truncated: boolean;
  compacted: boolean;
  warning?: string; // messageLimit < autoCompactThreshold
}
```

## Compaction and stats

```ts
interface WMCompactResult {
  threadId: string;
  summaryMessageId: string;
  compactedCount: number;
  fromSequence: number;
  toSequence: number;
}

interface WMCompactSummaryMetadata {
  type: 'compact_summary';
  compactedRange: { fromSeq: number; toSeq: number; count: number };
}

interface WMTokenUsage {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  averagePerMessage: number;
}

interface WMThreadStatsResponse {
  threadId: string;
  messageCount: number;
  tokenUsage: WMTokenUsage | null;
  sessionDuration: { ms: number; seconds: number } | null;
  createdAt: string;
  lastActivityAt: string;
}
```

> `compact()` may resolve to `{ ok: true, compacted: false, message: string }`
> when there is nothing to compact, which does not match `WMCompactResult`.
> Narrow before use.

## Recall

```ts
interface RecallRequest {
  dataset: string; // required, 1–256 chars
  query?: string; // max 2000 chars
  include?: ('episodes' | 'synthesis' | 'raw')[];
  limit?: number; // 1–100
  minConfidence?: number; // 0–1
  asOf?: string; // ISO datetime or date
}

interface RecallResponse {
  context: string; // always; "" when empty
  factCount: number; // always
  synthesis: string | null; // include: ['synthesis']
  facts: SemanticFact[] | null; // include: ['raw']
  groups: RankedContextGroup[] | null; // include: ['raw']
  episodes: EpisodeContext | null; // include: ['episodes']
}

interface RankedContextGroup {
  entityName: string; // the anchor
  facts: {
    subject: string;
    predicate: string;
    object: string;
    sourceQuote: string | null;
    validAt: string;
    validUntil: string | null;
    relevanceScore: number;
  }[];
  groupRelevance: number; // max score in the group
}
```

## Semantic memory

```ts
const ENTITY_TYPES = [
  'PERSON',
  'ORG',
  'PLACE',
  'PRODUCT',
  'SKILL',
  'TOPIC',
  'EVENT',
  'FOOD',
  'ROLE',
  'CONCEPT',
  'THING',
  'DATE',
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

interface SemanticFact {
  factId: string;
  subject: string; // always 'user'
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  confidence: number; // 0–1, model self-rated
  sourceQuote: string | null;
  validAt: string;
  validUntil: string | null;
  invalidAt: string | null;
  episodeId: string | null;
  relevanceScore?: number; // only on retrieval results
}

interface SemanticEntity {
  entityId: string;
  name: string;
  type: EntityType;
}

interface SemanticContext {
  facts: SemanticFact[];
  factCount: number;
}

interface SemanticFactsQuery {
  q?: string;
  limit?: number;
  includeInvalidated?: boolean;
  asOf?: string;
}

interface SemanticFactsResponse {
  facts: SemanticFact[];
  total: number;
}

interface SemanticEntitiesResponse {
  entities: SemanticEntity[];
}
interface SemanticEntityFactsResponse {
  facts: SemanticFact[];
}
```

## Episodic

```ts
interface EpisodeContextItem {
  episodeId: string;
  summary: string;
  keyLearnings: string[];
  startedAt: string;
  endedAt: string;
  relevanceScore: number;
}

interface EpisodeContext {
  episodes: EpisodeContextItem[] | null;
  episodeCount: number; // total for the dataset, not the array length
}
```

## Settings

```ts
interface ProjectEpisodicSettings {
  enabled: boolean;
  autoEpisodeIntervalMs: number | null;
  maxMessages: number;
  maxRetries: number;
  contextEpisodes: number;
  similarityWeight: number;
  recencyWeight: number;
}

interface ProjectSemanticSettings {
  enabled: boolean;
  retrievalMinConfidence: number;
  factsInContext: number;
  entityResolutionThreshold: number;
  factDedupThreshold: number;
  contradictionBandMin: number;
  anchorVectorMin: number;
  anchorVectorTopK: number;
}

interface ProjectSettings {
  episodic: ProjectEpisodicSettings;
  semantic: ProjectSemanticSettings;
}
```

Defaults: [Project settings](/reference/project-settings/).

## Errors

```ts
class MemorySodaError extends Error {}

class ApiError extends MemorySodaError {
  readonly status: number;
  readonly body: unknown;
}

class AuthError extends MemorySodaError {}

class NetworkError extends MemorySodaError {
  readonly networkCause?: unknown;
}
```

## Conventions

- **All timestamps are ISO 8601 UTC strings**, never `Date` objects. Parse with
  `new Date(...)`.
- **`null` means "absent"**; optional (`?`) means "may be omitted from the
  request".
- Fields documented as "only with `include`" are `null`, not missing, when not
  requested.

## Next

- [`MemorySoda`](/sdk/client/)
- [Errors](/sdk/errors/)
