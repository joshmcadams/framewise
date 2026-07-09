# Plan 002: Extract render.mjs's pure logic into a testable module and unit-test it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- scripts/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

`scripts/render.mjs` (402 lines) contains the renderer's determinism-critical
pure logic — audio segment aggregation, chunk-range math, CLI flag parsing,
asset-path mapping, and the `--list` registry parser — but none of it can be
unit-tested: it all lives at top level in a module that performs side effects
on import (`resolveChromePath()` runs at line 159; the render sequence starts
at line 293). Bugs in exactly this logic corrupt output *silently* (misaligned
audio, dropped/duplicated frames) and are the hardest to eyeball. This plan
extracts the pure functions into an importable module and tests them. **It
must not change any behavior** — hardening/bug fixes are plan 003.

## Current state

- `scripts/render.mjs` — the whole renderer. The pure logic to extract:

  - `flag()` at lines 45-48 (closes over the module-level `args`):

    ```js
    const args = process.argv.slice(2);
    const flag = (name, fallback) => {
      const i = args.indexOf(`--${name}`);
      return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
    };
    ```

  - `assetPath` at line 64 (closes over `publicDir`):

    ```js
    const assetPath = (src) => join(publicDir, src.replace(/^\//, ''));
    ```

  - the `--list` id parser at line 86:

    ```js
    const ids = [...src.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    ```

  - `aggregateAudioSegments(audioByFrame)` at lines 195-226 — already a pure
    named function; move it verbatim. Input shape:
    `[{frame: number, reports: [{id, src, mediaTime, volume}]}]`; output:
    `[{src, startFrame, endFrame, trimStart, volume}]` sorted by `startFrame`,
    keyed by report `id`, split when active frames have a gap.

  - the chunk-splitting math at lines 316-321:

    ```js
    const concurrency = Math.min(requestedConcurrency, durationInFrames);
    const perChunk = Math.ceil(durationInFrames / concurrency);
    const chunks = [];
    for (let s = 0; s < durationInFrames; s += perChunk) {
      chunks.push([s, Math.min(s + perChunk, durationInFrames)]);
    }
    ```

- `vite.config.ts` — Vitest config is `{globals: true, environment: 'node'}`
  with default include patterns, so a new `scripts/*.test.mjs` file is picked
  up automatically by `vitest run`.
- Repo conventions: ESM (`"type": "module"`), 2-space indent, single quotes,
  `bracketSpacing: false` style imports (`import {x} from 'y'`), explanatory
  block comments above functions. Match `scripts/render.mjs` itself.
- Existing test style exemplar: `src/framewise-lite/interpolate.test.ts`
  (plain `describe`/`it`/`expect`, no mocks).

## Commands you will need

| Purpose   | Command                     | Expected on success |
|-----------|-----------------------------|---------------------|
| Tests     | `npm test`                  | all pass; count grows from 51 |
| Typecheck | `npm run typecheck`         | exit 0              |
| Full gate | `npm run verify`            | exit 0              |
| List smoke| `npm run render -- --list`  | prints exactly: `HelloWorld`, `AsyncImage`, `WithAudio`, `WithVideo` |

## Scope

**In scope**:
- `scripts/render-lib.mjs` (create)
- `scripts/render-lib.test.mjs` (create)
- `scripts/render.mjs` (only: delete the moved code, add the import, pass
  previously-closed-over values as arguments)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any behavior change whatsoever — including "obvious" fixes to the flag
  parser or path handling. Those are plan 003 and depend on this plan's tests.
- `src/**` — the browser side is untouched.
- Signal handling / cleanup in `render.mjs` (plan 003).

## Git workflow

