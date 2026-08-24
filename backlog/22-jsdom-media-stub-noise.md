# 22 — jsdom media stubs print unhandled-method noise on every test run

**Type:** Test hygiene · **Priority:** P3 · **Effort:** S

## Problem

Two suites emit this to stderr on every `npm test`:

```
stderr | src/framewise-lite/OffthreadVideo.test.tsx > OffthreadVideo — preview mode
Not implemented: HTMLMediaElement's pause() method

stderr | src/App.test.tsx > <App> gallery > clicking a poster switches back to single
Not implemented: HTMLMediaElement's pause() method
```

jsdom does not implement `HTMLMediaElement.play/pause`, and `useMediaSync`
calls them in preview mode. The tests pass; the output is noise.

## Why bother

The suite is otherwise clean, so this is the only stderr output in a normal
run. That trains everyone — human and agent — to skim past stderr, in a suite
where a genuine React warning (`act()`, a key collision, a state update after
unmount) would look almost identical and scroll by unnoticed. The cost is not
the two lines, it is the habit.

## Fix

Stub the two methods on `HTMLMediaElement.prototype` in the affected suites (or
a shared setup file, if a second suite ever needs it):

```ts
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
```

Prefer the per-suite form: `vite.config.ts` currently has no setup file, and
adding one for two stubs buys indirection the repo does not otherwise need.

## Acceptance

- `npm test` produces no stderr output on a passing run.
- The preview-mode assertions still assert real behavior — the stub must not
  hide a missing call the tests currently rely on observing.
