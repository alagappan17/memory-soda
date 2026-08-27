import { Router } from 'express';
import { z } from 'zod';
import { created, noContent, route } from '../../lib/route.js';
import {
  createProject,
  listProjects,
  deleteProject,
  updateProject,
  getProjectSettings,
  updateProjectSettings,
} from '../../services/project.service.js';

const router = Router();

const idParams = z.object({ id: z.string().uuid() });

const projectBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const settingsPatch = z.object({
  episodic: z
    .object({
      enabled: z.boolean().optional(),
      autoEpisodeIntervalMs: z.number().min(1_000).nullable().optional(),
      maxMessages: z.number().int().min(10).max(1000).optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      contextEpisodes: z.number().int().min(1).max(20).optional(),
      similarityWeight: z.number().min(0).max(1).optional(),
      recencyWeight: z.number().min(0).max(1).optional(),
    })
    .optional(),
  semantic: z
    .object({
      enabled: z.boolean().optional(),
      retrievalMinConfidence: z.number().min(0).max(1).optional(),
      factsInContext: z.number().int().min(1).max(100).optional(),
      entityResolutionThreshold: z.number().min(0).max(1).optional(),
      factDedupThreshold: z.number().min(0).max(1).optional(),
      contradictionBandMin: z.number().min(0).max(1).optional(),
      anchorVectorMin: z.number().min(0).max(1).optional(),
      anchorVectorTopK: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
});

router.get(
  '/',
  route({}, async () => ({ projects: await listProjects() })),
);

router.post(
  '/',
  route({ body: projectBody }, async ({ body }) =>
    created({ project: await createProject(body.name, body.description) }),
  ),
);

router.patch(
  '/:id',
  route({ params: idParams, body: projectBody }, async ({ params, body }) => ({
    project: await updateProject(params.id, body.name, body.description),
  })),
);

/**
 * Delete a project and everything scoped to it — API keys, threads, messages,
 * episodes, facts and entities all cascade.
 */
router.delete(
  '/:id',
  route({ params: idParams }, async ({ params }) => {
    await deleteProject(params.id);
    return noContent();
  }),
);

router.get(
  '/:id/settings',
  route({ params: idParams }, async ({ params }) => ({
    settings: await getProjectSettings(params.id),
  })),
);

router.patch(
  '/:id/settings',
  route(
    { params: idParams, body: settingsPatch },
    async ({ params, body }) => ({
      settings: await updateProjectSettings(params.id, body),
    }),
  ),
);

export default router;
