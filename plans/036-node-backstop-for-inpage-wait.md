# 036 — Node-side backstop for the in-page frame wait

**Status:** DONE — 2026-08-24 — `raceWithBackstop` in render-lib (timer
cleared on settle, 4 tests); per-frame evaluate races a 40 s Node timer;
`protocolTimeout` explicit at 45 s; ready-wait given an explicit 60 s timeout
(puppeteer defaults never decide); live-verified with a frame-5 wedge comp:
named `renderer backstop: frame 5 never returned within 40000ms` at ~40 s,
no ProtocolError. Temp comp + registry entry reverted.

**Backlog item:** Round 2 #15 (`backlog/15-delayrender-backstop-moved-in-page.md`)

## Problem

The perf trio folded render→wait→read into one `page.evaluate`. The wait now
polls with in-page `setTimeout(tick, 10)` — which never fires if a composition
wedged the main thread. The failure surfaces as puppeteer's generic
`ProtocolError` at the default 180 s `protocolTimeout` instead of a named
error at ~35 s. CLAUDE.md invariant #5's ordering contract regressed for the
wedged-page case.

## Fix

1. New pure helper `raceWithBackstop(promise, timeoutMs, message)` in
   `render-lib.mjs` (Promise.race + timer cleared on settle) — unit-tested.
2. `render.mjs`: race every per-frame evaluate against a Node timer at
   `DELAY_RENDER_TIMEOUT + RENDERER_TIMEOUT_MARGIN_MS` (40 s); set
   `protocolTimeout: NODE_BACKSTOP_MS + 5000` at launch so puppeteer's default
   is never what decides.
3. Ordering comments updated to three layers:
   in-app labeled error 30 s → in-page deadline 35 s → Node backstop 40 s →
   protocolTimeout 45 s.
4. Live check: temp composition whose layout effect wedges at frame 5 must
   fail ~40 s with the framewise-named backstop error (temp files reverted).

## Acceptance

- Wedged-frame render fails ≈40 s with `renderer backstop: frame …` (not a
  180 s ProtocolError); normal renders unaffected.
