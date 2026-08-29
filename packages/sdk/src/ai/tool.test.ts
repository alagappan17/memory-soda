import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { memoryTool } from './tool.ts';
import type { MemorySoda } from '../client.ts';

function memoryWith(recall: (req: unknown) => Promise<{ context: string }>) {
  return { recall } as unknown as MemorySoda;
}

describe('memoryTool', () => {
  test('describes a single required query parameter', () => {
    const tool = memoryTool({ memory: memoryWith(async () => ({ context: '' })), dataset: 'u' });
    assert.deepEqual(tool.inputSchema.required, ['query']);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.match(tool.description, /remembered/);
    assert.equal(memoryTool({ memory: memoryWith(async () => ({ context: '' })), dataset: 'u', description: 'custom' }).description, 'custom');
  });

  test('returns recalled context, passing dataset, query and limit', async () => {
    let seen: unknown;
    const tool = memoryTool({
      memory: memoryWith(async (req) => { seen = req; return { context: 'likes tea' }; }),
      dataset: 'u',
      limit: 3,
    });
    assert.equal(await tool.execute({ query: 'drinks' }), 'likes tea');
    assert.deepEqual(seen, { dataset: 'u', query: 'drinks', limit: 3 });
  });

  test('empty memory and failures become plain sentences, never throws', async () => {
    const empty = memoryTool({ memory: memoryWith(async () => ({ context: '' })), dataset: 'u' });
    assert.match(await empty.execute({ query: 'x' }), /Nothing is recorded/);

    const warn = console.warn;
    console.warn = () => {};
    try {
      const broken = memoryTool({ memory: memoryWith(async () => { throw new Error('down'); }), dataset: 'u' });
      assert.match(await broken.execute({ query: 'x' }), /temporarily unavailable/);
    } finally {
      console.warn = warn;
    }
  });
});
