import { Router } from 'express';
import { z } from 'zod';
import { created, projectRoute } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import {
  addMessage,
  prepareThread,
} from '../../services/working-memory.service.js';
import { recall } from '../../services/recall.service.js';
import { generateReply } from '../../lib/gemini.js';
import type { RecallResponse, WMChatResponse } from '@memory-soda/types';

/**
 * The playground's chat turn: the server runs the model itself.
 *
 * Dashboard-only on purpose. SDK consumers run their own model and use
 * `prepare()` + `recall()`, so shipping this on the API-key surface would
 * advertise a demo as part of the product and tie every integrator to Gemini.
 */
const router = Router();

const chatBody = z.object({
  content: z.string().min(1),
  systemPrompt: z.string().optional(),
  messageLimit: z.number().int().min(1).max(100).default(20),
  /** Include the full recall payload that was injected into the model call. */
  verbose: z.boolean().optional(),
});

const EMPTY_RECALL: RecallResponse = {
  context: '',
  synthesis: null,
  facts: null,
  groups: null,
  episodes: null,
  factCount: 0,
};

router.post(
  '/threads/:threadId/chat',
  projectRoute(
    { params: z.object({ threadId: z.string().uuid() }), body: chatBody },
    async ({ params, body, projectId }) => {
      const { threadId } = params;

      const { message: userMessage, thread } = await addMessage(
        threadId,
        projectId,
        { role: 'user', content: body.content },
      );

      // Working memory is pure SQL and long-term memory does the embedding and
      // LLM work, so the two reads run in parallel. Recall is best-effort: the
      // user's message is already persisted, and an unpersonalised answer beats
      // a failed turn.
      const [prepared, recalled] = await Promise.all([
        prepareThread(threadId, projectId, { messageLimit: body.messageLimit }),
        recall(projectId, {
          dataset: thread.dataset,
          query: body.content,
          include: ['episodes', 'synthesis', 'raw'],
        }).catch((err): RecallResponse => {
          console.error('[chat] recall failed, answering without memory:', err);
          return EMPTY_RECALL;
        }),
      ]);
      if (!prepared) throw AppError.notFound('Thread');

      // Synthesis leads, then the structured fact block — both are user-derived
      // semantic memory and share the same framing in the system prompt.
      const contextBlock = [recalled.synthesis, recalled.context]
        .filter((part): part is string => Boolean(part))
        .join('\n\n');

      const replyContent = await generateReply(
        prepared.messages,
        body.systemPrompt,
        recalled.episodes,
        contextBlock,
      );

      const { message: assistantMessage, compacted } = await addMessage(
        threadId,
        projectId,
        { role: 'assistant', content: replyContent },
      );

      const response: WMChatResponse = {
        userMessage: {
          messageId: userMessage.messageId,
          sequenceNumber: userMessage.sequenceNumber,
          role: userMessage.role,
          createdAt: userMessage.createdAt,
        },
        assistantMessage: {
          messageId: assistantMessage.messageId,
          sequenceNumber: assistantMessage.sequenceNumber,
          role: assistantMessage.role,
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
        compacted,
        prepare: {
          messageCount: prepared.messageCount,
          truncated: prepared.truncated,
          compacted: prepared.compacted,
        },
        recallSummary: {
          episodeCount: recalled.episodes?.episodeCount ?? 0,
          factCount: recalled.factCount,
          hasContext: recalled.context.length > 0,
          hasSynthesis: Boolean(recalled.synthesis),
        },
        ...(body.verbose ? { recall: recalled } : {}),
      };
      return created(response);
    },
  ),
);

export default router;
