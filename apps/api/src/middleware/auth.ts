import type { Request, Response, NextFunction } from 'express';
import type { ApiKeyPayload } from '@memory-soda/types';
import { findApiKeyByValue, touchApiKey } from '../services/api-key.service.js';

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyPayload;
      projectId?: string;
    }
  }
}

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const row = await findApiKeyByValue(token);

    if (!row) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    if (row.revokedAt) {
      res.status(401).json({ error: 'API key has been revoked' });
      return;
    }

    if (!row.projectId) {
      res.status(401).json({ error: 'API key is not linked to a project' });
      return;
    }

    // Non-blocking last-used update
    touchApiKey(row.id).catch(() => {});

    req.apiKey = { keyId: row.id, projectId: row.projectId, name: row.name };
    req.projectId = row.projectId;
    next();
  } catch (err) {
    console.error('[auth] error checking API key:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
