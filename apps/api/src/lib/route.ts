import type { Request, RequestHandler, Response } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { AppError } from './errors.js';

/**
 * Typed route handlers.
 *
 * A handler declares the schemas for the parts of the request it reads and
 * receives the parsed values as arguments. Nothing round-trips through `req`,
 * so nothing has to be cast back to the type the schema already proved, which
 * is what `req.body as z.infer<typeof schema>` was doing at every call site.
 *
 * Handlers return their response body and throw {@link AppError} for anything
 * the caller should see. The error middleware turns both into a response, so
 * the try/catch that used to open and close every handler is gone.
 */

export interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type Parsed<S extends ZodTypeAny | undefined> =
  S extends ZodTypeAny ? z.infer<S> : undefined;

export interface RequestInput<S extends Schemas> {
  body: Parsed<S['body']>;
  query: Parsed<S['query']>;
  params: Parsed<S['params']>;
  req: Request;
  res: Response;
}

/** A response that is not a plain 200 with a JSON body. */
class Responded<T> {
  constructor(
    readonly status: number,
    readonly body: T,
  ) {}
}

/** Respond 201 with a body. */
export function created<T>(body: T): Responded<T> {
  return new Responded(201, body);
}

/** Respond 204 with no body. */
export function noContent(): Responded<undefined> {
  return new Responded(204, undefined);
}

function parse<S extends ZodTypeAny | undefined>(
  schema: S,
  value: unknown,
  where: 'body' | 'query' | 'params',
): Parsed<S> {
  // The two assertions in this function are the generic boundary: for any
  // concrete schema `Parsed<S>` *is* `S['_output']`, but TypeScript cannot
  // prove that through the conditional type. They are the reason no handler
  // needs one.
  if (!schema) return undefined as Parsed<S>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw AppError.badRequest(`Invalid request ${where}`, result.error.issues);
  }
  return result.data as Parsed<S>;
}

async function send(res: Response, result: unknown): Promise<void> {
  if (res.headersSent) return;
  if (result instanceof Responded) {
    if (result.status === 204) {
      res.status(204).send();
      return;
    }
    res.status(result.status).json(result.body);
    return;
  }
  res.json(result);
}

/**
 * A route with no project context, auth, user administration, health.
 */
export function route<S extends Schemas>(
  schemas: S,
  handler: (input: RequestInput<S>) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const input: RequestInput<S> = {
        body: parse(schemas.body, req.body, 'body'),
        query: parse(schemas.query, req.query, 'query'),
        params: parse(schemas.params, req.params, 'params'),
        req,
        res,
      };
      await send(res, await handler(input));
    })().catch(next);
  };
}

/**
 * A route scoped to one project.
 *
 * `projectId` is resolved by whichever guard the router was mounted behind,
 * the API key for `/v1`, the query parameter for `/dashboard`. Its absence is a
 * mounting mistake rather than a client error, so it fails loudly as a 500
 * instead of being asserted away with `!`.
 */
export function projectRoute<S extends Schemas>(
  schemas: S,
  handler: (input: RequestInput<S> & { projectId: string }) => Promise<unknown>,
): RequestHandler {
  return route(schemas, async (input) => {
    const projectId = input.res.locals.projectId;
    if (typeof projectId !== 'string') {
      throw new AppError(
        500,
        'Route is not mounted behind a project guard',
      );
    }
    return handler({ ...input, projectId });
  });
}
