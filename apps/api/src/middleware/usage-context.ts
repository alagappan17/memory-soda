import type { RequestHandler } from 'express';
import { log, runWithUsage } from '../lib/usage.js';

/**
 * Open a usage context for the request so everything it triggers (model
 * calls, embeddings, spans) is attributed to this request, key and project.
 * Also logs one `http` span per request: API latency and error rate come
 * from the same table as the model spend.
 *
 * Mounted after the auth guard so `res.locals` already names the caller.
 */
export const usageContext: RequestHandler = (req, res, next) => {
  const { projectId, apiKey, session } = res.locals;
  const t0 = Date.now();
  runWithUsage(
    {
      source: apiKey ? 'api' : 'dashboard',
      operation: `${req.method} ${req.baseUrl}${req.path}`,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      apiKeyId: apiKey?.keyId,
      userId: session?.userId,
    },
    () => {
      res.on('finish', () => {
        log({
          stage: 'http',
          kind: 'span',
          latencyMs: Date.now() - t0,
          ok: res.statusCode < 500,
          error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
          meta: { status: res.statusCode, method: req.method },
        });
      });
      next();
    },
  );
};
