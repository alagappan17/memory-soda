---
name: release
description: Cut a release of the SDK (@memory-soda/sdk) or the installer (create-memory-soda) and verify it from the npm registry. Use when asked to publish, bump, tag or release.
---

# Release

Two publishable packages, independent versions. Conventional Commits decide
the bump: `feat` → minor, `fix`/docs → patch, `!`/BREAKING → major (pre-1.0,
so minor may break; say so in the notes).

## SDK — `@memory-soda/sdk`

1. `npm run lint && npm run typecheck && npm test && npm run build` all green.
2. Bump `packages/sdk/package.json` version. Update `packages/sdk/README.md`
   and `apps/docs/.../contributing/releasing.md` if the flow changed.
3. `npm run sdk:build && (cd packages/sdk && npm pack --dry-run)` — tarball
   must contain only `dist/` and `README.md`.
4. User runs `npm run sdk:publish` (needs their npm OTP). Then commit
   `chore(sdk): vX.Y.Z` and tag `vX.Y.Z` — **only when the user has
   explicitly asked to commit/tag/push.**
5. Verify from the registry, not the workspace:
   `cd $(mktemp -d) && npm init -y >/dev/null && npm i @memory-soda/sdk@X.Y.Z && node -e "import('@memory-soda/sdk').then(m=>console.log(Object.keys(m)))"`.

## Installer — `create-memory-soda`

1. Bump `packages/create-memory-soda/package.json`.
2. Dry run the tarball: `cd packages/create-memory-soda && npm pack --dry-run`.
3. User runs `npm run installer:publish`.
4. Verify end-to-end in a temp dir: `npm create memory-soda@X.Y.Z my-test` and
   confirm it boots against a local pgvector Postgres, then delete the dir.

Report: version, tag, registry verification output. Never publish without an
explicit go from the user.
