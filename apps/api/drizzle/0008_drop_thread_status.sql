DROP INDEX IF EXISTS "threads_status_activity_idx";
ALTER TABLE "threads" DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "thread_status";
CREATE INDEX IF NOT EXISTS "threads_activity_idx" ON "threads" ("last_activity_at");
