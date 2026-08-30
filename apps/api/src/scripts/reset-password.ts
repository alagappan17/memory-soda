// Lockout escape hatch: `npm run admin:reset-password -- <username> <new-password>`.
// Needs DATABASE_URL; anyone with that already owns the data, so no further auth.
import { eq } from 'drizzle-orm';

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 6) {
    console.error(
      'usage: npm run admin:reset-password -- <username> <new-password (6+ chars)>',
    );
    process.exit(1);
  }

  // Imported here so a bad invocation prints usage instead of a config error.
  const [{ db }, { users }, { hashPassword }] = await Promise.all([
    import('../db/postgres.js'),
    import('../db/schema.js'),
    import('../lib/password.js'),
  ]);

  const [row] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.username, username))
    .returning({ username: users.username });
  if (!row) {
    console.error(`no user named "${username}"`);
    process.exit(1);
  }
  console.log(`password updated for "${row.username}"`);
  process.exit(0);
}

void main();
