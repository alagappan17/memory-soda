CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"key_preview" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
