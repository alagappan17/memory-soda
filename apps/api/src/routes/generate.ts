import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { generateReply } from '../lib/gemini.js';

const router = Router();

const generateSchema = z.object({
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ).min(1),
  systemPrompt: z.string().optional(),
  episodes: z.any().optional(),
  facts: z.any().optional(),
});

router.post(
  '/',
  validateBody(generateSchema),
  asyncHandler(async (req, res) => {
    const { messages, systemPrompt, episodes, facts } = req.body as z.infer<typeof generateSchema>;
    const t0 = Date.now();
    const content = await generateReply(messages, systemPrompt, episodes ?? null, facts ?? null);
    res.json({ content, model: 'gemini-2.5-flash', latencyMs: Date.now() - t0 });
  }),
);

export default router;
