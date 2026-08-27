import 'express';

/**
 * What the auth guards put on `res.locals`.
 *
 * `res.locals` rather than fields bolted onto `Request`: the previous shape
 * made `projectId` an optional property of *every* request in the application,
 * which is why every handler that needed it ended in `req.projectId!`. Here the
 * guard writes it and `projectRoute` reads it in one place, so the assertion
 * exists once instead of twenty-two times.
 */
declare module 'express' {
  interface Locals {
    /** The project this request operates on, set by whichever guard ran. */
    projectId?: string;
    /** Present when the caller authenticated with an API key. */
    apiKey?: { keyId: string; name: string };
    /** Present when the caller authenticated with a dashboard session. */
    session?: { sessionId: string; userId: string; username: string };
  }
}
