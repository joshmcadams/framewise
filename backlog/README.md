# Backlog

Code-review findings for framewise-lite, ordered most-impactful first within each
round. Open items have a prompt file next to this README; completed rounds keep
only their summary here.

## Round 3 — open (2026-08-24, follow-up to plan 034)

| #   | Item                                                                                     | Type                          | Severity | Status                                                                                                            |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| 19  | [The gain envelope's realized resolution is the audio frame](19-volume-envelope-audio-frame-resolution.md) | Correctness (residual) / docs | Low      | DONE (plan 038 — `aresample=48000,asetnsamples` grid on automated segments; measured 0.100 → 0.034; ch. 9 states the achieved resolution) |

## Round 3 — open (review of the round-2 fixes, 2026-08-24)

Re-review of plans 031–037, each fix re-tested against round 2's original
reproduction. All nine round-2 items confirmed fixed; gates green at 315 tests.
One residual surfaced.

| #   | Item | Type | Severity | Status |
| --- | ---- | ---- | -------- | ------ |
| 19  | [Gain envelope resolves at the audio frame, not the video frame](19-volume-envelope-audio-frame-resolution.md) | Correctness (residual) / docs | Low | OPEN |

## Round 2 — complete (2026-08-24)

Review of the 36-commit roadmap run (OVERVIEW + plans 017–030). Gates were green
at review time — `tsc -b` clean, 291 tests in 22 files — and every finding below
was reproduced rather than inferred. All nine items closed across plans 031–037;
suite grew 291 → 315 tests. Individual prompt files have been removed; this
summary (and each fix's plan file) is the record.

| #   | Item                                                       | Type                       | Severity | Fix                                                                                              |
| --- | ---------------------------------------------------------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| 10  | `npm run build` destroys the `build:lib` output            | Bug (packaging)            | High     | plan 031 (`3db2d69`) — lib output moved to `dist-lib/`, exports/files repointed                  |
| 11  | `--distributed --format webm` fails at the concat step     | Bug (correctness)          | High     | plan 032 (`6304768`) — chunk codec/container derived from format; ffprobe end-to-end check       |
| 12  | React is a `dependency`, not a `peerDependency`             | Bug (packaging)            | High     | plan 033 (`8d777dd`) — peer `>=19`; verified single-React install + hook/context smoke           |
| 13  | Per-frame volume automation splices audio once per frame   | Bug (audio) / scalability  | Medium   | plan 034 (`cd07ad2`) — one segment + telescoped `gte()` gain envelope; A/B-verified              |
| 14  | `<OffthreadVideo>` breaks on non-ASCII asset paths         | Bug (correctness)          | Medium   | plan 035 (`dc63ce0`) — UTF-8 before base64; round-trip tests through `parseExtractUrl`           |
| 15  | delayRender backstop moved entirely in-page                | Regression (diagnostics)   | Medium   | plan 036 (`dc63ce0`) — Node race backstop at 40 s, explicit protocolTimeout; live-verified       |
| 16  | `interpolateColors` output validity + parsing gaps         | Correctness / polish       | Low      | plan 037 (`e1105d5`) — gamut-clamped output, case-insensitive parse, empty components rejected   |
| 17  | Renderer and config minor cleanups                         | Robustness / hygiene       | Low      | plan 037 (`e1105d5`) — concat-list quote escaping, dead catch dropped, target=lib=ES2022         |
| 18  | `App.tsx` silences two hooks rules file-wide               | Quality / teaching         | Low      | plan 037 (`e1105d5`) — zero disables: key-remount editor + handler-side resolution               |

### Not findings — verified and holding

Recorded so a later round does not re-audit them:

- `assetPath` containment (`render-lib.mjs:23-33`) is correct, including the
  `//etc/passwd` double-slash case, and is wired into both the encode path and
  the extraction server (plan 026).
- The plan-024 perf refactor preserves audio semantics: `audio-registry` keys
  reports by instance id, so folding render→wait→read into one CDP round trip
  cannot produce duplicate or overlapping segments.
- The `<OffthreadVideo>` PNG cache lives in `framesDir/offthread/`, and the
  non-recursive `readdir(…).filter(f => f.endsWith('.png'))` correctly excludes
  it from both the frame-count assertion and the png-seq copy.
- `docs/code/README.md`'s source map is current for every module added in
  plans 018–030.

## Round 1 — complete (2026-07-10)

Individual prompt files have been removed; summaries are below.

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

# Round 1 details

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
