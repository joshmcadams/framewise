# 041 — Bound `spring`'s integer-chain cache (LRU)

**Status:** DONE — 2026-08-24 — LRU over whole keys, cap 8 (first cut at 16
measured 1.27 MB — over the <1 MB bar — so tightened to 8). Live replay of
the finding's 600-frame animated-damping scenario: **+0.64 MB** (was +22 MB);
static-config delta flat. Cache bound pinned by unit test; evicted-then-
recomputed chain toEqual-identical; full spring suite (37) green.

**Backlog item:** #21 (`21-spring-cache-unbounded.md`) — P2, S

## Problem

`integerChainCache` is keyed by static config and grows one entry per DISTINCT
config. An ANIMATED config mints a key per frame; each key retains its own
chain of up to N nodes → O(n²) node retention, never evicted. Measured in the
finding: 600-frame comp with animated damping, heapUsed 11 MB → 33 MB.

## Fix

Evict whole keys, LRU-style, capped at 16. Map preserves insertion order:
refresh recency on hit (delete+set); on insert past the cap, drop the oldest.
Eviction only forces recompute from frame 0 with the SAME `advance()` sequence
→ output stays byte-identical (the property the existing characterization
test pins). 16 covers any realistic count of distinct STATIC springs; a render
walking frames in order touches ≤1 animated key per spring per frame, so no
thrash on the hot path. Tradeoff documented: >16 alternating keys recompute
O(n) per miss — memory flat, CPU bounded by the naive loop's worst case.

## Acceptance

1. Cache size never exceeds the cap while walking an animated config for 600
   frames (unit-pinned via a diagnostic `springCacheKeysForTest()`).
2. Evicted-then-recomputed chains return identical values (flood cache,
   re-request original walk, toEqual).
3. Existing tests pass unchanged — especially byte-identical characterization.
4. Live: node --expose-gc replay of the finding's scenario shows <1 MB delta.
5. Ch. 3 cache note updated same commit.
