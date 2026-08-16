# Releasing the SDK

`@memory-soda/sdk` is the only published package. The API and dashboard are
deployed, not published; `@memory-soda/types` is private and bundled into the
SDK's declarations.

---

## What ships

```json
{
  "name": "@memory-soda/sdk",
  "version": "0.1.0",
  "type": "module",
  "main":   "./dist/index.cjs",
  "module": "./dist/index.js",
  "types":  "./dist/index.d.ts",
  "files":  ["dist", "README.md"],
  "engines": { "node": ">=18" },
  "sideEffects": false,
  "publishConfig": { "access": "public" }
}
```

Built with `tsup` into dual ESM/CJS plus declarations. **Zero runtime
dependencies** — it uses global `fetch` and `AbortSignal.timeout`, which is why
Node 18 is the floor.

```bash
npm run sdk:build
ls packages/sdk/dist
# index.js  index.cjs  index.d.ts  index.d.cts  + maps
```

---

## Publishing

Automated. Pushing a `v*` tag triggers the GitHub Actions workflow, which builds
and publishes.

```bash
# bump the version in packages/sdk/package.json first
git commit -am "chore(sdk): v0.2.0"
git tag v0.2.0
git push origin main --tags
```

Requires `NPM_TOKEN` as a repository secret.

### Manually

```bash
npm run sdk:build
cd packages/sdk
npm publish --access public
```

Check the tarball first:

```bash
npm pack --dry-run
```

`dist/` and `README.md` only. If `src/` or `node_modules/` appear, the `files`
field has been broken.

---

## Versioning

Semver, pre-1.0 — so a minor bump may still break.

| Change | Bump |
|---|---|
| New method or optional parameter | minor |
| Bug fix, docs, types | patch |
| Removed or renamed method | minor while `0.x`, major after |
| Changed response shape | minor while `0.x`, major after |
| Required parameter added | minor while `0.x`, major after |

### Coupling to the API

The SDK is a thin wrapper, so it is only compatible with an API that serves the
endpoints it calls. There is no version negotiation and no capability discovery.

**State the minimum API version in the changelog for any release that depends on
a new endpoint or field.** A self-hoster running an older API with a newer SDK
will get a `404` or a silently missing field, with nothing to explain it.

---

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run test` passes
- [ ] Version bumped in `packages/sdk/package.json`
- [ ] `npm pack --dry-run` shows only `dist/` and `README.md`
- [ ] New or changed methods have JSDoc
- [ ] [SDK reference](../sdk/index.md) updated
- [ ] [Type reference](../sdk/types.md) updated if types changed
- [ ] Changelog entry, including any minimum API version
- [ ] Smoke-tested against a running API

### Smoke test

```bash
npm run sdk:build
npm link --workspace=packages/sdk

mkdir /tmp/sdk-smoke && cd /tmp/sdk-smoke && npm init -y
npm link @memory-soda/sdk

cat > test.mjs <<'EOF'
import { MemorySodaClient } from '@memory-soda/sdk';
const m = new MemorySodaClient({ baseUrl: 'http://localhost:3004', apiKey: process.env.KEY });
console.log(await m.ping());
const { threadId } = await m.threads.create({ dataset: 'smoke_test' });
await m.workingMemory.addMessage(threadId, { role: 'user', content: 'hello' });
console.log(await m.workingMemory.prepare(threadId));
console.log(await m.recall({ dataset: 'smoke_test' }));
EOF

KEY=ms_… node test.mjs
```

Check CJS too, since it is a separate build output:

```bash
node -e "const { MemorySodaClient } = require('@memory-soda/sdk'); console.log(typeof MemorySodaClient)"
```

---

## Documentation

The SDK's JSDoc is the source of truth for method behaviour, and
[`developer-docs/sdk/`](../sdk/index.md) is written against it. When you change a
signature, update:

1. The JSDoc block
2. [The relevant SDK page](../sdk/index.md)
3. [The type reference](../sdk/types.md)
4. [The HTTP API page](../api/index.md) if the endpoint changed

Docs drifting from code is how a README ends up documenting three methods that do
not exist. It has happened here before.

---

## Deprecating

While `0.x`, removal in a minor is permitted — but be kind:

```ts
/**
 * @deprecated Use `recall()` instead. Removed in 0.3.0.
 */
async oldMethod() {
  console.warn('[memory-soda] oldMethod() is deprecated; use recall(). Removed in 0.3.0.');
  return this.recall(/* … */);
}
```

Keep the alias for one minor release, note it in the changelog, then remove it.

---

## Releasing the API and dashboard

Not published to a registry — deployed from source.

```bash
git pull && npm ci && npm run build
# restart the API; migrations run on boot with MIGRATE_ON_START=true
```

**Take a database backup first.** Migrations have no down path. See
[Migrations](../operations/migrations.md).

If a release includes a migration and you run several replicas, set
`MIGRATE_ON_START=false` and migrate as an explicit deploy step.

---

## Next

- [Development setup](./development.md)
- [Testing](./testing.md)
- [SDK reference](../sdk/index.md)
