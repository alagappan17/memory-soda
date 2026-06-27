import { db } from '../db/postgres.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type {
  Project,
  ProjectSettings,
  ProjectSettingsPatch,
} from '@memory-soda/types';
import { mergeWithDefaults } from '../lib/project-settings.js';
import { NotFoundError } from '../lib/errors.js';

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
  if (!row) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return rowToProject(row);
}

export async function getProjectSettings(id: string): Promise<ProjectSettings> {
  const [row] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, id));
  if (!row) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  const raw = row.settings as ProjectSettingsPatch | null;
  return mergeWithDefaults(raw);
}

export async function updateProjectSettings(
  id: string,
  patch: ProjectSettingsPatch,
): Promise<ProjectSettings> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, id))
      .for('update');
    if (!row) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');

    const stored = (row.settings as ProjectSettingsPatch | null) ?? {};
    // Shallow-merge each provided tier; leave unspecified tiers untouched.
    const next: ProjectSettingsPatch = {
      ...stored,
      ...(patch.episodic && {
        episodic: { ...stored.episodic, ...patch.episodic },
      }),
      ...(patch.semantic && {
        semantic: { ...stored.semantic, ...patch.semantic },
      }),
      ...(patch.working && {
        working: { ...stored.working, ...patch.working },
      }),
    };

    const [updated] = await tx
      .update(projects)
      .set({ settings: next })
      .where(eq(projects.id, id))
      .returning();
    return mergeWithDefaults(updated!.settings as ProjectSettingsPatch);
  });
}
