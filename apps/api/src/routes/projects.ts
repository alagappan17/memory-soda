import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
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
      maxMessages: z.number().int().min(10).max(1000).optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      retryDelayMs: z.number().int().min(60000).optional(),
      contextEpisodes: z.number().int().min(1).max(20).optional(),
      similarityWeight: z.number().min(0).max(1).optional(),
      recencyWeight: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

/**
 * @route GET /dashboard/projects
 * @description List all projects.
 * @returns {{ projects: Project[] }}
 */
router.get('/', async (_req, res) => {
  try {
    const p = await listProjects();
    res.json({ projects: p });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * @route POST /dashboard/projects
 * @description Create a new project. Projects scope API keys and working memory threads.
 * @body {{ name: string, description?: string }}
 * @returns {{ project: Project }}
 */
router.post('/', validateBody(createBodySchema), async (req, res) => {
  try {
    const { name, description } = req.body as z.infer<typeof createBodySchema>;
    const project = await createProject(name, description);
    res.status(201).json({ project });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * @route PATCH /dashboard/projects/:id
 * @description Update a project's name or description.
 * @param {string} id - The project ID.
 * @body {{ name: string, description?: string }}
 * @returns {{ project: Project }}
 */
router.patch('/:id', validateBody(updateBodySchema), async (req, res) => {
  try {
    const { name, description } = req.body as z.infer<typeof updateBodySchema>;
    const project = await updateProject(req.params['id'], name, description);
    res.json({ project });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * @route DELETE /dashboard/projects/:id
 * @description Delete a project. Does not cascade-delete associated API keys or threads.
 * @param {string} id - The project ID.
 * @returns 204 No Content
 */
router.delete('/:id', async (req, res) => {
  try {
    await deleteProject(req.params['id']);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/**
 * @route GET /dashboard/projects/:id/settings
 * @description Get project settings (merged with defaults).
 */
router.get('/:id/settings', async (req, res) => {
  try {
    const settings = await getProjectSettings(req.params['id']);
    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get project settings' });
  }
});

/**
 * @route PATCH /dashboard/projects/:id/settings
 * @description Partially update project settings.
 */
router.patch(
  '/:id/settings',
  validateBody(settingsPatchSchema),
  async (req, res) => {
    try {
      const patch = req.body as z.infer<typeof settingsPatchSchema>;
      const settings = await updateProjectSettings(req.params['id'], patch);
      res.json({ settings });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update project settings' });
    }
  },
);

export default router;
