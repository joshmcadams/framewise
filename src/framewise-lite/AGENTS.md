# AGENTS.md — src/framewise-lite/ (component authoring + test traps)

Read root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md) first;
this file is only what this directory keeps teaching the hard way.

## Authoring rules

- A composition/media component is a **pure function of the frame**. No
  `Math.random()`, no `Date.now()` — use `random(seed)`; determinism is a
  tested invariant, not a style preference.
- Media components run in two modes: PREVIEW (drives the element via
  `useMediaSync`) and RENDER (report into registries: audio reports, delayRender
  handles, extraction URLs). Changes must keep both paths correct — each has
  its own tests.
- Async work inside a component goes through `delayRender`/`continueRender`.
  Tests must drain pending handles in `afterEach` (see `OffthreadVideo.test.tsx`)
  or one test leaks a handle into every later suite.

## jsdom test conventions

- Suites mounting media elements stub `HTMLMediaElement.prototype.play/pause`
  in `beforeEach` — per-test, NOT `beforeAll`: suites that call
  `vi.restoreAllMocks()` in `afterEach` strip `beforeAll` spies after test one.
  `npm test` must stay stderr-clean.
- jsdom never loads media metadata — anything using real probing
  (`probe-media.ts`) must be mocked at module level (`vi.mock`). The real-file
  path is proven by live renders, not unit tests.
- `IS_REACT_ACT_ENVIRONMENT = true` + `act()` wrapping is mandatory for React
  state assertions; async resolution needs `await act(async () => {})` flushes.

## Hooks lint traps (react-hooks rules are errors here)

- Sync `setState` directly in an effect body trips `set-state-in-effect`.
  Derive during render instead, or set state only inside promise callbacks —
  see `CompositionView`'s `settledText` pattern in `../App.tsx`.
- Freshly-created objects in dependency arrays loop the effect forever. Depend
  on primitives and re-derive inside the effect body.

## Caches must be bounded AND output-stable

Memoization keyed on static config (e.g. `spring.ts`'s integer-chain LRU) may
evict only when eviction is indistinguishable from recompute: same inputs,
same `advance()` sequence, byte-identical output. Pin both properties with
tests (a size-bound test and an evicted-then-recomputed identity test).
