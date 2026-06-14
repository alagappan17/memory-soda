import { randomBytes, createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { apiKeys } from '../db/schema.js';
import type { ApiKey } from '@memory-soda/types';
import { getOrCreateDefaultProject } from './project.service.js';

function generateKey(): string {
  return 'ms_' + randomBytes(32).toString('hex');
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function rowToApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPreview: row.keyPreview,
    projectId: row.projectId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function createApiKey(
  name: string,
  projectId?: string,
): Promise<{ apiKey: ApiKey; key: string }> {
  const key = generateKey();
  const keyPreview = key.slice(0, 10) + '...' + key.slice(-4);
  const hashedKey = hashKey(key);
  const resolvedProjectId = projectId ?? (await getOrCreateDefaultProject()).id;

  const [row] = await db
    .insert(apiKeys)
    .values({ name, key: hashedKey, keyPreview, projectId: resolvedProjectId })
    .returning();

  return { apiKey: rowToApiKey(row!), key };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const rows = await db.select().from(apiKeys).orderBy(apiKeys.createdAt);
  return rows.map(rowToApiKey);
}

export async function findApiKeyByValue(
  key: string,
): Promise<typeof apiKeys.$inferSelect | null> {
  const hashed = hashKey(key);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.key, hashed))
    .limit(1);
  return row ?? null;
}

export async function revokeApiKey(id: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id));
}

export async function touchApiKey(id: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, id));
}
