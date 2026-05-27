import { db } from '../db/postgres.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Project } from '@memory-soda/types';

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjects(): Promise<Project[]> {
  const rows = await db.select().from(projects).orderBy(projects.createdAt);
  return rows.map(rowToProject);
}

export async function createProject(name: string): Promise<Project> {
  const [row] = await db.insert(projects).values({ name }).returning();
  return rowToProject(row!);
}

export async function deleteProject(id: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id));
}
