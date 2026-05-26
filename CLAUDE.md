# Memory Soda — Project Wiki Schema

## What this repo is

A memory layer for AI applications. We are building entity extraction, contradiction detection, confidence scoring, and hybrid retrieval from scratch on top of Neo4j + Fastify (Node.js). We are NOT using Graphiti.

Stack: Fastify API, Neo4j (graph + vector index), Postgres + Drizzle ORM (API keys), Gemini 2.5 Flash (LLM), gemini-embedding-001 (3072-dim embeddings), Next.js web console, TypeScript SDK (`@memory-soda/sdk`).

## Wiki rules

- `wiki/` contains all synthesized knowledge. Claude maintains it entirely.
- `wiki/index.md` is the catalog — always keep it current.
- `wiki/log.md` is append-only — never edit past entries.
- Every session ends with: update `wiki/index.md` + append to `wiki/log.md`.
- `raw/` contains source documents (papers, notes). Never modify these.

## On session start

Read these three files to get up to speed:
1. `CLAUDE.md` — this file (schema + conventions)
2. `wiki/index.md` — catalog of all pages
3. `wiki/log.md` — history of sessions

## On ingest (new paper / article)

1. Read the source
2. Discuss key takeaways with user
3. Write `wiki/papers/<slug>.md` with: summary, key ideas, relevance to project
4. Update any concept or architecture pages it touches
5. Note any contradictions with existing pages
6. Append to `log.md`: `## [DATE] ingest | <title>`

## On design decisions

1. Write `wiki/decisions/<slug>.md` with: context, options considered, chosen approach, reason
2. Update `wiki/architecture/` pages affected
3. Append to `log.md`: `## [DATE] decision | <title>`

## On queries

1. Read `index.md` to find relevant pages
2. Read those pages
3. Synthesize answer with citations to wiki pages
4. If the answer is reusable knowledge, file it as a new wiki page

## On lint (run periodically)

Check for: orphan pages, stale claims, missing cross-links, concepts mentioned but lacking their own page, gaps that need research.

## Conventions

- Every page has frontmatter: `title`, `created`, `updated`, `tags`
- Cross-link with `[[page-name]]` notation
- Decisions link to the papers that informed them
- Architecture pages list open questions at the bottom
- Never delete a decision page — mark superseded ones with a `superseded-by:` field
