import { Router } from 'express';
import { z } from 'zod';
import { created, noContent, route } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../db/postgres.js';
import {
  createUser,
  listUsers,
  deleteUserIfNotLast,
} from '../../services/user.service.js';

const router = Router();

const createBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(6).max(200),
});

router.get(
  '/',
  route({}, async () => ({ users: await listUsers() })),
);

router.post(
  '/',
  route({ body: createBody }, async ({ body }) => {
    try {
      return created({ user: await createUser(body.username, body.password) });
    } catch (err) {
      // The unique index is the check. A read-then-write guard would let two
      // concurrent creates for the same name both pass before either inserts.
      if (isUniqueViolation(err)) throw AppError.conflict('Username already taken');
      throw err;
    }
  }),
);

/**
 * Delete a user — unless it is you, or the last one. Either would lock someone
 * out of the dashboard with no way back in.
 */
router.delete(
  '/:id',
  route(
    { params: z.object({ id: z.string().uuid() }) },
    async ({ params, res }) => {
      if (res.locals.session?.userId === params.id) {
        throw AppError.badRequest('You cannot delete your own account');
      }

      const result = await deleteUserIfNotLast(params.id);
      if (result === 'not_found') throw AppError.notFound('User');
      if (result === 'last_user') {
        throw AppError.badRequest('Cannot delete the last user');
      }
      return noContent();
    },
  ),
);

export default router;
