ALTER TABLE "threads"  ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "model"      text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "latency_ms" integer;

CREATE INDEX IF NOT EXISTS "threads_tags_idx" ON "threads" USING gin ("tags");
