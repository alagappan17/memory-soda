import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { projects } from '../db/schema.js';
import { mergeWithDefaults } from '../lib/project-settings.js';
import type { ProjectSettings, ProjectSettingsPatch } from '@memory-soda/types';

export async function getProjectSettings(
  projectId: string,
): Promise<ProjectSettings> {
  const [row] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId));
  return mergeWithDefaults(row?.settings as ProjectSettingsPatch | null);
}
