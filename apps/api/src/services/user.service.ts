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
  const passwordHash = hashPassword(password);
  const [row] = await db
    .insert(users)
    .values({ username, passwordHash })
    .returning();
  return rowToUser(row!);
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

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}
