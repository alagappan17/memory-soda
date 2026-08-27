import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { sessions } from '../db/schema.js';
import { hashToken, issueToken } from '../lib/opaque-token.js';

const SESSION_PREFIX = 'ms_sess_';

/** Sessions live for 7 days from creation. Expired rows are swept by the worker. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a session. The plaintext token is returned once and only its hash is
 * stored.
 */
export async function createSession(
  userId: string,
): Promise<{ token: string; sessionId: string }> {
  const { plaintext, hash } = issueToken(SESSION_PREFIX);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      token: hash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning();

  if (!row) throw new Error('Failed to create session');
  return { token: plaintext, sessionId: row.id };
}

export async function findSessionByValue(
  token: string,
): Promise<typeof sessions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, hashToken(token)))
    .limit(1);
  return row ?? null;
}

export async function revokeSession(id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, id));
}

export async function touchSession(id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.id, id));
}
