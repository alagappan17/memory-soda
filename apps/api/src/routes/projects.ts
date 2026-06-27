import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  createProject,
  listProjects,
  deleteProject,
  updateProject,
  getProjectSettings,
  updateProjectSettings,
} from '../services/project.service.js';

const router = Router();

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const settingsPatchSchema = z.object({
  episodic: z
    .object({
      enabled: z.boolean().optional(),
      autoEpisodeIntervalMs: z.number().min(1_000).nullable().optional(),
      maxMessages: z.number().int().min(10).max(1000).optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      episodesInContext: z.number().int().min(1).max(20).optional(),
      recencyWeight: z.number().min(0).max(1).optional(),
    })
    .optional(),
  semantic: z
    .object({
      enabled: z.boolean().optional(),
      factsInContext: z.number().int().min(1).max(50).optional(),
      entitySimilarityThreshold: z.number().min(0.5).max(1).optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      minUserFacts: z.number().int().min(1).max(10).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
    })
    .optional(),
  working: z
    .object({
      autoCompactThreshold: z.number().int().min(2).nullable().optional(),
      messageLimit: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});

/**
 * @route GET /dashboard/projects
 * @description List all projects.
 * @returns {{ projects: Project[] }}
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const p = await listProjects();
    res.json({ projects: p });
  }),
);

/**
 * @route POST /dashboard/projects
 * @description Create a new project. Projects scope API keys and working memory threads.
 * @body {{ name: string, description?: string }}
 * @returns {{ project: Project }}
 */
router.post(
  '/',
  validateBody(createBodySchema),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body as z.infer<typeof createBodySchema>;
    const project = await createProject(name, description);
    res.status(201).json({ project });
  }),
);

/**
 * @route PATCH /dashboard/projects/:id
 * @description Update a project's name or description.
 * @param {string} id - The project ID.
 * @body {{ name: string, description?: string }}
 * @returns {{ project: Project }}
 */
router.patch(
  '/:id',
  validateBody(updateBodySchema),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body as z.infer<typeof updateBodySchema>;
    const project = await updateProject(req.params['id'], name, description);
    res.json({ project });
  }),
);

/**
 * @route DELETE /dashboard/projects/:id
 * @description Delete a project. Does not cascade-delete associated API keys or threads.
 * @param {string} id - The project ID.
 * @returns 204 No Content
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteProject(req.params['id']);
    res.status(204).send();
  }),
);

/**
 * @route GET /dashboard/projects/:id/settings
 * @description Get project settings (merged with defaults).
 */
router.get(
  '/:id/settings',
  asyncHandler(async (req, res) => {
    const settings = await getProjectSettings(req.params['id']);
    res.json({ settings });
  }),
);

/**
 * @route PATCH /dashboard/projects/:id/settings
 * @description Partially update project settings.
 */
router.patch(
  '/:id/settings',
  validateBody(settingsPatchSchema),
  asyncHandler(async (req, res) => {
    const patch = req.body as z.infer<typeof settingsPatchSchema>;
    const settings = await updateProjectSettings(req.params['id'], patch);
    res.json({ settings });
  }),
);

export default router;
