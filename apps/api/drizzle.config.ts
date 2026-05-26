import { defineConfig } from 'drizzle-kit';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
