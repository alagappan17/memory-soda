import { eq, sql } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { users } from '../db/schema.js';
import type { User } from '@memory-soda/types';
import { hashPassword } from '../lib/password.js';

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createUser(
  username: string,
  password: string,
): Promise<User> {
  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(users)
    .values({ username, passwordHash })
    .returning();
  return rowToUser(row!);
}

/**
 * Replace a stored hash in place. Used to transparently upgrade a hash that was
 * derived with weaker scrypt parameters, after its password has been verified.
 */
export async function updateUserPasswordHash(
  id: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id));
}

export async function listUsers(): Promise<User[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map(rowToUser);
}

export async function getUserByUsername(
  username: string,
): Promise<typeof users.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return row ?? null;
}

/**
 * Delete a user unless it is the last one left.
 *
 * The count and the delete run in one transaction with the user rows locked
 * (`FOR UPDATE`). Checking the count and then deleting as two statements lets
 * two concurrent requests both pass the guard and empty the table, locking
 * everyone out of the dashboard.
 */
export async function deleteUserIfNotLast(
  id: string,
): Promise<'deleted' | 'not_found' | 'last_user'> {
  return db.transaction(async (tx) => {
    const locked = await tx.select({ id: users.id }).from(users).for('update');
    if (!locked.some((u) => u.id === id)) return 'not_found';
    if (locked.length <= 1) return 'last_user';
    await tx.delete(users).where(eq(users.id, id));
    return 'deleted';
  });
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}
