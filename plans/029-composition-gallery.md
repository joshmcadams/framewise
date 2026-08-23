# Plan 029 — Composition gallery

**Status:** DONE — 2026-08-23 — Gallery toggle in App (Single/Gallery), Poster grid (280px, static CompositionHost at 1/3 duration, no Player/audio), click navigates; App.test covers toggle and navigation.
**Priority:** P2 · **Effort:** S · **Risk:** LOW (preview-app-only; library untouched)
**Depends on:** none open
**Category:** direction (Phase 4 item 3 in `docs/OVERVIEW.md` §14)

## Why

The preview shows one composition at a time. A gallery that shows all
registered compositions side-by-side as scaled-down static posters (one
representative frame each, no clock, no audio) is cheap, great for teaching,
and gives an at-a-glance overview — especially now that the registry has 7+
entries (Countdown, WithOffthread, etc.).

## Design

`src/App.tsx` — no library changes:

- Toggle `Single` / `Gallery` (buttons, state `view: 'single' | 'gallery'`).
- Gallery: grid (`repeat(auto-fill, 280px)`, gap 16) of `Poster` cards. Each
  card is a button: title bar + scaled preview (280px wide) + footer with
  dimensions/frame count. Clicking a poster switches to `single` and selects
  that composition.
- Poster: `resolveCompositionConfig(comp)` for config, `frame = floor(duration/3)`
  as representative still, rendered via `CompositionHost` (not `Player` — no
  rAF loops, no audio) inside a scaled container (`transform: scale(280/width)`).

## Steps

1. App wiring (Poster component, view toggle, conditional rendering).
2. Extend `src/App.test.tsx`: gallery button renders posters, click navigates.
3. Docs: chapter 6 notes gallery; OVERVIEW Phase 4 row ✅.
4. Gate: `npm run verify`.

## STOP conditions

- Any need to touch `framewise-lite/` → stop.

## Done means

Gallery live in preview with keyboard/click navigation; tests green; docs
updated; plan header + row DONE. Phase 4 complete.
