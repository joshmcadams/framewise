# 042 — jsdom media stubs: silence the "Not implemented" stderr noise

**Status:** DONE — 2026-08-24

**Backlog item:** #22 (`22-jsdom-media-stub-noise.md`) — P3, S

## Problem

`OffthreadVideo.test.tsx` and `App.test.tsx` printed jsdom's
"Not implemented: HTMLMediaElement's pause() method" on every run — the only
stderr in a passing suite, training humans and agents to skim past stderr
where a real React warning would look identical.

## Fix (per-suite, as the finding prefers)

Stub `play`/`pause` on `HTMLMediaElement.prototype` in each affected suite.
Per-test (`beforeEach`), not `beforeAll`: App.test's `afterEach` calls
`vi.restoreAllMocks()`, which would strip a `beforeAll` spy after test one.

Verified no assertion observes these calls — preview-mode behavior is asserted
through src/extraction state and rendered output, so the stub hides nothing.

## Acceptance

1. `npm test` produces ZERO stderr lines on a passing run (was 3).
2. All suites still assert real behavior — full suite green unchanged.
