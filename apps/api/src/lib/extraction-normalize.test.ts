import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUOTE_LEN,
  assembleGraph,
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
    assert.equal(
      normalizePredicate('is_interested-in (a) topic'),
      'is_interestedin a topic',
    );
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

describe('assembleGraph', () => {
  const fact = (subject: string, predicate: string) => ({
    subject,
    predicate,
    confidence: 0.9,
    sourceQuote: null,
    validFrom: null,
    validUntil: null,
  });
  const raw = (over: Partial<Parameters<typeof assembleGraph>[0]>) => ({
    entities: [],
    relationships: [],
    literalFacts: [],
    ...over,
  });

  test('a literal whose value names an entity becomes a relationship', () => {
    const g = assembleGraph(
      raw({
        entities: [{ name: 'ASICS Novablast 5', type: 'PRODUCT' }],
        literalFacts: [
          { ...fact('user', 'bought'), value: 'Asics Novablast 5' },
        ],
      }),
    );
    assert.deepEqual(
      g.relationships.map((r) => [r.subject, r.predicate, r.object]),
      [['user', 'bought', 'asics novablast 5']],
    );
    assert.equal(g.literalFacts.length, 0);
  });

  test('a relationship whose object is not an entity is demoted to a literal', () => {
    const g = assembleGraph(
      raw({
        relationships: [
          { ...fact('user', 'has movie nights on'), object: 'Fridays' },
        ],
      }),
    );
    assert.equal(g.relationships.length, 0);
    assert.deepEqual(
      g.literalFacts.map((f) => f.value),
      ['Fridays'],
    );
    assert.deepEqual(
      g.entities.map((e) => e.name),
      ['user'],
    );
  });

  test('an entity the user is linked to in the same batch may be a subject', () => {
    const g = assembleGraph(
      raw({
        entities: [{ name: 'honda civic', type: 'PRODUCT' }],
        relationships: [{ ...fact('user', 'owns'), object: 'honda civic' }],
        literalFacts: [
          { ...fact('honda civic', 'has mileage'), value: '120,000 km' },
        ],
      }),
    );
    assert.deepEqual(
      g.literalFacts.map((f) => [f.subject, f.value]),
      [['honda civic', '120,000 km']],
    );
  });

  test('a known entity may be a subject even without a fresh user link', () => {
    const g = assembleGraph(
      raw({
        entities: [{ name: 'honda civic', type: 'PRODUCT' }],
        literalFacts: [
          { ...fact('honda civic', 'has mileage'), value: '120,000 km' },
        ],
      }),
      [{ name: 'honda civic', type: 'PRODUCT' }],
    );
    assert.equal(g.literalFacts.length, 1);
  });

  test('a relationship to a known entity links even when the model did not co-list it', () => {
    const g = assembleGraph(
      raw({
        relationships: [{ ...fact('user', 'drives'), object: 'Honda Civic' }],
      }),
      [{ name: 'honda civic', type: 'PRODUCT' }],
    );
    assert.deepEqual(
      g.relationships.map((r) => r.object),
      ['honda civic'],
    );
  });

  test('encyclopedia content about an unlinked entity is dropped', () => {
    const g = assembleGraph(
      raw({
        entities: [
          { name: 'asus rog', type: 'PRODUCT' },
          { name: 'rtx 4070', type: 'PRODUCT' },
        ],
        relationships: [
          { ...fact('asus rog', 'features'), object: 'rtx 4070' },
        ],
        literalFacts: [
          { ...fact('gaming laptop', 'is a type of'), value: 'laptop' },
        ],
      }),
    );
    assert.equal(g.relationships.length, 0);
    assert.equal(g.literalFacts.length, 0);
  });

  test('entities no surviving fact references are pruned, user always kept', () => {
    const g = assembleGraph(
      raw({
        entities: [
          { name: 'running', type: 'THING' },
          { name: 'roads', type: 'THING' },
          { name: 'user', type: 'PERSON' },
          { name: 'user', type: 'PERSON' },
        ],
        relationships: [{ ...fact('user', 'runs on'), object: 'roads' }],
      }),
    );
    assert.deepEqual(g.entities.map((e) => e.name).sort(), ['roads', 'user']);
  });

  test('self-loops and empty values are dropped', () => {
    const g = assembleGraph(
      raw({
        relationships: [{ ...fact('user', 'is'), object: 'user' }],
        literalFacts: [{ ...fact('user', 'likes'), value: '   ' }],
      }),
    );
    assert.equal(g.relationships.length, 0);
    assert.equal(g.literalFacts.length, 0);
  });
});
