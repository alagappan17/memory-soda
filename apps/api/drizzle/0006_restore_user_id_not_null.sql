UPDATE "threads" SET "user_id" = 'anonymous' WHERE "user_id" IS NULL;
ALTER TABLE "threads" ALTER COLUMN "user_id" SET NOT NULL;
