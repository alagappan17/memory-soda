---
name: eval-extraction
description: Measure the effect of a change to the fact/entity extraction prompt or normaliser by running fixed transcripts through extractGraph before and after and diffing. Use before touching apps/api/src/lib/semantic-extraction.ts, gemini.ts or extraction-normalize.ts.
---

# Eval extraction

The few-shot examples and rules in `apps/api/src/lib/semantic-extraction.ts`
decide what the whole memory layer remembers. Eyeballing a prompt diff is not
a review. Do this instead:

1. Baseline (before editing):
   ```bash
   set -a; source .env; set +a      # needs GOOGLE_GENERATIVE_AI_API_KEY + DATABASE_URL
   for f in tools/fixtures/*.txt; do
     node --no-warnings --import ./tools/resolve-ts.mjs tools/eval-extraction.ts "$f" > "/tmp/before-$(basename "$f" .txt).json"
   done
   ```
2. Make the change.
3. Re-run into `/tmp/after-*.json`, then `diff -u /tmp/before-X.json /tmp/after-X.json`
   per fixture. Gemini is non-deterministic at the margins: run each side
   twice; only treat a change as real if it shows in both runs.
4. Judge against the rules the prompt states — durable facts only, one fact per
   requirement, typos folded into canonical entities, no assistant-stated specs,
   no task chatter. List, per fixture: facts gained, lost, reworded.
5. Pure post-processing (`extraction-normalize.ts`) gets a unit test in
   `extraction-normalize.test.ts` instead of an LLM run.

Fixtures live in `tools/fixtures/*.txt`, one `role: content` line per message.
Add a fixture whenever a real-world transcript exposed a bad extraction; keep
them in the docs example world (cars, Netflix, sci-fi) so they double as doc
material. Never commit fixtures containing real user data.

Report the diff summary, not the raw JSON.
