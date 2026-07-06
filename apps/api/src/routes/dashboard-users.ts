import { Router, type Response } from 'express';
import { z } from 'zod';
import { listUsers } from '../services/dashboard.service.js';
import {
  querySemanticFacts,
  listEntities,
  softDeleteFact,
} from '../services/semantic-memory.service.js';
import { listUserEpisodes } from '../services/episodic-memory.service.js';
import { boolish } from '../middleware/validate.js';

const router = Router();

const listUsersSchema = z.object({
  projectId: z.string().uuid(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const factsSchema = z.object({
  projectId: z.string().uuid(),
  q: z.string().optional(),
  includeInvalidated: boolish,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const projectSchema = z.object({ projectId: z.string().uuid() });

const episodesSchema = z.object({
  projectId: z.string().uuid(),
  status: z
    .enum(['all', 'pending', 'processing', 'completed', 'failed', 'archived'])
    .default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

function badRequest(res: Response, issues: unknown) {
  res.status(400).json({ error: 'Validation error', issues });
}

// GET /dashboard/users?projectId=&q=&limit=&offset=
router.get('/', async (req, res) => {
  const parsed = listUsersSchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.issues);
  try {
    res.json(await listUsers(parsed.data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /dashboard/users/:userId/facts?projectId=&q=&includeInvalidated=&limit=
router.get('/:userId/facts', async (req, res) => {
  const parsed = factsSchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.issues);
  try {
    const result = await querySemanticFacts(
      req.params.userId,
      parsed.data.projectId,
      {
        q: parsed.data.q,
        limit: parsed.data.limit,
        includeInvalidated: parsed.data.includeInvalidated,
      },
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list facts' });
  }
});

// GET /dashboard/users/:userId/entities?projectId=
router.get('/:userId/entities', async (req, res) => {
  const parsed = projectSchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.issues);
  try {
    const entities = await listEntities(req.params.userId, parsed.data.projectId);
    res.json({ entities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list entities' });
  }
});

// GET /dashboard/users/:userId/episodes?projectId=&status=&limit=&before=
router.get('/:userId/episodes', async (req, res) => {
  const parsed = episodesSchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.issues);
  try {
    const result = await listUserEpisodes(
      req.params.userId,
      parsed.data.projectId,
      {
        limit: parsed.data.limit,
        status: parsed.data.status,
        before: parsed.data.before,
      },
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list episodes' });
  }
});

// DELETE /dashboard/users/:userId/facts/:factId?projectId=
router.delete('/:userId/facts/:factId', async (req, res) => {
  const parsed = projectSchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.issues);
  try {
    const deleted = await softDeleteFact(
      req.params.userId,
      parsed.data.projectId,
      req.params.factId,
    );
    if (!deleted) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }
    res.json({ factId: req.params.factId, deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete fact' });
  }
});

export default router;
