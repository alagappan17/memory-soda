import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { partsToText, toMemoryMessages } from './messages.ts';

describe('partsToText', () => {
  test('passes a plain string through', () => {
    assert.equal(partsToText('hello'), 'hello');
  });

  test('joins text parts', () => {
    assert.equal(
      partsToText([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]),
      'first\nsecond',
    );
  });

  test('records a tool call rather than dropping it', () => {
    const out = partsToText([
      { type: 'tool-call', toolName: 'searchFlights', input: { to: 'BLR' } },
    ]);
    assert.equal(out, '[called searchFlights({"to":"BLR"})]');
  });

  test('records a tool result — often the only durable fact in a turn', () => {
    const out = partsToText([
      { type: 'tool-result', toolName: 'getProfile', output: { tier: 'gold' } },
    ]);
    assert.equal(out, '[getProfile returned {"tier":"gold"}]');
  });

  test('keeps text alongside tool calls in order', () => {
    const out = partsToText([
      { type: 'text', text: 'Looking that up.' },
      { type: 'tool-call', toolName: 'lookup', input: 'x' },
    ]);
    assert.equal(out, 'Looking that up.\n[called lookup(x)]');
  });

  test('ignores parts it does not understand', () => {
    assert.equal(
      partsToText([
        { type: 'file', data: 'base64...' },
        { type: 'text', text: 'caption' },
      ]),
      'caption',
    );
  });

  test('survives content that is not parts at all', () => {
    assert.equal(partsToText(undefined), '');
    assert.equal(partsToText(null), '');
    assert.equal(partsToText(42), '');
  });

  test('does not throw on input that cannot be serialized', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const out = partsToText([
      { type: 'tool-call', toolName: 'loop', input: circular },
    ]);
    assert.ok(out.startsWith('[called loop('));
  });
});

describe('toMemoryMessages', () => {
  test('converts the four storable roles', () => {
    const out = toMemoryMessages([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: [{ type: 'text', text: 'ok' }] },
    ]);
    assert.deepEqual(
      out.map((m) => m.role),
      ['system', 'user', 'assistant', 'tool'],
    );
  });

  test('skips roles the memory store does not model', () => {
    const out = toMemoryMessages([
      { role: 'developer', content: 'internal' },
      { role: 'user', content: 'kept' },
    ]);
    assert.deepEqual(out, [{ role: 'user', content: 'kept' }]);
  });

  test('drops messages that flatten to nothing rather than storing blanks', () => {
    const out = toMemoryMessages([
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ type: 'file', data: 'x' }] },
      { role: 'user', content: 'real' },
    ]);
    assert.deepEqual(out, [{ role: 'user', content: 'real' }]);
  });

  test('an empty conversation converts to an empty list', () => {
    assert.deepEqual(toMemoryMessages([]), []);
  });
});
