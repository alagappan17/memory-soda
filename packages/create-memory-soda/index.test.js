import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderEnv, isUsableTarget } from './index.js';

const base = {
  databaseUrl: 'postgresql://u:p@localhost:5432/memory_db',
  geminiKey: 'AIza-test',
  adminUser: 'admin',
  adminPassword: '',
};

test('renderEnv writes the collected values', () => {
  const env = renderEnv(base);
  assert.match(env, /^DATABASE_URL=postgresql:\/\/u:p@localhost:5432\/memory_db$/m);
  assert.match(env, /^GOOGLE_GENERATIVE_AI_API_KEY=AIza-test$/m);
  assert.match(env, /^ADMIN_USERNAME=admin$/m);
  assert.match(env, /^NEXT_PUBLIC_API_URL=http:\/\/localhost:3004$/m);
});

test('a blank password omits ADMIN_PASSWORD so the API generates one', () => {
  assert.ok(!renderEnv(base).includes('ADMIN_PASSWORD'));
  assert.match(
    renderEnv({ ...base, adminPassword: 'hunter2' }),
    /^ADMIN_PASSWORD=hunter2$/m,
  );
});

test('isUsableTarget accepts missing and empty dirs, rejects populated ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-'));
  assert.equal(isUsableTarget(join(root, 'nope')), true);

  const empty = join(root, 'empty');
  mkdirSync(empty);
  assert.equal(isUsableTarget(empty), true);

  writeFileSync(join(empty, 'README.md'), 'x');
  assert.equal(isUsableTarget(empty), false);
});

// Regression: npm and npx invoke the bin through a node_modules/.bin symlink.
// If the entry-point check compares argv[1] to import.meta.url without
// resolving it, main() never runs and an installed CLI exits 0 doing nothing.
test('runs when invoked through a symlink, as npx does', () => {
  const cli = fileURLToPath(new URL('./index.js', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'cms-bin-'));
  const link = join(root, 'create-memory-soda');
  symlinkSync(cli, link);

  // A populated target makes the CLI bail before any prompt or network call —
  // reaching that error at all is the proof that main() ran.
  const occupied = join(root, 'taken');
  mkdirSync(occupied);
  writeFileSync(join(occupied, 'file.txt'), 'x');

  let status = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [link, occupied], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    status = err.status;
    stderr = err.stderr;
  }

  assert.equal(status, 1, 'expected the CLI to run and reject a populated dir');
  assert.match(stderr, /already exists and is not empty/);
});
