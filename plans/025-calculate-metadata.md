# Plan 025 — Dynamic composition metadata (`calculateMetadata` analog)

**Status:** DONE (2026-08-23) — `calculateMetadata` on registry entries with a
shared `resolveCompositionConfig` used by both the render entry and the
preview app; hook runs once at page init before first paint/probe, receives
merged `{props, composition}`, returns validated partials (positive integers;
unknown keys warn+ignored). `Countdown` demo derives `durationInFrames` from
`props.seconds`. Live matrix: `--list` shows Countdown; default renders 150
frames; `--props '{"seconds":3}'` renders **90 frames**; `{"seconds":99}`
fails fast with "must be a whole number from 1 to 60" via the new
`configError` channel (no more probe timeout). Two implementation notes: the
error banner is appended to the body (the first draft replaced body HTML and
destroyed `#render-root` — caught by live debugging), and tsconfig lib moved
to ES2022 so `Error cause` typechecks under the preserve-caught-error lint
rule. 9 new registry tests; repo at 276.
**Priority:** P2 · **Effort:** M · **Risk:** LOW (additive registry field; static configs behave exactly as before)
**Depends on:** none open (plan 024's probe-through-worker made this natural)
**Category:** direction (Phase 3 item 2 in `docs/OVERVIEW.md` §14; the audit noted the probe had a "by-design tension" with exactly this feature)

## Why

Composition dimensions/fps/duration are static literals today. Real Framewise
lets a `<Composition>` declare `calculateMetadata({props})` so the video adapts
its shape to its inputs — a countdown whose duration comes from `props.seconds`
shouldn't need a registry edit per variant. Because our renderer probes
metadata from the live page (plan 024), supporting this needs **zero renderer
changes**: the probe already reads whatever the page computed.

## Design

### Registry

```ts
type CalculatedMetadata = Partial<{width; height; fps; durationInFrames}>;
type Composition = {
  …
  /** Optional: derive metadata overrides from the resolved props
   *  (defaultProps merged with inputProps). Runs once at page init in both
   *  preview and render, BEFORE first paint/probe. */
  calculateMetadata?: (args: {props: Record<string, unknown>; composition: Composition}) => CalculatedMetadata;
};
```

- Shared resolver `resolveCompositionConfig(comp, inputProps)` (in
  `registry.ts`, unit-tested): merges props → calls hook → validates every
  returned field (positive integers; fps positive number) → warns on unknown
  keys → returns `{config, props}`. Static entries skip the hook entirely and
  are byte-identical to today.
- Consumers: `src/render/main-render.tsx` (render path — hook runs before
  `renderFrame(0)`/API publication, so the probe sees calculated values;
  failures print to the page body then throw) and `src/App.tsx` (preview path
  — same resolution so the Player always matches what a render would do).

### Demo

New `Countdown` composition: `props.seconds` drives a big ticking number +
progress bar; `calculateMetadata` returns
`{durationInFrames: Math.ceil(seconds * composition.fps)}` with range
validation (1–60 s). Default 5 s ⇒ 150 frames; `--props '{"seconds":3}'`
renders 90 frames with no registry change — the whole feature in one command.

## Steps

1. Registry types + resolver + validation/warnings; wire into
   `main-render.tsx` and `App.tsx`.
2. `Countdown` demo registered after `WithOffthread`.
3. Tests: new `src/render/registry.test.ts` — passthrough without hook,
   override merge precedence, each invalid-field rejection, unknown-key
   warning, props merge order (inputProps win).
4. Live verification: `--list`; render Countdown default (expect 150 frames);
   with `--props '{"seconds":3}'` (expect 90); with `{"seconds":99}`
   (expect clean failure naming the constraint).
5. Docs: chapter 7 note that the probe's tension is now resolved (dynamic
   metadata flows through the same runtime probe); source-map/README rows for
   Countdown; OVERVIEW §14 Phase 3 row ✅; plans row DONE.
6. Gate: `npm run verify`.

## STOP conditions

- Any change needed inside `scripts/render.mjs`'s chunking/encode logic →
  stop and report (the design requires none; the probe already carries it).
- Static-composition hashes changing → stop.

## Done means

Hook + resolver + demo + tests + docs landed; live matrix verified; verify
green; plan header + row DONE.
