import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { config } from './config.js';
import { isAppError } from './lib/errors.js';
import { requireApiKey, requireSession } from './middleware/authenticate.js';
import { projectFromQuery } from './middleware/project-scope.js';
import { usageContext } from './middleware/usage-context.js';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import memoryRouter from './routes/memory/index.js';
import projectsRouter from './routes/admin/projects.js';
import apiKeysRouter from './routes/admin/api-keys.js';
import usersRouter from './routes/admin/users.js';
import browseRouter from './routes/admin/browse.js';
import chatRouter from './routes/admin/chat.js';
import usageRouter from './routes/admin/usage.js';

/** The HTTP app without a listener, so tests can mount it on any port. */
const { corsOrigins } = config.server;

const app = express();

app.use(cors({ origin: [...corsOrigins] }));
app.use(express.json({ limit: '1mb' }));
if (process.env['NODE_ENV'] !== 'test') app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/auth', authRouter);

// ── SDK surface ──────────────────────────────────────────────────────────────
// The API key names the project, so no other scoping is needed.
app.use('/v1', requireApiKey, usageContext, memoryRouter);

// ── Dashboard surface ────────────────────────────────────────────────────────
// The same memory router under a login session. A session can see several
// projects, so the project comes from `?projectId=` instead of the credential.
app.use(
  '/dashboard/v1',
  requireSession,
  projectFromQuery,
  usageContext,
  memoryRouter,
);
app.use(
  '/dashboard/chat',
  requireSession,
  projectFromQuery,
  usageContext,
  chatRouter,
);
app.use('/dashboard/browse', requireSession, projectFromQuery, browseRouter);
app.use('/dashboard/usage', requireSession, projectFromQuery, usageRouter);
app.use('/dashboard/projects', requireSession, projectsRouter);
app.use('/dashboard/api-keys', requireSession, apiKeysRouter);
app.use('/dashboard/users', requireSession, usersRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

/**
 * The one place a failure becomes a response.
 *
 * Services throw {@link AppError} for anything the caller should see; anything
 * else is a bug, and its message stays in the logs rather than the response
 * body where it could leak a query or a connection string.
 */
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (isAppError(err)) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details === undefined ? {} : { issues: err.details }),
    });
    return;
  }
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
