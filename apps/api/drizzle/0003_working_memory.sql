CREATE TYPE thread_status AS ENUM ('active', 'ended', 'timed_out');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'tool');

CREATE TABLE IF NOT EXISTS "threads" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"          text NOT NULL,
  "api_key_id"       uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "status"           thread_status NOT NULL DEFAULT 'active',
  "metadata"         jsonb,
  "message_count"    integer NOT NULL DEFAULT 0,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "ended_at"         timestamptz,
  "last_activity_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id"       uuid NOT NULL REFERENCES "threads"("id") ON DELETE CASCADE,
  "role"            message_role NOT NULL,
  "content"         text NOT NULL,
  "sequence_number" integer NOT NULL,
  "token_count"     jsonb,
  "metadata"        jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "archived_at"     timestamptz
);

CREATE INDEX IF NOT EXISTS "messages_thread_seq_idx"      ON "messages" ("thread_id", "sequence_number");
CREATE INDEX IF NOT EXISTS "messages_thread_time_idx"     ON "messages" ("thread_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "threads_status_activity_idx"  ON "threads"  ("status", "last_activity_at");
