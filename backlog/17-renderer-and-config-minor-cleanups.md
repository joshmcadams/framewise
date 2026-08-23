# 17 — Renderer and config minor cleanups

**Type:** Robustness / hygiene · **Severity:** Low
**Status:** DONE — fixed by plan 037 (17a: shell-style `'\''` escaping in buildConcatList + O'Brien test; 17b: dead base64 catch removed; 17c: target raised to ES2022 to match lib, with rationale comment)

Three unrelated small items, one PR.

## 17a — `buildConcatList` does not escape quotes

`render-lib.mjs:280`:

```js
export function buildConcatList(chunkPaths) {
  return chunkPaths.map((p) => `file '${p}'`).join('\n') + '\n';
}
```

ffmpeg's concat demuxer requires `'` inside a quoted path to be written as
`'\''`. Today's paths come from `mkdtemp` under `tmpdir()` so this cannot fire in
practice, but the helper is exported and unit-tested as a general-purpose
builder. Escape it and add a test with a quote in the path.

## 17b — unreachable error path in `parseExtractUrl`

`scripts/offthread-server.mjs:31-36` wraps the base64 decode in try/catch:

```js
try {
  src = Buffer.from(match[1], 'base64url').toString('utf8');
} catch {
  throw new Error(`Invalid base64url source key: ${match[1]}`);
}
```

`Buffer.from(…, 'base64url')` never throws — it silently ignores invalid
characters. The catch is dead code and the "invalid key" error can never reach a
user. Either drop it, or validate the decoded result (see item 14, which changes
this encoding anyway).

## 17c — `lib: ES2022` with `target: ES2020`

`tsconfig.json` was raised to `"lib": ["ES2022", "DOM", "DOM.Iterable"]` while
`"target"` stayed `ES2020`. `lib` governs which *runtime* APIs typecheck and
`target` governs syntax downleveling, so this combination lets `Object.hasOwn`,
`Array.prototype.at`, `.findLast`, etc. compile with no polyfill and no error on
an ES2020 runtime. The package declares `node >= 20`, where all of these exist,
so nothing is broken today — but the mismatch is unintentional. Either raise
`target` to ES2022 to match, or document why `lib` leads.

## Acceptance

- `buildConcatList` test with `O'Brien` in the path produces a list ffmpeg parses.
- `tsconfig` `lib`/`target` agree, or carry a comment explaining the split.
