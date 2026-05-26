# memory-soda — Architecture & Flow

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [End-to-End Chat Flow](#4-end-to-end-chat-flow)
5. [Memory Add — Deep Dive](#5-memory-add--deep-dive)
6. [Memory Retrieve — Deep Dive](#6-memory-retrieve--deep-dive)
7. [Contradiction Detection](#7-contradiction-detection)
8. [The Knowledge Graph](#8-the-knowledge-graph)
9. [API Reference](#9-api-reference)

---

## 1. System Overview

memory-soda is a **semantic memory layer for AI agents**. It sits between your application and your LLM, maintaining a structured knowledge graph about each user. Every conversation is mined for facts, those facts are stored with embeddings and relationships, and before each LLM call the most relevant facts are retrieved and injected into the system prompt — making the agent feel like it genuinely remembers the user.

```
┌──────────────────────────────────────────────────────────────┐
│                    Your AI Application                        │
│                                                              │
│   const memory = new MemorySodaClient({ apiKey, baseUrl })   │
│                                                              │
│   // Before LLM call                                         │
│   const ctx = await memory.retrieve(userId, userMessage)     │
│                                                              │
│   // After LLM response                                      │
│   await memory.add(userId, [userMsg, assistantMsg])          │
└──────────────────┬───────────────────────────────────────────┘
                   │  HTTP + API Key
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    memory-soda API                           │
│                  (Express / Node.js)                         │
│                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐   │
│   │    Gemini    │   │    Neo4j     │   │   Postgres    │   │
│   │  2.5 Flash   │   │  (Graph DB)  │   │  (API Keys)   │   │
│   │  Embedding   │   │             │   │               │   │
│   │    001       │   │             │   │               │   │
│   └──────────────┘   └──────────────┘   └───────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Layer               | Technology                      | Why                                          |
| ------------------- | ------------------------------- | -------------------------------------------- |
| API server          | Express + Node.js               | Lightweight, fast, familiar                  |
| Graph database      | Neo4j 5.18                      | Native graph traversal, vector index support |
| Relational database | Postgres + Drizzle ORM          | API key management, typed schema             |
| LLM                 | Gemini 2.5 Flash                | Fast, cheap, good at structured extraction   |
| Embeddings          | gemini-embedding-001 (3072-dim) | Semantic similarity for fact retrieval       |
| SDK                 | TypeScript, native fetch        | Zero dependencies, works in any Node.js app  |
| Dev console         | Next.js 16 + Tailwind           | Agent builder playground                     |

---

## 3. Repository Structure

```
memory-soda/
├── apps/
│   ├── api/                    — Express API server
│   │   └── src/
│   │       ├── db/
│   │       │   ├── postgres.ts         Pool + Drizzle instance
│   │       │   ├── neo4j.ts            Neo4j driver instance
│   │       │   ├── neo4j-init.ts       Vector index + constraints setup
│   │       │   ├── schema.ts           Drizzle table definitions
│   │       │   └── migrations/         SQL migration files
│   │       ├── services/
│   │       │   ├── gemini.service.ts   LLM + embedding calls
│   │       │   ├── neo4j-memory.service.ts  Core memory algorithm
│   │       │   └── api-key.service.ts  API key CRUD
│   │       ├── routes/
│   │       │   ├── graph.ts            /graph/add, /graph/retrieve, /graph/chat
│   │       │   ├── api-keys.ts         /api-keys CRUD
│   │       │   └── health.ts           /health
│   │       ├── middleware/
│   │       │   ├── auth.ts             API key validation
│   │       │   └── validate.ts         Zod request validation
│   │       └── main.ts                 Bootstrap (migrate → neo4j init → listen)
│   │
│   └── web/                    — Next.js dev console
│       └── src/app/
│           ├── playground/     Agent builder UI
│           └── api-keys/       Key management UI
│
├── packages/
│   ├── sdk/                    — @memory-soda/sdk (npm package)
│   │   └── src/
│   │       ├── client.ts       MemorySodaClient class
│   │       ├── http.ts         Fetch wrapper
│   │       └── errors.ts       Typed error classes
│   └── types/                  — @memory-soda/types (shared types)
│
└── docker-compose.yml          — Neo4j + Postgres + Redis (local dev)
```

---

## 4. End-to-End Chat Flow

This is the full journey of a single user message through the system when using `POST /graph/chat` (the playground endpoint).

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant W as Web (Next.js)
    participant A as API (Express)
    participant G as Gemini 2.5 Flash
    participant E as Gemini Embedding
    participant N as Neo4j

    U->>W: Types message, hits Send
    W->>A: POST /graph/chat<br/>{ userId, messages, systemPromptTemplate }

    note over A: Step 1 — Retrieve relevant memories
    A->>E: embed(lastUserMessage)
    E-->>A: 3072-dim vector
    A->>N: Vector search on MemoryFact nodes<br/>+ graph expand
    N-->>A: Top K relevant facts

    note over A: Step 2 — Build system prompt
    A->>A: Combine systemPromptTemplate<br/>+ formatted memory context

    note over A: Step 3 — LLM call
    A->>G: generateText(systemPrompt, allMessages)
    G-->>A: { text, usage: { promptTokens, completionTokens } }

    note over A: Step 4 — Store new memories
    A->>G: extractFacts([lastUserMsg, aiResponse])
    G-->>A: [{ subject, predicate, object, confidence }]
    loop For each extracted fact
        A->>N: Query existing active facts<br/>(same subject + predicate)
        N-->>A: Existing facts (if any)
        A->>G: classifyFact(newFact, existingFacts)
        G-->>A: NEW | CONTRADICTION | REINFORCEMENT
        A->>N: Apply: create / invalidate+create / reinforce
    end

    note over A: Step 5 — Return everything
    A-->>W: { message, systemPrompt, memoryContext,<br/>memoryLog, usage, latencyMs }
    W-->>U: Renders AI message + memory breakdown panel
```

---

## 5. Memory Add — Deep Dive

`POST /graph/add` (or called internally by `/graph/chat`)

### Input

```typescript
{ userId: string, messages: Message[] }
```

### Algorithm

```mermaid
flowchart TD
    A([Start: messages array]) --> B

    B["🔍 EXTRACT\nGemini LLM call:\nExtract semantic facts as triples\n(subject, predicate, object, confidence)"]
    B --> C{Any facts\nextracted?}
    C -- No --> Z([Return: 0 facts])
    C -- Yes --> D

    D["Loop over each fact"] --> E

    E["RESOLVE SUBJECT\nIf subjectType = User\nor subject = 'I' / 'user'\n→ pin to userId"]
    E --> F

    F["QUERY NEO4J\nFind active MemoryFacts\nwhere userId + subjectName + predicate match\n(invalidAt IS NULL)"]
    F --> G{Existing\nfacts found?}

    G -- None --> H
    G -- Found --> I

    H["CLASSIFY → NEW\n(no existing facts to compare)"]
    H --> J

    I["🤖 CLASSIFY\nGemini LLM call:\nCompare new vs existing fact(s)\n→ CONTRADICTION / REINFORCEMENT / NEW"]
    I --> K{Classification}

    K -- NEW --> J
    K -- REINFORCEMENT --> L
    K -- CONTRADICTION --> M

    J["➕ CREATE\n1. Embed fact text (3072-dim)\n2. MERGE Entity nodes\n3. CREATE MemoryFact node\n4. CREATE :RELATED edge\n5. CREATE :HAS_FACT edges\nfactsCreated++"]
    J --> N

    L["⬆️ REINFORCE\nSET confidence += 0.05 (max 1.0)\nSET lastSeen = now\nfactsUpdated++"]
    L --> N

    M["❌ INVALIDATE old facts\nSET invalidAt = now on MemoryFact\n→ then CREATE new fact (see J)\nfactsInvalidated++\nfactsCreated++"]
    M --> J

    N{More facts\nto process?}
    N -- Yes --> D
    N -- No --> O

    O([Return: AddMemoryResult\nfactsExtracted, Created, Updated, Invalidated\noperation log])
```

### The Extracted Triple Format

Every sentence in a conversation that contains factual information about the user is broken down into a **subject → predicate → object** triple:

```
"I work at Acme Corp as an engineer"
→ (user, WORKS_AT, Acme Corp)
→ (user, HAS_ROLE, Engineer)

"I've known Sarah since college"
→ (user, KNOWS, Sarah)

"I'm based in San Francisco"
→ (user, BASED_IN, San Francisco)

"I'm really into distributed systems"
→ (user, INTERESTED_IN, Distributed Systems)
```

### Entity Types

| Type           | Examples                                      |
| -------------- | --------------------------------------------- |
| `User`         | The person talking (always pinned to userId)  |
| `Person`       | Sarah, John, my manager                       |
| `Organization` | Acme Corp, Google, my team                    |
| `Place`        | San Francisco, London, the office             |
| `Topic`        | Distributed Systems, Python, Machine Learning |
| `Concept`      | Dark mode, remote work, agile                 |
| `Value`        | Raw values like numbers, dates, free text     |

---

## 6. Memory Retrieve — Deep Dive

`POST /graph/retrieve`

### Input

```typescript
{ userId: string, query: string, limit?: number }
```

### Algorithm

```mermaid
flowchart TD
    A([Start: query string]) --> B

    B["📐 EMBED QUERY\ngemini-embedding-001\n→ 3072-dim float vector"]
    B --> C

    C["🔎 VECTOR SEARCH\ndb.index.vector.queryNodes\n  index: memory_facts_embedding\n  candidates: top 20\n  filter: userId + invalidAt IS NULL\n→ Top K facts by cosine similarity"]
    C --> D

    D{Any results\nfound?}
    D -- No --> G
    D -- Yes --> E

    E["🕸️ GRAPH EXPAND\nFor each matched fact's subject entity:\n  MATCH all active MemoryFacts\n  with same subjectName + userId\n→ Pulls in related facts the\n   vector search may have missed"]
    E --> F

    F["DEDUPLICATE + RANK\nMerge vector results + expanded results\nSort: vector score first, then by confidence\nRemove duplicates by fact text"]
    F --> G

    G["📝 FORMAT CONTEXT BLOCK\nBuild human-readable text:\n'Here is what you know about this user:\n - user works at Acme Corp (conf: 95%, since Jan 2025)\n - user knows Sarah (conf: 80%, since Feb 2025)'"]
    G --> H

    H([Return: RetrieveMemoryResult\nfacts array + contextText string])
```

### Why Two Steps (Vector + Graph)?

**Vector search alone** finds semantically similar facts but can miss related context. For example:

- Query: `"what does the user do for work?"`
- Vector search finds: `"user works at Acme Corp"` ✓
- But misses: `"user is an engineer"`, `"user manages a team"` — also relevant but less similar to the query string

**Graph expansion** fetches all active facts for the matched entity, catching those related facts regardless of semantic distance.

---

## 7. Contradiction Detection

When a new fact has the same **subject + predicate** as an existing fact, a second Gemini call decides what to do.

```mermaid
flowchart TD
    A["New fact arrives:\nuser WORKS_AT Globex Corp"]
    A --> B

    B["Query Neo4j:\nActive facts with\nuserId=X, subject=user, predicate=WORKS_AT"]
    B --> C{Existing\nfacts found?}

    C -- None --> D["→ NEW\nNo conflict possible"]
    C -- Found: 'user WORKS_AT Acme Corp' --> E

    E["Gemini classifies:\n\nNew: user WORKS_AT Globex Corp\nExisting: user WORKS_AT Acme Corp\n\n→ CONTRADICTION / REINFORCEMENT / NEW"]

    E --> F{Result}

    F -- CONTRADICTION --> G
    F -- REINFORCEMENT --> H
    F -- NEW --> I

    G["❌ Invalidate old\nSET invalidAt = now()\non MemoryFact node\n\n✓ Create new\nNew MemoryFact for Globex Corp\n\nHistory preserved:\nboth edges remain in graph"]

    H["⬆️ Reinforce\nconfidence += 0.05\nlastSeen = now()\nNo new nodes created"]

    I["➕ Create additional\nBoth facts are valid simultaneously\nUsed for multi-value predicates:\ne.g. INTERESTED_IN Python\nINTERESTED_IN Go\n→ Both are true"]
```

### Bi-temporal Records

We **never delete** facts. Every invalidated fact has both `validAt` and `invalidAt` set, so you can query the state of the graph at any point in time:

```cypher
-- What did we know about this user on March 1st?
MATCH (f:MemoryFact)
WHERE f.userId = 'alice'
  AND f.validAt <= '2025-03-01T00:00:00Z'
  AND (f.invalidAt IS NULL OR f.invalidAt > '2025-03-01T00:00:00Z')
RETURN f
```

---

## 8. The Knowledge Graph

### Node Labels

```
(:User) — not explicitly created; userId is a property on facts/entities
(:Entity { id, name, type, userId })
(:MemoryFact { id, userId, text, predicate, subjectName, subjectType,
               objectName, objectType, embedding, confidence,
               validAt, invalidAt })
```

### Relationship Types

```
(:Entity)-[:RELATED { predicate, factId, confidence, validAt, invalidAt }]->(:Entity)
(:Entity)-[:HAS_FACT]->(:MemoryFact)
```

### Example Graph

After a user says: _"I work at Acme Corp, I know Sarah who's also an engineer there, and I'm based in San Francisco"_

```
(user:Entity {type:User})
    │
    ├──[RELATED: WORKS_AT]──► (acme:Entity {name:"Acme Corp", type:Organization})
    │
    ├──[RELATED: KNOWS]──────► (sarah:Entity {name:"Sarah", type:Person})
    │                               │
    │                               └──[RELATED: WORKS_AT]──► (acme)
    │
    └──[RELATED: BASED_IN]───► (sf:Entity {name:"San Francisco", type:Place})
```

### Vector Index

Each `MemoryFact` node has an `embedding` property — a 3072-dimensional float vector generated by `gemini-embedding-001`. Neo4j maintains a vector index (`memory_facts_embedding`) over this property, enabling approximate nearest-neighbour search with cosine similarity.

---

## 9. API Reference

### Public Endpoints (no auth)

| Method   | Path              | Description                                 |
| -------- | ----------------- | ------------------------------------------- |
| `GET`    | `/health`         | Service health (Postgres, Neo4j, Redis)     |
| `GET`    | `/api-keys`       | List all API keys                           |
| `POST`   | `/api-keys`       | Create an API key `{ name }`                |
| `DELETE` | `/api-keys/:id`   | Revoke an API key                           |
| `POST`   | `/graph/chat`     | Full playground turn (retrieve → LLM → add) |
| `POST`   | `/graph/add`      | Extract + store facts from messages         |
| `POST`   | `/graph/retrieve` | Retrieve relevant facts for a query         |

### Protected Endpoints (require `Authorization: Bearer <key>`)

Currently none — graph routes are public for the dev console POC. SDK-facing routes will be added here as the product matures.

### `/graph/chat` Request / Response

```typescript
// Request
{
  userId: string
  messages: { role: 'user' | 'assistant', content: string }[]
  systemPromptTemplate?: string   // optional custom base prompt
}

// Response
{
  message: string                 // AI response text
  systemPrompt: string            // Full system prompt sent to LLM (with memory injected)
  memoryContext: ContextFact[]    // Facts that were retrieved and injected
  memoryLog: MemoryOperationStep[] // Every memory operation that ran
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  latencyMs: number
}
```

### `/graph/add` Request / Response

```typescript
// Request
{
  userId: string
  messages: { role: 'user' | 'assistant', content: string }[]
}

// Response
{
  result: {
    userId: string
    factsExtracted: number
    factsCreated: number
    factsUpdated: number
    factsInvalidated: number
    log: MemoryOperationStep[]
  }
}
```

### SDK Usage

```typescript
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'https://your-api.example.com',
  apiKey: 'ms_...',
});

// In your agent loop:
const context = await memory.retrieve(userId, userMessage);
const systemPrompt = `You are a helpful assistant.\n\n${context.contextText}`;

const aiResponse = await yourLLM.chat(systemPrompt, messages);

await memory.add(userId, [
  { role: 'user', content: userMessage },
  { role: 'assistant', content: aiResponse },
]);
```
