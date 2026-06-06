ALTER TABLE "threads"
  ADD COLUMN "auto_compact_threshold"   integer CHECK (auto_compact_threshold IS NULL OR auto_compact_threshold >= 1),
  ADD COLUMN "last_compacted_at"        timestamptz,
  ADD COLUMN "last_compacted_sequence"  integer NOT NULL DEFAULT 0;

ALTER TABLE "messages"
  ADD COLUMN "compacted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "messages_thread_compacted_idx"
  ON "messages" ("thread_id", "compacted_at");
