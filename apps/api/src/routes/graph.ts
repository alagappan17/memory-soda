import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { addMemory, retrieveMemory } from '../services/neo4j-memory.service.js';
import { generateChatResponse } from '../services/gemini.service.js';

const router = Router();

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

// POST /graph/add — extract facts from conversation and store in graph
const addBodySchema = z.object({
  userId: z.string().min(1),
  messages: z.array(messageSchema).min(1),
});

router.post('/add', validateBody(addBodySchema), async (req, res) => {
  try {
    const { userId, messages } = req.body as z.infer<typeof addBodySchema>;
    const result = await addMemory(userId, messages);
    res.json({ result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add memory' });
  }
});

// POST /graph/retrieve — semantic retrieval for a query
const retrieveBodySchema = z.object({
  userId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
});

router.post('/retrieve', validateBody(retrieveBodySchema), async (req, res) => {
  try {
    const { userId, query, limit } = req.body as z.infer<typeof retrieveBodySchema>;
    const result = await retrieveMemory(userId, query, limit);
    res.json({ result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve memory' });
  }
});

// POST /graph/chat — full agent turn: retrieve → LLM → store → return everything
const chatBodySchema = z.object({
  userId: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  systemPromptTemplate: z.string().optional(),
});

router.post('/chat', validateBody(chatBodySchema), async (req, res) => {
  try {
    const { userId, messages, systemPromptTemplate } = req.body as z.infer<typeof chatBodySchema>;

    const start = Date.now();

    // Step 1: get the latest user message for retrieval query
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) {
      res.status(400).json({ error: 'No user message found' });
      return;
    }

    // Step 2: retrieve relevant memories
    const memoryResult = await retrieveMemory(userId, lastUserMsg.content);

    // Step 3: build system prompt
    const basePrompt = systemPromptTemplate?.trim() ||
      'You are a helpful, friendly assistant with memory. Use the user context below to give personalised, relevant responses.';
    const systemPrompt = memoryResult.contextText
      ? `${basePrompt}\n\n${memoryResult.contextText}`
      : basePrompt;

    // Step 4: call Gemini
    const chatResult = await generateChatResponse(systemPrompt, messages);

    const latencyMs = Date.now() - start;

    // Step 5: store the new turn in memory (last user msg + AI response)
    const newTurn = [
      lastUserMsg,
      { role: 'assistant' as const, content: chatResult.text },
    ];
    const memoryLog = await addMemory(userId, newTurn);

    res.json({
      message: chatResult.text,
      systemPrompt,
      memoryContext: memoryResult.facts,
      memoryLog: memoryLog.log,
      usage: chatResult.usage,
      latencyMs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

export default router;
