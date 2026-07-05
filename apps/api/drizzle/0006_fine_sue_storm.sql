ALTER TABLE "facts" ADD COLUMN IF NOT EXISTS "source_quote" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN IF NOT EXISTS "valid_until" timestamp with time zone;--> statement-breakpoint
-- Rebuild the keyword-search GIN index without context_entity_name (dropped in
-- 0005). The retrieval query MUST use this exact to_tsvector expression for the
-- planner to use the index.
DROP INDEX IF EXISTS "facts_tsv_idx";--> statement-breakpoint
CREATE INDEX "facts_tsv_idx" ON "facts" USING gin (to_tsvector('english', coalesce("subject", '') || ' ' || coalesce("predicate", '') || ' ' || coalesce("object", '')));--> statement-breakpoint
-- Wipe + re-extract: existing facts/entities were produced by the weaker
-- pre-hardening extraction prompt and the old column semantics. Resetting
-- semantic_status lets the sweep rebuild everything with source quotes,
-- valid-time bounds, and per-episode scoping.
TRUNCATE TABLE "facts";--> statement-breakpoint
TRUNCATE TABLE "entities";--> statement-breakpoint
-- Only non-archived episodes: with a NULL sequence range they re-extract the
-- whole uncompacted thread, so the latest (completed) episode per thread
-- already covers everything its archived predecessors saw.
UPDATE "episodes" SET "semantic_status" = 'pending', "semantic_retry_count" = 0 WHERE "semantic_status" IN ('completed', 'failed', 'skipped') AND "status" = 'completed';
