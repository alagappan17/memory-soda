import { randomBytes, createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { sessions } from '../db/schema.js';

// Sessions live for 7 days from creation.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  return 'ms_sess_' + randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a session for a user. Returns the plaintext token, which is shown to
 * the client once and only ever stored hashed.
 */
export async function createSession(
  userId: string,
): Promise<{ token: string; sessionId: string }> {
  const token = generateToken();
  const hashed = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const [row] = await db
    .insert(sessions)
    .values({ userId, token: hashed, expiresAt })
    .returning();

  return { token, sessionId: row!.id };
}

export async function findSessionByValue(
  token: string,
): Promise<typeof sessions.$inferSelect | null> {
  const hashed = hashToken(token);
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, hashed))
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
