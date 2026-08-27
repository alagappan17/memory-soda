import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { apiKeys } from '../db/schema.js';
import type { ApiKey } from '@memory-soda/types';
import { hashToken, issueToken } from '../lib/opaque-token.js';
import { getOrCreateDefaultProject } from './project.service.js';

const KEY_PREFIX = 'ms_';

function toApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
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
  const { plaintext, hash, preview } = issueToken(KEY_PREFIX);
  const resolvedProjectId = projectId ?? (await getOrCreateDefaultProject()).id;

  const [row] = await db
    .insert(apiKeys)
    .values({
      name,
      key: hash,
      keyPreview: preview,
      projectId: resolvedProjectId,
    })
    .returning();

  if (!row) throw new Error('Failed to create API key');
  return { apiKey: toApiKey(row), key: plaintext };
}

/** List keys, optionally narrowed to one project. */
export async function listApiKeys(projectId?: string): Promise<ApiKey[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(projectId ? eq(apiKeys.projectId, projectId) : undefined)
    .orderBy(asc(apiKeys.createdAt));
  return rows.map(toApiKey);
}

export async function findApiKeyByValue(
  key: string,
): Promise<typeof apiKeys.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.key, hashToken(key)))
    .limit(1);
  return row ?? null;
}

/** Revoke a key. Returns false when there was nothing live to revoke. */
export async function revokeApiKey(id: string): Promise<boolean> {
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id)))
    .returning({ id: apiKeys.id });
  return revoked.length > 0;
}

export async function touchApiKey(id: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, id));
}