- Branch: `advisor/002-extract-render-lib`
- Commit style: short imperative summary (e.g. `Extract render.mjs pure logic
  into render-lib.mjs with unit tests`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `scripts/render-lib.mjs`

Move the five pieces above into exported pure functions. Closed-over values
become parameters; behavior stays byte-identical:

```js
// Pure logic for scripts/render.mjs, extracted so it can be unit-tested.
// No side effects, no imports from puppeteer/vite — keep it that way.
import {join} from 'node:path';

export const readFlag = (args, name, fallback) => { /* body of flag() */ };
export const assetPath = (publicDir, src) => join(publicDir, src.replace(/^\//, ''));
export const parseRegistryIds = (registrySource) => [...registrySource.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
export function aggregateAudioSegments(audioByFrame) { /* moved verbatim */ }
export function planChunks(durationInFrames, requestedConcurrency) {
  /* the lines 316-321 logic, returning the chunks array */
}
```

**Verify**: `node -e "import('./scripts/render-lib.mjs').then(m => console.log(Object.keys(m).sort().join(',')))"` → `aggregateAudioSegments,assetPath,parseRegistryIds,planChunks,readFlag`

### Step 2: Rewire `scripts/render.mjs`

Import the functions and delete the moved code. Keep thin local aliases so
call sites stay readable, e.g.:

```js
import {readFlag, assetPath as assetPathIn, aggregateAudioSegments, planChunks, parseRegistryIds} from './render-lib.mjs';
const flag = (name, fallback) => readFlag(args, name, fallback);
const assetPath = (src) => assetPathIn(publicDir, src);
```

Replace lines 316-321 with `const chunks = planChunks(durationInFrames, requestedConcurrency);`
(keep the `console.log` of chunk ranges), and line 86 with `parseRegistryIds(src)`.

**Verify**: `npm run render -- --list` → the four composition ids, exit 0.
**Verify**: `git diff scripts/render.mjs` shows only deletions of moved code plus the import/alias lines — no logic edits.

### Step 3: Write `scripts/render-lib.test.mjs`

Model the file on `src/framewise-lite/interpolate.test.ts`. Required cases:

- **`planChunks`**: `(150, 4)` → `[[0,38],[38,76],[76,114],[114,150]]`
  (verify by executing the original loop mentally: `perChunk = ceil(150/4) = 38`);
  `(10, 4)`; `(1, 4)` → `[[0,1]]`; `(90, 1)` → `[[0,90]]`; concurrency larger
  than frames `(3, 8)` → 3 single-frame chunks. Invariants to assert for each:
  chunks are contiguous, disjoint, start at 0, end at `durationInFrames`, and
  their lengths sum to `durationInFrames`.
- **`aggregateAudioSegments`**: contiguous frames for one id → one segment
  with `startFrame`/`endFrame` spanning them and `trimStart` = first report's
  `mediaTime`; a gap in frames → two segments; two ids with the same `src`
  (two `<Audio>` instances of one file) → two segments; reports arriving with
  frames out of order → still sorted correctly; empty input → `[]`; volume
  taken from the first report of each run.
- **`readFlag`**: present flag returns its value; absent returns fallback;
  document today's quirks *as they are* (a following `--other` token IS
  returned as the value; a trailing value-flag returns the fallback) — these
  characterization tests get updated by plan 003 when the behavior is fixed.
- **`assetPath`**: `('public', '/bg.wav')` → `public/bg.wav` (POSIX; use
  `join('public','bg.wav')` as expected value so it's platform-safe);
  `('public', 'bg.wav')` → same; document that `../` is currently NOT rejected
  (characterization; plan 003/renderer hardening may revisit).
- **`parseRegistryIds`**: feed it the real file
  (`readFile('src/render/registry.ts')`) → the four ids in order; feed a
  synthetic source with an `id:` inside `defaultProps` → document that it IS
  (incorrectly) picked up — characterization for plan 003.

**Verify**: `npm test` → all pass; total test count > 51 (report the new count).

## Test plan

Covered by Step 3. Verification: `npm run verify` → exit 0, all tests green.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `scripts/render-lib.mjs` exists, exports the five functions, imports nothing but `node:path`
- [ ] `scripts/render-lib.test.mjs` exists; `npm test` shows it running with ≥ 15 new assertions
- [ ] `npm run render -- --list` prints the same four ids as before
- [ ] `grep -n "aggregateAudioSegments" scripts/render.mjs` shows only the import and the single call site (no function body)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `vitest run` does NOT pick up `scripts/render-lib.test.mjs` (include-pattern
  mismatch) — report rather than editing `vite.config.ts` yourself.
- You find yourself changing what any function *returns* for any input — this
  plan is extraction only; behavior changes belong to plan 003.
- A full render is needed to gain confidence and Chrome/ffmpeg are missing in
  your environment — the `--list` smoke plus tests are the gate; note the
  limitation and continue.

## Maintenance notes

- Plan 003 (renderer robustness) edits `readFlag`/`parseRegistryIds` behavior
  and updates the characterization tests written here — land this plan first.
- Plan 015 (output formats) adds encode-arg planning to `render-lib.mjs`.
- Reviewers should diff `render.mjs` for accidental logic changes; the moved
  bodies must be verbatim.
