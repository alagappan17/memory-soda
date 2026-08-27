import { db } from '../db/postgres.js';
import { projects } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { mergeWithDefaults } from '@memory-soda/types';
import type {
  Project,
  ProjectSettings,
  ProjectSettingsPatch,
} from '@memory-soda/types';

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjects(): Promise<Project[]> {
  const rows = await db.select().from(projects).orderBy(projects.createdAt);
  return rows.map(rowToProject);
}

export async function createProject(
  name: string,
  description?: string,
): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({ name, description })
    .returning();
  return rowToProject(row!);
}

const DEFAULT_PROJECT_NAME = 'default';

export async function getOrCreateDefaultProject(): Promise<Project> {
  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.name, DEFAULT_PROJECT_NAME))
    .limit(1);
  if (existing) return rowToProject(existing);
  const [row] = await db
    .insert(projects)
    .values({
      name: DEFAULT_PROJECT_NAME,
      description: 'Auto-created default project',
    })
    .returning();
  return rowToProject(row!);
}

/** Whether a project id refers to a real project. */
export async function projectExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row !== undefined;
}

export async function deleteProject(id: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id));
}

export async function updateProject(
  id: string,
  name: string,
  description?: string,
): Promise<Project> {
  const [row] = await db
    .update(projects)
    .set({ name, description })
    .where(eq(projects.id, id))
    .returning();
  if (!row) throw new Error('Project not found');
  return rowToProject(row);
}

export async function getProjectSettings(id: string): Promise<ProjectSettings> {
  const [row] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, id));
  if (!row) throw new Error('Project not found');
  return mergeWithDefaults(row.settings);
}

export async function updateProjectSettings(
  id: string,
  settings: ProjectSettingsPatch,
): Promise<ProjectSettings> {
  const episodicPatch = JSON.stringify(settings.episodic ?? {});
  const semanticPatch = JSON.stringify(settings.semantic ?? {});
  const [updated] = await db
    .update(projects)
    .set({
      settings: sql`jsonb_set(
        jsonb_set(
          COALESCE(${projects.settings}, '{}'::jsonb),
          '{episodic}',
          COALESCE(${projects.settings}->'episodic', '{}'::jsonb) || ${episodicPatch}::jsonb
        ),
        '{semantic}',
        COALESCE(${projects.settings}->'semantic', '{}'::jsonb) || ${semanticPatch}::jsonb
      )`,
    })
    .where(eq(projects.id, id))
    .returning();
  if (!updated) throw new Error('Project not found');
  return mergeWithDefaults(updated.settings);
}
