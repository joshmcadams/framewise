# Backlog

Suggestions from a code review of framewise-lite, ordered most-impactful first.
All items are complete. Individual prompt files have been removed; summaries are
below.

| # | Item | Type | Commit(s) |
|---|------|------|-----------|
| 01 | Cross-platform Chrome resolution | Bug (portability) | `b87f326` |
| 02 | `spring` overshootClamping no-op for `to≠1` | Bug (correctness) | `a5c4be8` |
| 03 | Shared `CompositionHost` | Architecture / reuse | `14e4daa` |
| 04 | Test the untested core | Quality | `a70d644` |
| 05 | Renderer preflight + config + props | Robustness / feature | `616d9d2` |
| 06 | `spring` O(n²) recompute | Performance | `04e51b1` |
| 07 | delayRender timeout behavior | Correctness / consistency | `122bbb3` |
| 08 | Fidelity & docs cleanup | Docs / trust | `e019fea` |
| 09 | Next primitives (A/F/G) | Features | `7d23847` |

---

## 01 — Cross-platform Chrome resolution

`resolveChromePath()` in `scripts/render.mjs` resolves Chrome via `--chrome`
flag → `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` env → per-OS well-known
locations (macOS app bundle, Windows `%PROGRAMFILES%`, Linux PATH + `/usr/bin`).
Fails fast with an actionable message if nothing is found. README documents the
env-var and flag overrides.

## 02 — `spring` overshootClamping no-op for `to≠1`

Root cause: upstream clamped `spr.current` (normalized 0..1 space) against `to`
(output space) — a no-op unless `to === 1`. Fixed by mapping to `[from, to]`
first via `interpolate()`, then clamping against `to` in output space. Regression
tests added for `to=100` and a descending `100→0` spring.

## 03 — Shared `CompositionHost`

New `src/framewise-lite/CompositionHost.tsx` owns the `VideoConfigProvider` /
`FrameProvider` / `PlaybackProvider` nesting. `Player.tsx` and `main-render.tsx`
both delegate to it; render mode passes no `playback`, preserving the
null-context contract that tells `<Audio>`/`<Video>` they are rendering.

## 04 — Test the untested core

Added `jsdom` devDependency and per-file `// @vitest-environment jsdom` for
DOM-requiring suites. New test files:

- `Sequence.test.tsx` — frame rebasing, half-open mount window, `AbsoluteFill`
  vs `layout="none"` (5 tests)
- `Player.test.tsx` — wall-clock → frame derivation, refresh-rate independence,
  loop/stop (4 tests)
- `delay-render.test.tsx` — pending tracking, idempotent clear, subscription,
  timeout with label, `useDelayRenderPending` hook (6 tests)
- `interpolate.test.ts` extended: `wrap` edge case, `posterize` snapping,
  invalid posterize, easing-array length validation (10 → 14 tests)

Suite grew from 17 tests (2 files) to 42 tests (6 files).

## 05 — Renderer preflight + config + props

- `assertFfmpeg()` preflight before any rendering work begins.
- `--crf <n>` (default 18), `--codec <name>` (default libx264), `--audio-bitrate
  <k>` (default 192k) — shared `videoEncodeArgs` used by both ffmpeg branches.
- Single `assetPath(src)` helper for public-dir resolution; `--public-dir`
  overrides the base (default `public`).
- `--props '<json>'` validated up front and URL-encoded into `?props=`;
  `main-render.tsx` merges over `comp.defaultProps`.
- README and script usage header document all flags.

## 06 — `spring` O(n²) recompute

Replaced the from-zero integration loop with an incremental integer-chain cache
keyed by `fps|damping|mass|stiffness`. Repeated calls are O(1) amortized; a
full render is O(N) instead of O(N²). Verified byte-identical to the naive loop
across 210 test cases. Microbench: naive 51 ms → 205 ms for N = 1 500 → 3 000
(quadratic); cached 0.31 ms → 0.42 ms (linear), 165–482× faster.

## 07 — delayRender timeout behavior

Created `src/framewise-lite/delay-render-defaults.mjs` (+ `.d.mts` companion for
TypeScript) as the single source of truth for `DEFAULT_DELAY_RENDER_TIMEOUT`
(30 000 ms) and `RENDERER_TIMEOUT_MARGIN_MS` (5 000 ms). `delay-render.ts`
imports and re-exports the constant. `render.mjs` sets
`DELAY_RENDER_TIMEOUT = DEFAULT_DELAY_RENDER_TIMEOUT + RENDERER_TIMEOUT_MARGIN_MS`
(35 000 ms), guaranteeing the labeled in-app `console.error` fires before
Puppeteer's generic backstop. Ordering contract documented in both files.

## 08 — Fidelity & docs cleanup

- `interpolate.ts`: documented `posterize` as a deliberate extension not in
  upstream Framewise.
- `spring.ts`: replaced "behave exactly like Framewise" for `overshootClamping`
  with an explicit deviation note (see item 02).
- README "What's here" table: flagged `posterize` as an extension.
- README "Notes on fidelity": added the `overshootClamping` deviation.
- README `npm test` line: replaced stale "17 unit tests for interpolate + spring"
  with a module list.

## 09 — Next primitives (A, F, G implemented; B–E deferred)

**Implemented:**

- **`staticFile(path)`** (`src/framewise-lite/staticFile.ts`) — returns a
  root-relative URL (`'photo.png'` → `'/photo.png'`) consistent with Vite's
  public-dir serving and `render.mjs`'s `assetPath()` mapping.
- **`random(seed)`** (`src/framewise-lite/random.ts`) — seeded PRNG
  (FNV-1a 32-bit hash → mulberry32) returning identical `[0, 1)` values for the
  same seed across preview and all parallel render workers. Accepts `number` or
  `string` seeds.
- **Render progress + `--list`** — `render.mjs` logs per-chunk progress every
  10 frames (N/total, percentage). `--list` prints registered composition IDs by
  statically parsing `src/render/registry.ts` — no Chrome or ffmpeg required.

**Deferred (medium complexity, each is one PR):**

- **B.** `interpolate` string/tuple outputs + color interpolation
- **C.** `Easing` library (`bezier`, `in`/`out`/`inOut`, `linear`)
- **D.** `<Series>` sequential sequences + `<Loop>` repeat helper
- **E.** `measureSpring` / spring `durationInFrames` / `reverse`
