# Plan 028 — Publishable library packaging

**Status:** DONE — 2026-08-23 — vite.lib.config.ts (publicDir:false, external react) + tsconfig.lib.json → dist/framewise-lite.js (29k) + dist/index.d.ts; package.json exports/files/sideEffects + build:lib script; smoke import verified.
**Priority:** P2 · **Effort:** M · **Risk:** LOW (build config only; runtime code unchanged)
**Depends on:** none open
**Category:** direction (Phase 4 item 2 in `docs/OVERVIEW.md` §14)

## Why

The library in `src/framewise-lite/` is described as "what you'd publish"
but has no publish story: no `exports` map, no `files` allowlist, no
`sideEffects` flag, and no `build:lib` that emits ESM + types from the
barrel. Consumers currently must copy the source.

## Design

- `vite.lib.config.ts` (or lib section in `vite.config.ts` with `mode: 'lib'`):
  `build.lib.entry = src/framewise-lite/index.ts`, `formats: ['es']`,
  `external: ['react','react-dom','react/jsx-runtime']`.
- `package.json`: add `exports` (`"."` → `types: ./dist/framewise-lite.d.ts`,
  `import: ./dist/framewise-lite.js`), `files: ["dist"]`,
  `sideEffects: false`, keep `peerDependencies` for react.
- `tsconfig.lib.json` extending `tsconfig.json` with `declaration:true`,
  `emitDeclarationOnly:true`, `outDir: dist` for types; or `vite-plugin-dts`
  if zero-deps approach is too noisy — prefer tsc path to avoid new deps.
- `scripts`: `build:lib` runs vite lib + tsc types; `prepack` ensures it.
- Keep `vite build` (app) untouched; `verify` stays app-focused.

## Steps

1. Add lib config + `build:lib` + package.json metadata.
2. Smoke test: `npm run build:lib` then `node --input-type=module` imports
   `{interpolate}` from `dist/framewise-lite.js` and asserts a value.
3. Docs: `docs/code/README.md` source map notes `dist/` as publish output;
   README notes `npm run build:lib`.
4. Gate: `npm run verify` (app) + manual lib smoke.

## STOP conditions

- Any runtime code change outside build config/package.json → stop.

## Done means

`npm run build:lib` emits `dist/framewise-lite.js` + `dist/*.d.ts` importable
from a scratch project; docs updated; plan header + row DONE.
