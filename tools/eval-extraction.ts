// Run the semantic extraction prompt over a transcript file and print the
// graph it produces. For comparing prompt edits: run before, run after, diff.
//
//   set -a; source .env; set +a
//   node --no-warnings --import ./tools/resolve-ts.mjs tools/eval-extraction.ts fixtures/cars.txt [> out.json]
//
// Transcript format: one `role: content` per line (what buildTranscript emits).
import { readFileSync } from 'node:fs';
import { extractGraph } from '../apps/api/src/lib/semantic-extraction.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: eval-extraction.ts <transcript.txt>');
  process.exit(1);
}
const graph = await extractGraph(readFileSync(file, 'utf8'));
// Stable ordering so two runs diff cleanly.
const key = (f: { subject: string; predicate: string }) => `${f.subject}|${f.predicate}`;
const sortBy = <T>(xs: T[], k: (x: T) => string) => [...xs].sort((a, b) => k(a).localeCompare(k(b)));
console.log(
  JSON.stringify(
    {
      entities: sortBy(graph.entities, (e) => e.name),
      relationships: sortBy(graph.relationships, key),
      literalFacts: sortBy(graph.literalFacts, key),
    },
    null,
    2,
  ),
);
