# Plan 003: Harden the renderer — signal cleanup, fault-isolated teardown, codec preflight, strict flag parsing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- scripts/ src/render/main-render.tsx`
> Plan 002 is EXPECTED to have landed (render-lib.mjs exists). If it has not,
> STOP. For other drift, compare the "Current state" excerpts before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/002-extract-render-lib.md
- **Category**: bug
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

Four small robustness gaps waste real time or leak resources:

1. **Ctrl-C leaks the temp frames dir and Vite server.** Cleanup lives only in
   a `finally` (`render.mjs:397-401`); Node's default SIGINT/SIGTERM handling
   terminates without running it, so every interrupted render leaves a
   `framewise-lite-*` dir of full-res PNGs under the OS tmpdir.
2. **Teardown is not fault-isolated**: `await server.close()` then
   `await rm(framesDir, ...)` run sequentially — if `close()` rejects, the
   temp dir leaks on the error path too.
3. **`--codec` is validated only after the entire render**: `assertFfmpeg()`
   checks presence only, so `--codec libx999` fails after minutes of
   rendering — exactly the fail-late problem the preflight was added to avoid.
4. **`flag()` mis-parses silently**: `--crf --codec libx264` sets crf to the
   string `"--codec"`; a trailing `--props` silently drops the props and
   renders defaults (bypassing the up-front JSON validation, since `propsArg`
   is `''`). Additionally, on the browser side a malformed `?props=` is
   swallowed to `{}` with no diagnostic (`main-render.tsx:47-53`), and the
   render root is grabbed with a bare non-null assertion (`main-render.tsx:63`).

## Current state

- `scripts/render.mjs:293-294` — shared resources created before the `try`:

  ```js
  const server = await createServer({server: {port: 0}, logLevel: 'warn'});
  const framesDir = await mkdtemp(join(tmpdir(), 'framewise-lite-'));
  ```

- `scripts/render.mjs:397-402` — the only cleanup:

  ```js
  } finally {
    // Workers own and close their own browsers; here we only tear down shared
    // resources, and only after Promise.allSettled above has resolved.
    await server.close();
    await rm(framesDir, {recursive: true, force: true});
  }
  ```

  There is no `process.on('SIGINT'|'SIGTERM')` anywhere in the file.

- `scripts/render.mjs:179-190` — `assertFfmpeg()` runs `ffmpeg -version` only.
  The codec/crf reach ffmpeg first at lines 361/365/385, after all frames.
- After plan 002, `readFlag(args, name, fallback)` lives in
  `scripts/render-lib.mjs` with characterization tests documenting the current
  quirks (following `--flag` accepted as a value; trailing flag → fallback).
- `src/render/main-render.tsx:45-53` and `:63`:

  ```tsx
  const propsParam = params.get('props');
  let overrideProps: Record<string, unknown> = {};
  if (propsParam) {
    try {
      overrideProps = JSON.parse(propsParam) as Record<string, unknown>;
    } catch {
      overrideProps = {};
    }
  }
  ...
  const el = document.getElementById('render-root')!;
  ```

- Value-taking flags in `render.mjs`: `comp`, `out`, `concurrency`, `crf`,
  `codec`, `audio-bitrate`, `public-dir`, `props`, `chrome`. Boolean flags:
  `--no-wait`, `--list`.
- Conventions: fail fast with actionable `throw new Error(...)` messages (see
  `resolveChromePath()` at `render.mjs:152-156` for the tone to match).

## Commands you will need

| Purpose   | Command                     | Expected on success |
|-----------|-----------------------------|---------------------|
| Tests     | `npm test`                  | all pass            |
| Full gate | `npm run verify`            | exit 0              |
| List smoke| `npm run render -- --list`  | four ids, exit 0    |
| Bad-flag smoke | `npm run render -- --crf` | exits non-zero with a message naming `--crf` |
| Render smoke (only if Chrome+ffmpeg present) | `npm run render -- --comp HelloWorld --concurrency 2 --out out/p003.mp4` | writes the mp4 |

## Scope

**In scope**:
- `scripts/render.mjs`
- `scripts/render-lib.mjs` and `scripts/render-lib.test.mjs` (flag-parser and
  registry-parser behavior changes + test updates)
- `src/render/main-render.tsx` (props-parse diagnostic, render-root guard)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `LAUNCH_ARGS` / Chrome sandbox flags (plan 009 owns that line).
- Output formats or encode-arg restructuring (plan 015).
- Any `src/framewise-lite/**` file.

## Git workflow

- Branch: `advisor/003-renderer-robustness`
- Commits: one per step is fine; short imperative summaries.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fault-isolate the teardown and share it with signal handlers

In `scripts/render.mjs`, hoist cleanup into a function and register handlers:

```js
let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { await server.close(); } catch (e) { console.error(`cleanup: server.close failed: ${e.message}`); }
  try { await rm(framesDir, {recursive: true, force: true}); } catch (e) { console.error(`cleanup: rm frames dir failed: ${e.message}`); }
}
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => { void cleanup().finally(() => process.exit(code)); });
}
```

The `finally` block becomes `await cleanup();`. Keep the existing comment about
workers owning their browsers. (Puppeteer installs its own signal handlers that
kill child Chrome processes — do not try to close browsers here.)

