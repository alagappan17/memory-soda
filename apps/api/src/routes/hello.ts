import { Router } from 'express';
import { z } from 'zod';
import type { HelloWorldResponse } from '@memory-soda/types';

const router = Router();

const helloResponseSchema = z.object({
  message: z.string(),
}) satisfies z.ZodType<HelloWorldResponse>;

router.get('/', (_req, res) => {
  const response = helloResponseSchema.parse({ message: 'Hello, World!' });
  res.json(response);
});

export default router;
