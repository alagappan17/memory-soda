/**
 * Fails if any internal link in the built site points at a page that doesn't
 * exist.
 *
 * Starlight has no built-in dead-link failure (VitePress does), and the docs
 * carry ~3,400 internal links across 55 pages. A rename that misses one call
 * site is otherwise invisible until a reader hits a 404. Run after `astro build`.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

/** Emitted by the framework, not by our content. */
const IGNORED_PREFIXES = ['/_astro', '/pagefind'];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function resolvedFile(href) {
  const base = join(DIST, href);
  if (existsSync(base) && statSync(base).isFile()) return base;
  if (existsSync(`${base}.html`)) return `${base}.html`;
  if (existsSync(join(base, 'index.html'))) return join(base, 'index.html');
  return null;
}

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    idCache.set(
      file,
      new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
    );
  }
  return idCache.get(file);
}

if (!existsSync(DIST)) {
  console.error('dist/ not found, run `astro build` first.');
  process.exit(1);
}

const dead = [];
let checked = 0;

for (const file of walk(DIST)) {
  const html = readFileSync(file, 'utf8');
  for (const [, path, hash] of html.matchAll(/href="(\/[^"#?]*)(#[^"?]*)?/g)) {
    if (IGNORED_PREFIXES.some((p) => path.startsWith(p))) continue;
    checked++;
    const target = resolvedFile(path);
    if (!target) {
      dead.push(`${file.slice(DIST.length)} → ${path}${hash ?? ''}`);
    } else if (hash && !idsOf(target).has(hash.slice(1))) {
      dead.push(
        `${file.slice(DIST.length)} → ${path}${hash} (anchor not found)`,
      );
    }
  }
}

console.log(
  `checked ${checked} internal links across ${walk(DIST).length} pages`,
);

if (dead.length > 0) {
  console.error(`\n${dead.length} dead link(s):`);
  for (const d of [...new Set(dead)]) console.error(`  ${d}`);
  process.exit(1);
}

console.log('no dead links');
