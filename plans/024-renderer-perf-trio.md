# Plan 024 — Renderer perf trio (Phase 3 item 1)

**Status:** DONE (2026-08-23) — measured on this machine (HelloWorld, 150
frames, mp4): c4 total 65.6 s → 20.5 s (−69%), c1 107.3 s → 45.3 s (−58%);
frame loops 48.4→12.7 s and 76.9→38.4 s. Frame-set sha256 identical before
and after at both concurrency levels (`3203283d21148710`). Shipped: (1) one
CDP evaluate per frame via new `window.framewiseLite.waitForPendingEmpty`
(in-page 10 ms polling; labeled timeout errors preserved); (2) probe rides the
first worker's browser (`openWorker`/`applyViewport`/`readConfigFromPage`
replaced `probeConfig`; c1 now launches one Chrome instead of two);
(3) bundle-vs-devserver verdict: KEEP dev server — fixed overhead after (1)+(2)
is ~8 s dominated by launches+encode; a ~2 s build per invocation loses at any
plausible render length. Verdict + table recorded in chapter 7 "Performance
notes". delayRender contracts re-verified live: AsyncImage with-wait resolves,
`--no-wait` still logs `pending at capture: [SlowData fetch]`.
**Priority:** P2 · **Effort:** M · **Risk:** MEDIUM (rewrites the hot frame loop; determinism hash + audio collection contracts must survive byte-identically)
**Depends on:** none open
**Category:** direction (the audit's "renderer perf trio", surfaced in OVERVIEW §14 Phase 3)

## The three findings

1. **Two-plus CDP round-trips per frame foldable into one.** Today each frame
   costs four `page.evaluate` calls (`renderFrame`, double-rAF paint wait,
   pending-labels read, audio-reports read) plus `waitForFunction` polling.
   Fold into a single in-page async step that renders, awaits pending==0,
   waits paints, and RETURNS `{pendingLabels, audioReports}`.
2. **A whole browser launched just to probe registry metadata.**
   `probeConfig()` spins up a throwaway Chrome to read
   `window.framewiseLite.config`. Instead: launch one browser up front, probe
   through it, then HAND that browser to the first chunk worker. Concurrency-1
   renders drop from two browser launches to one; N-worker renders save one.
   (Preserves the by-design tension: metadata is still read at runtime from
   the live page, so future dynamic metadata keeps working.)
3. **Vite dev server instead of a built bundle.** Measure before touching:
   dev-server transform cost is paid per page load; a prebuilt bundle pays a
   one-time `vite build`. Which wins depends on render length. Deliverable may
   legitimately be "measured verdict, no change".

## Invariants (must hold byte-identically)

- Frame-set sha256 identical before/after at c1 and c4.
- delayRender timeout still produces the LABELED failure (stuck handle names
  surface in the error); `--no-wait` still skips waiting; "pending at
  capture" logging preserved.
- Audio reports collected per absolute frame exactly as today.
- Signal/cleanup semantics untouched (liveBrowsers, SIGTERM ownership).

## Steps

1. **Baseline** (this machine, Chrome-for-Testing via CHROME_PATH):
   HelloWorld mp4 at c4 and c1 — wall time, per-frame average,
   page-load→ready latency (instrumented timestamps), probe duration.
2. **Implement #2** (single-evaluate loop): add `waitForPendingEmpty`
   helper to `src/render/main-render.tsx`'s exposed API (in-page polling with
   labeled-timeout rejection); rewrite the loop body around one evaluate;
   keep progress logs and error text contract ("delayRender timeout at frame
   N; pending: …").
3. **Implement #3** (probe reuses first worker's browser): restructure
   launch order — one early browser, probe on it, pass it into the first
   chunk; `probeConfig` becomes a function of an existing page.
4. **Re-measure**: same matrix; compare. Then decide #1-of-the-trio (#3
   bundle question) strictly on numbers; implement only if the data says a
   flag-free switch wins for typical renders, else write the verdict into
   chapter 7 and this plan.
5. Tests: `render-lib.test.mjs` untouched where possible; any extracted pure
   helper gets coverage; full `npm run verify`; live determinism check
   (sha256 equal pre/post refactor at c1 and c4).
6. Docs: chapter 7 gains a "Performance notes" subsection recording measured
   numbers and the trio's outcomes; plans row flipped DONE.

## STOP conditions

- Post-refactor sha256 mismatch vs baseline at either concurrency → stop and
  diagnose before proceeding (suspect ordering: rAF/paint-wait semantics,
  audio-read timing relative to commit).
- Any need to touch `delayRender` internals or cleanup/signal handling → stop.

## Done means

Loop issues one evaluate per frame (+screenshot), probe rides a worker
browser, bundle-vs-devserver has a measured recorded verdict; verify green;
determinism proven; docs updated; plan header + row DONE.