**Verify**: `npm run render -- --list` still works (list path exits before
server creation — confirm the handlers don't break it; note `process.exit(0)`
at line 92 runs before `server` exists, so the handler registration must come
*after* the `--list` block, where `server`/`framesDir` are defined).
**Verify** (manual, only if Chrome+ffmpeg present): start a render, Ctrl-C it,
then `ls "${TMPDIR:-/tmp}" | grep framewise-lite` → no leftover dir from this run.

### Step 2: Preflight the codec in `assertFfmpeg()`

Extend `assertFfmpeg()` to validate the selected codec before rendering.
Capture stdout of `ffmpeg -hide_banner -encoders` (the existing `run()` helper
ignores stdout — either extend it with an option to capture stdout, or add a
small `runCapture()` beside it) and check the codec name appears as a
whitespace-delimited token. On failure:

```js
throw new Error(`--codec ${codec}: not found in \`ffmpeg -encoders\` output. Check the spelling, or run \`ffmpeg -encoders\` to see what your build supports.`);
```

Pass `codec` into `assertFfmpeg(codec)` from the call site at line 298.

**Verify**: with ffmpeg installed: `npm run render -- --codec libx999 --comp HelloWorld` → exits non-zero naming `libx999` *before* any "rendering across N workers" output. Without ffmpeg locally, rely on unit tests of the token-matching helper if you extracted one; otherwise note the limitation.

### Step 3: Make `readFlag` strict about missing values

In `scripts/render-lib.mjs`, change `readFlag` so that when the flag is
present, a missing value is an error instead of a silent fallback:

```js
export const readFlag = (args, name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} requires a value (e.g. --${name} <value>)`);
  }
  return value;
};
```

Update the plan-002 characterization tests in `scripts/render-lib.test.mjs` to
assert the new behavior: `--crf` followed by `--codec` → throws naming `--crf`;
trailing `--props` → throws; absent flag → fallback (unchanged); present flag
with value → value (unchanged). Note `flag('chrome', '')` inside
`resolveChromePath` and all other call sites still work — absent flags still
return fallbacks; only *malformed* invocations now throw.

**Verify**: `npm test` → all pass.
**Verify**: `npm run render -- --crf` → exits non-zero with `--crf requires a value`.
**Verify**: `npm run render -- --list` → still prints four ids.

### Step 4: Scope the `--list` parser to composition entries

In `parseRegistryIds`, reduce the false-positive surface: match only `id:`
keys that appear at the start of an object literal member in the
`compositions` array. A pragmatic tightening that keeps the
no-Chrome-required property:

```js
export const parseRegistryIds = (registrySource) =>
  [...registrySource.matchAll(/\{\s*id:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
```

(Each registry entry opens with `{\n    id: '...'` — see
`src/render/registry.ts:25-26`. A `defaultProps: { id: ... }` would also match
this shape, so additionally have the function cross-check: count occurrences of
`component:` in the source; if the id count ≠ component count, print a warning
to stderr but still return the ids.) Update the plan-002 characterization test
(synthetic `defaultProps` id) to assert the warning path.

**Verify**: `npm run render -- --list` → exactly the four ids.
**Verify**: `npm test` → all pass.

### Step 5: Diagnostics in `main-render.tsx`

- Replace the silent catch (lines 47-53): keep the `{}` fallback (the page
  must still render — the CLI validates before injecting) but add
  `console.error(\`Ignoring malformed ?props= value: ${(e as Error).message}\`)`
  in the catch.
- Replace line 63's `!` with an explicit guard:

  ```tsx
  const el = document.getElementById('render-root');
  if (!el) {
    throw new Error('main-render: #render-root not found — is render.html the page being served?');
  }
  ```

- Add a one-line comment at the `mergedProps` spread (line 54) noting the
  merge is shallow: a nested-object prop in `?props=` replaces the default
  wholesale.

**Verify**: `npm run verify` → exit 0 (typecheck confirms the non-null flow).

## Test plan

- Updated characterization tests in `scripts/render-lib.test.mjs` (Steps 3-4)
  are the regression net: strict-value errors, registry-shape matching, and the
  id/component count warning.
- If you extracted a codec-token matcher in Step 2, unit-test it: exact token
  matches; substring (`libx26` vs `libx264`) does not.
- Verification: `npm run verify` → exit 0.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "SIGINT" scripts/render.mjs` → handler registered
- [ ] `grep -c "try {" scripts/render.mjs` includes the isolated teardown (both `server.close` and `rm` individually guarded)
- [ ] `npm run render -- --crf` exits non-zero with an actionable message
- [ ] `npm run render -- --list` prints the four ids
- [ ] `grep -n 'render-root' src/render/main-render.tsx` shows the guarded lookup, no `!`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002 has not landed (`scripts/render-lib.mjs` missing).
- `ffmpeg -encoders` output on your machine doesn't contain `libx264` as a
  token (unexpected ffmpeg build — the preflight design assumption is wrong).
- Making `readFlag` strict breaks a *legitimate* existing invocation pattern
  you find documented in README.md — report the conflict instead of weakening
  the check.
- You cannot test signal handling at all (no Chrome/ffmpeg) AND the handler
  code requires restructuring beyond Step 1's shape.

## Maintenance notes

- Plan 009 (sandbox gating) and plan 015 (output formats) both edit
  `render.mjs` — land this first; they assume `cleanup()` and strict flags.
- Reviewers: check the signal handlers are registered only on the render path
  (after `--list` exits) and that `cleanup()` is idempotent (`cleanedUp` flag),
  since both a signal and the `finally` can call it.
- Deferred deliberately: rejecting `../` in `assetPath` (near by-design for a
  local tool — see plans/README.md rejected list).
