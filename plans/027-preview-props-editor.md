# Plan 027 — Preview props editor

**Status:** DONE — 2026-08-23
**Priority:** P2 · **Effort:** M · **Risk:** LOW (preview-app-only; library untouched)
**Depends on:** none open (plan 025's shared resolver is what makes it clean)
**Category:** direction (Phase 4 item 1 in `docs/OVERVIEW.md` §14)

## Why

Compositions take props; the preview hardcodes `defaultProps`. Editing inputs
shouldn't require editing the registry — and with `calculateMetadata` landed,
editing `{"seconds": 3}` in a box and watching Countdown shrink from 150 to 90
frames live IS the product demo of dynamic metadata.

## Design

`src/App.tsx`, no library changes:

- Under the composition dropdown: a monospace textarea pre-filled with
  `JSON.stringify(defaultProps, null, 2)` per selected composition (reset on
  switch).
- Parse-as-you-type: valid JSON object → becomes `inputProps`; syntax errors
  or non-object JSON show an inline red message and KEEP the last good props
  (playback never breaks).
- Config resolution goes through `resolveCompositionConfig(comp, inputProps)`
  wrapped so a throwing `calculateMetadata` surfaces in the same error area
  (Countdown + `{"seconds":99}` = named error, not a crash).
- The `<Player>` keeps `key={comp.id}` — editing props must NOT reset the
  clock; changed `durationInFrames` flows into the running Player naturally.
- Extracted pure helper `parsePropsInput(text): {ok, props?} | {ok:false, error}`
  colocated as `src/render/parse-props-input.ts` for direct unit tests.

## Steps

1. Helper + tests (`parse-props-input.test.ts`: empty text → {} with no
   error? decide: empty = {} valid; whitespace; scalar/array rejection;
   malformed; nested object allowed).
2. App wiring (textarea, error line, resolver-in-try, reset-on-switch).
3. New `src/App.test.tsx` (jsdom): dropdown switches comps; textarea shows
   defaults; invalid JSON keeps last-good + shows error; valid
   `{"seconds":2}` on Countdown yields a Player whose composition reports
   "2 seconds · 60 frames".
4. Docs: chapter 6 short section (the editor is part of the host-page story);
   README quickstart mention; OVERVIEW Phase 4 row ✅; plans row DONE.
5. Gate: `npm run verify`.

## STOP conditions

- Any need to touch `framewise-lite/` internals → stop (design says none).

## Done means

Editor live in preview with error handling; tests green; docs updated; plan
header + row DONE.
