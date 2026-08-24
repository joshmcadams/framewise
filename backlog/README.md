# Backlog

Prioritized open work for framewise-lite, derived from a feature-gap analysis
against similar software: [Remotion](https://www.remotion.dev) (the direct
model), Motion Canvas, Revideo, and the 2026 agent-era entrants (Remotion
Skills, html-video).

**This folder has been through one full audit pass** (see "Audit summary"
below). Every item was re-read against the code it claims to touch; file:line
citations were verified; three items had load-bearing mechanism errors, one
item asserted a fact about the repo that was false, and one new prerequisite
item (`00`) was added because five downstream items silently assumed an API
that does not exist. Items now carry a **Status** line and a **STOP** section
naming the decisions an executor may not make alone.

> **Relationship to `plans/`:** per root `AGENTS.md`, execution runs through
> numbered plans in `plans/`. This folder is a staging/triage area — promote an
> item by writing the next numbered plan from its file, executing, and flipping
> the row. Delete a file here when its plan lands.

## Baseline at audit time

Commit `f4ecdc7`, 2026-08-24. `npm test` → **22 files, 328 tests, all passing**.
`.github/workflows/ci.yml` exists and runs `npm run verify` on Node 20.x/22.x
(item 17's earlier claim of "no CI" was wrong — corrected in that file).
Chapters `docs/code/01`–`11` exist; new chapters start at **12**.

## Audit summary — what changed and why

Read this before picking up any item.

1. **New item `00` — provenance, attribution, and licensing. TOP PRIORITY.**
   `spring.ts:1`, `interpolate.ts:1`, and `easing.ts:1` describe themselves as
   **ports**, not clean-room reimplementations — `spring.ts` says "ported
   **verbatim** (math-wise)… a faithful copy". Meanwhile `LICENSE` is MIT ©
   the repo author with **no upstream copyright notice at all**, which is an
   attribution gap even if upstream turns out to be permissive (MIT requires the
   notice travel with "substantial portions"). The repo is still
   `"private": true`, so nothing has been distributed — which is exactly why
   this is cheap now and expensive later. It blocks 17e absolutely and should
   settle before further investment, because the answer changes the project's
   distribution posture. It is fact-finding, not a legal conclusion: see that
   file's STOP section.

2. **New item `00b` — extract the render pipeline into a callable API.**
   `scripts/render.mjs` is a _script_, not a library: args are parsed at module
   scope (`render.mjs:86-184`), Chrome is resolved at module load
   (`render.mjs:244`), the Vite server, temp frames dir and signal handlers are
   created at module scope (`render.mjs:471-535`), and the whole render is one
   top-level `try/finally` (`render.mjs:537-773`). Items **04, 08, 12, 14, 15**
   all describe "just wrap the existing pipeline in a loop / stream its events /
   call it from a server". None of them can, today. `00b` makes
   `renderVideo(options, emit)` a real function and is a hard prerequisite for
   that whole cluster. It is the highest-leverage _engineering_ item here.

3. **Item `07` (`buildTimeline`) had a broken mechanism.** It proposed rendering
   the composition **once** under a collector context and claimed "no O(duration)
   frame simulation needed". That cannot work: `Sequence` returns `null` when
   the frame is outside its window (`Sequence.tsx:33-36`), so at frame 0 nothing
   inside a `<Sequence from={60}>` ever mounts and therefore never reports.
   A one-render collector sees only the frame-0-active subtree. Item 07 has been
   rewritten around a **collector render mode** (Sequence mounts children while
   collecting, with an explicit honesty boundary) plus an optional sampling
   fallback, and the effort raised M → L.

4. **Item `02`'s `playbackRate` audio math was wrong.** It proposed shortening
   the segment's `atrim` duration. That plays the first fraction of the audio at
   normal speed and then stops — it does not speed anything up. Rate changes
   require `atempo` in the filter chain, plus a new `playbackRate` field on
   `AudioReport` (`audio-registry.ts:14-22`) and a split condition in
   `aggregateAudioSegments` (`render-lib.mjs:73-105`). `playbackRate` is
   reclassified S → **M** and split into its own sub-item.

5. **Item `09`'s CLI validation is not implementable as written.** It said
   `render.mjs --props` would validate against the schema. `render.mjs` is Node
   and cannot import `registry.ts` — that is precisely why `--list` scrapes the
   file with a regex (`render-lib.mjs:44-57`). Validation was moved to the page
   boot in `main-render.tsx`, where it becomes a `configError` and reaches the
   CLI named and fast through the existing seam.

6. **Item `11` had a determinism hole.** `new AudioContext().sampleRate` follows
   the _host audio device_, so `decodeAudioData` would resample differently on
   different machines and the visualization — and therefore the pixels and the
   sha256 gate — would not be reproducible. Pinned to `OfflineAudioContext` at a
   fixed rate.

7. **Item `08` assumed a Player API that does not exist.** "Click/drag →
   `Player.seekTo`" — `seekTo` is a local `useCallback` (`Player.tsx:56-65`) with
   no ref, handle, or controlled-frame prop. Exposing it is a real public-API
   change to the library's most-documented component and is now called out as a
   prerequisite sub-step with its own design decision.

8. **Item `16f` (three.js) is cut, not deferred.** Headless WebGL rasterization
   depends on the GPU/SwiftShader build, so frames would not be byte-identical
   across machines. That does not just make it hard — it makes the sha256
   integrity gate (invariant 1, the repo's central guarantee) meaningless for
   any composition using it. Recorded as **not planned** with the rationale, so
   nobody re-derives it.

9. **Item `17`'s premise needs a human decision, and is now gated on `00`.**
   Publishing under a name derived from an upstream project raises trademark
   questions that are separate from the copyright ones in `00`, and publishing
   is distribution regardless of whether money changes hands. 17 is split: 17a–d
   (CI render smoke, pack gate, scaffolder, templates) need no publishing and
   carry most of the value; **17e is blocked on `00` and now carries a 19-point
   pre-publish checklist** instead of a vague "decide later".

10. **Effort re-grades:** `02` S → S+M (split), `07` M → L, `08` L → split into
    `08a` (M) / `08b` (M, gated), `14` M → M but deprioritized, `12` M → M (now
    cheap once `00b` lands, expensive before).

## Ordering

The old single linear list implied a dependency chain that mostly is not real.
Work is better modelled as **one blocking item, then three tracks that proceed
in parallel**, with one further prerequisite (`00b`) gating the tooling track.

### Track 0 — Blocking (nothing else should start before this)

| #   | Item                                   | Effort | Depends on | Status                           |
| --- | -------------------------------------- | ------ | ---------- | -------------------------------- |
| 00  | Provenance, attribution, and licensing | S      | —          | **TOP PRIORITY — do this first** |

### Track P — Platform (do `00b` first; the rest unblock everything else)

| #   | Item                                                             | Effort | Depends on | Status               |
| --- | ---------------------------------------------------------------- | ------ | ---------- | -------------------- |
| 00b | Render pipeline API (`renderVideo()` + event emitter)            | M      | —          | ready · **do first** |
| 03  | Auto-managed browser download                                    | S      | —          | ready                |
| 04  | Progress output + structured logs (`--log=json`)                 | S      | 00b        | ready after 00b      |
| 05  | Renderer flag expansion (JPEG, `--scale`, `--frames`, `--muted`) | M      | —          | ready                |

### Track A — Authoring (independent of Track P; the user-visible value)

| #     | Item                                                  | Effort | Depends on | Status                                   |
| ----- | ----------------------------------------------------- | ------ | ---------- | ---------------------------------------- |
| 01    | Transitions (`TransitionSeries` + presentations)      | M      | —          | ready · **highest user value**           |
| 02a   | `cancelRender`                                        | S      | —          | ready                                    |
| 02b   | `<Freeze>`                                            | S      | —          | ready                                    |
| 02c   | `preloadAudio` / `preloadVideo` / `preloadFont`       | S      | 06         | ready                                    |
| 02d   | `playbackRate` on media components                    | M      | —          | ready (math corrected)                   |
| 06    | Font loading helper (`loadFont`)                      | S      | 02a (soft) | ready                                    |
| 10    | Captions kit (SRT/VTT + timed text)                   | M      | —          | ready                                    |
| 09    | Prop schemas → generated form controls                | M      | —          | ready (validation site corrected)        |
| 11    | Audio visualization (`getAudioData`/`visualizeAudio`) | M      | —          | ready (determinism fixed)                |
| 13    | Alpha-channel export (transparent WebM)               | M      | 05         | ready                                    |
| 16a–d | `<Gif>`, shapes, path utils, noise                    | S each | —          | ready                                    |
| 16e   | Lottie                                                | M      | 02a        | ready as a _recipe_, not a barrel export |
| 16f   | three.js / R3F                                        | —      | —          | **not planned** (determinism)            |

### Track T — Tooling (gated on Track P)

| #   | Item                                     | Effort | Depends on | Status                              |
| --- | ---------------------------------------- | ------ | ---------- | ----------------------------------- |
| 15  | Agent skill + MCP server                 | M      | 00b,03,04  | ready after P                       |
| 12  | Batch rendering (`--props-file`)         | M      | 00b, 04    | ready after P                       |
| 07  | Timeline introspection (`buildTimeline`) | L      | —          | **needs decision** (mechanism)      |
| 08a | Studio: render button + progress         | M      | 00b, 04    | ready after P                       |
| 08b | Studio: timeline panel + filmstrip       | M      | 07, 08a    | blocked on 07                       |
| 14  | Resumable renders (frame cache reuse)    | M      | 00b,04,05  | ready; lowest value/risk ratio      |
| 17  | Packaging, CI render smoke, scaffolder   | M      | 17e → 00   | 17a–d ready · **17e blocked on 00** |

**If you can only ship five things:** `00`, `00b`, `01`, `03`, `06`. That is
settled provenance, a callable renderer, the missing authoring primitive
everyone asks for, a setup-free install, and an honest font path. Everything
else is additive on top of those.

## What NOT to trade away

Any implementation must preserve the guarantees that differentiate this codebase:

1. **Determinism** — sha256 frame-set hash identical at any concurrency
   (`render.mjs:633-643`). New features are pure functions of the frame number or
   they don't ship. Note the honest scope of that gate, which several items lean
   on: it compares _frames rendered by the same browser build with the same
   capture settings_. It says nothing across Chrome versions, across
   `--jpeg-quality` values, or about the encoded file (see `05`, `03`).
2. **The named-error timeout ladder** (30/35/40/45 s, single source of truth in
   `delay-render-defaults.mjs`), plus the parallel `calculateMetadata` ladder
   (30 s named, `registry.ts:182`, under the 60 s ready-wait,
   `render.mjs:346-352`). New async paths surface named errors before generic
   ones, and say _which mechanism_ orders them.
3. **Preview/export equivalence through `CompositionHost`**
   (`CompositionHost.tsx:18-37`) — no feature may add a second render path. The
   one legal asymmetry is the null `PlaybackContext`.
4. **Docs are the product** — each shipped item updates its chapter (or adds one,
   starting at 12) plus the source map in `docs/code/README.md`.
5. **Zero runtime dependencies in `src/framewise-lite/`.** The library currently
   has none (only peer React). Items 09, 10, 16b–d honor this deliberately; 16e
   is the one place it would break, which is why it ships as a documented recipe
   rather than an export.

## Cross-cutting expectations for every item

These are repo convention (`AGENTS.md`), restated because each item's
Verification section assumes them:

- **Verify the artifact a user receives**, not the layer you wrote. `ffprobe`
  the output file; don't stop at "the hash matched".
- **Cross new flags with the orthogonal ones** — `--distributed` × `--format` ×
  `--concurrency` × `--still`. Most renderer bugs live in the crossings.
- **State what a verification does NOT cover**, in the PR text and in the docs.
- **Typecheck doc snippets before publishing them** — assemble every example into
  a scratch `.tsx` under `src/`, run `npm run typecheck`, delete it.
- **A new demo composition means updating the pinned id list** in
  `scripts/render-lib.test.mjs:288-306` in the same commit
  (`src/render/AGENTS.md`). The failing test is the reminder; don't weaken it.
- **Lint/type gates are fixed, not silenced.**
- Run this machine's renderer with
  `CHROME_PATH=".../Google Chrome for Testing"` — system Chrome hangs headless
  here (root `AGENTS.md`).
