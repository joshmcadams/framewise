# 031 — Give the library build its own output directory (`dist-lib`)

**Status:** DONE — 2026-08-24 — lib output moved to `dist-lib/` (vite.lib.config.ts
outDir + tsconfig.lib.json outDir), package.json exports/files repointed,
`.gitignore` + eslint ignores gained `dist-lib/`; verified `build:lib → verify`
and reverse order both leave both artifacts intact; `npm pack --dry-run` = 46
files (lib ESM + .d.ts only, no app/media); node smoke import OK; 291 tests green.

**Backlog item:** Round 2 #10 (`backlog/10-lib-build-clobbered-by-app-build.md`)

## Problem

`vite.lib.config.ts` and `vite.config.ts` both emit to `dist/`, and Vite empties
`outDir` on every build. So `npm run build` (or `npm run verify`, which ends in
the app build) silently wipes the publishable library produced by
`npm run build:lib`. The package's `exports`/`files` point at `dist/`, so a
verify-then-pack flow ships an app bundle + media instead of the library.

## Fix

Move the library build to its own directory, `dist-lib/`:

1. `vite.lib.config.ts`: add `build.outDir: 'dist-lib'` (keep `emptyOutDir`
   default true — it now only ever touches `dist-lib/`).
2. `tsconfig.lib.json`: `"outDir": "dist-lib"`.
3. `package.json`: `exports["."]` → `./dist-lib/index.d.ts` +
   `./dist-lib/framewise-lite.js`; `files: ["dist-lib"]`.
4. `.gitignore`: add `dist-lib`.
5. Sync live docs that name the old paths: CLAUDE.md command-table row,
   `docs/OVERVIEW.md` (command table + Phase 4 history row). Plans are
   historical records and stay as written.

## Acceptance

1. Reproduce first: `npm run build:lib && npm run build` → before the fix,
   `dist/framewise-lite.js` is gone; after, it lives untouched in `dist-lib/`.
2. `npm run build:lib && npm run verify && ls dist-lib/framewise-lite.js`
   succeeds.
3. `npm pack --dry-run` lists only library ESM + `.d.ts` files — no
   `index.html`, no `assets/`, no media.
4. Node smoke import still works:
   `node -e "import('…/dist-lib/framewise-lite.js').then(m => …)"`.
5. `npm run verify` green (291 tests).
