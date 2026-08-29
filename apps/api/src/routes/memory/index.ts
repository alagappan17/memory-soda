import { Router } from 'express';
import threadsRouter from './threads.js';
import workingRouter from './working.js';
import episodicRouter from './episodic.js';
import semanticRouter from './semantic.js';
import recallRouter from './recall.js';

/**
 * Every project-scoped memory route.
 *
 * Mounted twice, once at `/v1` behind an API key, once at `/dashboard/v1`
 * behind a login session, because the dashboard needs the same reads the SDK
 * does and holds a different credential. Mounting one router beats maintaining
 * a parallel set of dashboard-only endpoints that drift from these.
 *
 * Every handler here uses `projectRoute`, which reads the project from
 * `res.locals`, so the router itself is agnostic to which guard resolved it.
 */
const router = Router();

router.use('/threads', threadsRouter);
router.use('/memory/working', workingRouter);
router.use('/memory/episodic', episodicRouter);
router.use('/memory/semantic', semanticRouter);
router.use('/memory/recall', recallRouter);

export default router;
