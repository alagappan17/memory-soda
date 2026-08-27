import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUOTE_LEN,
  clampConfidence,
  normalizeEntityType,
  normalizeName,
  normalizePredicate,
  sanitizeDate,
  sanitizeQuote,
} from './extraction-normalize.ts';
import { buildTranscript } from './transcript.ts';
import { mergeWithDefaults } from '@memory-soda/types';

describe('sanitizeDate', () => {
  test('normalizes a parseable date to ISO day precision', () => {
    assert.equal(sanitizeDate('2026-07-05T13:22:00Z'), '2026-07-05');
    assert.equal(sanitizeDate('  2019-01-01  '), '2019-01-01');
  });

  test('rejects the placeholder the prompt shows the model', () => {
    assert.equal(sanitizeDate('YYYY-MM-DD or null'), null);
    assert.equal(sanitizeDate('null'), null);
  });

  test('rejects empty, missing and unparseable values', () => {
    assert.equal(sanitizeDate(''), null);
    assert.equal(sanitizeDate('   '), null);
    assert.equal(sanitizeDate('sometime next year'), null);
    assert.equal(sanitizeDate(undefined), null);
    assert.equal(sanitizeDate(null), null);
  });
});

describe('sanitizeQuote', () => {
  test('an empty quote becomes null, not an empty string', () => {
    assert.equal(sanitizeQuote('   '), null);
    assert.equal(sanitizeQuote(null), null);
  });

  test('caps a long quote at the documented length', () => {
    const long = 'x'.repeat(MAX_QUOTE_LEN + 50);
    assert.equal(sanitizeQuote(long)?.length, MAX_QUOTE_LEN);
  });
});

describe('normalizePredicate', () => {
  test('two phrasings of one predicate collapse to the same key', () => {
    assert.equal(normalizePredicate('  Works   At! '), 'works at');
    assert.equal(normalizePredicate('works at'), 'works at');
  });

  test('keeps letters, digits, underscores and single spaces', () => {
    assert.equal(normalizePredicate('is_interested-in (a) topic'), 'is_interestedin a topic');
  });

  test('preserves non-latin letters', () => {
    assert.equal(normalizePredicate('日本語 が 好き'), '日本語 が 好き');
  });
});

describe('normalizeEntityType', () => {
  test('passes through a known type', () => {
    assert.equal(normalizeEntityType('PERSON'), 'PERSON');
  });

  test('falls back to THING for anything unrecognized', () => {
    assert.equal(normalizeEntityType('SPACESHIP'), 'THING');
    assert.equal(normalizeEntityType('person'), 'THING');
  });
});

describe('clampConfidence', () => {
  test('clamps out-of-range scores into [0, 1]', () => {
    assert.equal(clampConfidence(1.7), 1);
    assert.equal(clampConfidence(-0.2), 0);
    assert.equal(clampConfidence(0.42), 0.42);
  });

  test('a non-finite score is treated as certain rather than dropped', () => {
    assert.equal(clampConfidence(Number.NaN), 1);
  });
});

test('normalizeName lowercases and trims so aliases converge', () => {
  assert.equal(normalizeName('  DJI Osmo Pocket 3 '), 'dji osmo pocket 3');
});

describe('buildTranscript', () => {
  const msgs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ role: 'user', content: `m${i}` }));

  test('passes a short conversation through untouched', () => {
    assert.equal(buildTranscript(msgs(3), 100), 'user: m0\nuser: m1\nuser: m2');
  });

  test('keeps the head and the tail, dropping the middle', () => {
    const out = buildTranscript(msgs(60), 30);
    assert.ok(out.includes('user: m0'), 'opening turn survives');
    assert.ok(out.includes('user: m59'), 'final turn survives');
    assert.ok(!out.includes('user: m30\n'), 'middle is dropped');
  });

  test('the omission count matches the messages actually dropped', () => {
    const out = buildTranscript(msgs(60), 30);
    const kept = out.split('\n').filter((l) => l.startsWith('user: ')).length;
    const claimed = Number(/\[\.\.\. (\d+) messages omitted/.exec(out)?.[1]);
    assert.equal(kept + claimed, 60);
  });

  test('a limit below the head size still produces a bounded transcript', () => {
    const out = buildTranscript(msgs(60), 5);
    const kept = out.split('\n').filter((l) => l.startsWith('user: ')).length;
    assert.equal(kept, 5);
  });
});

describe('mergeWithDefaults', () => {
  test('an absent settings blob yields the full defaults', () => {
    const s = mergeWithDefaults(null);
    assert.equal(s.episodic.enabled, true);
    assert.equal(s.semantic.factsInContext, 8);
  });

  test('a partial patch overrides only the keys it names', () => {
    const s = mergeWithDefaults({ semantic: { factsInContext: 25 } });
    assert.equal(s.semantic.factsInContext, 25);
    assert.equal(s.semantic.retrievalMinConfidence, 0.5);
    assert.equal(s.episodic.maxRetries, 3);
  });
});
