# 08 — Studio UI — **split into 08a (ship it) and 08b (gated)**

**Status:** 08a ready after 00b+04 · 08b blocked on 07
**Effort:** 08a M · 08b M (was one L item)
**Depends on:** 08a → 00b, 04 · 08b → 07, 08a
**Unblocks:** turns the dev app from a teaching artifact into a daily driver

## Audit verdict

The right ambition, and correctly identified as the largest item. Three
problems with it as a single unit:

1. **It assumed a Player API that does not exist.** "Click/drag →
   `Player.seekTo`" — `seekTo` is a local `useCallback` (`Player.tsx:56-65`).
   The Player exposes no ref, no imperative handle, and no controlled-`frame`
   prop. Exposing it is a public-API change to the library's most-documented
   component and needs its own design decision (below).
2. **Its most valuable half (the render button) is blocked only by 04, while its
   riskiest half (the timeline panel) is blocked by 07, which is now
   NEEDS-DECISION.** Bundling them means the cheap win waits on the expensive
   unknown. Hence the split.
3. **The thumbnail cache key was under-specified in the one way that makes it
   lie.** "keyed on `(compId, propsHash, configHash, frame)`" omits the code
   itself — edit a composition and the cache serves stale thumbnails with no
   signal. Same invalidation problem item 14 has, and the two should share one
   answer.

---

## 08a — Render button + progress + transport keys · M

### Scope

- **Render button** on the existing single-composition view (`App.tsx:122-168`):
  spawns a render through item 00b's API (or `node scripts/render.mjs
--log=json`, item 04), streams events into a progress bar + ETA, and shows the
  final output path and full sha256. Failures print the named error **verbatim**
  — the whole point of the ladder is that the user sees the real message.
- A **Cancel** button wired to the `AbortSignal` item 00b adds. A render you
  cannot stop from a UI is a worse experience than no button.
- **Transport keys** in the Player: J/K/L, Home/End, Shift+←/→ = ±10. Extends
  the existing handler (`Player.tsx:109-123`), which today has Space and ←/→.
  Gate behind an opt-in prop so embedding apps don't inherit new key capture.

### The architectural question 08a must answer

The preview app is a **browser page**; spawning a process is a **Node** action.
Options:

| Option                                        | Cost                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vite dev-server middleware** (recommended)  | ~40 lines: a plugin like `framewiseExtract` (`offthread-server.mjs:117-145`) exposing `POST /__framewise_render` + an SSE/NDJSON stream. Reuses a pattern already in the repo. |
| Separate WebSocket sidecar                    | new server, new port, new lifecycle — more moving parts                                                                                                                        |
| Download-a-command button (copy the CLI line) | ~zero cost, ~zero magic; a legitimate v0 if time is short                                                                                                                      |

**Recommendation:** the Vite plugin. It mirrors `framewiseExtract`, it dies with
the dev server, and it does not exist in production builds — which is the right
security posture, since it spawns local processes. Say that explicitly: the
render endpoint is **dev-server only** and must never be part of `vite build`
output.

### Verification (08a)

- The endpoint refuses to register when `command === 'build'` (asserted, not
  assumed) — this is a "spawns processes" endpoint
- End-to-end on HelloWorld: events → progress → `done`, and the reported sha256
  **equals a CLI run of the same options** (this is the test that proves one
  pipeline, not two)
- A deliberately failing render (bad `--props`) surfaces the named error text
  unmodified in the UI
- Cancel mid-render: UI returns to idle, no orphan Chrome (`pgrep` check in the
  manual script), temp dir removed
- Player key table tested in the existing Player suite (`Player.test.tsx`), one
  case per binding, including that keys are inert when the opt-in prop is off

---

## 08b — Timeline panel + filmstrip · M · **blocked on 07**

### Prerequisite: a Player seek API

Pick one and do it deliberately:

| Option                                      | Notes                                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref` + `useImperativeHandle` (`PlayerRef`) | Matches Remotion; keeps the Player uncontrolled; one new exported type                                                                                                                             |
| Controlled `frame` + `onFrameChange`        | More React-idiomatic, but the clock lives in the Player (`Player.tsx:70-104`) and lifting it risks the wall-clock derivation that `README.md:133-138` calls "the #1 thing naive players get wrong" |
| `initialFrame` only                         | Insufficient for a timeline panel                                                                                                                                                                  |

**Recommendation:** `PlayerRef` with `seekTo`, `play`, `pause`, `getFrame`.
Lifting the clock is the one refactor here that could damage a documented
guarantee.

### Scope

- **Timeline panel**: lanes from `buildTimeline` — sequence/loop blocks on a
  frame ruler with time labels, media spans as their own lanes. Click/drag →
  `ref.current.seekTo(frame)`. **Read-only v1**; no drag-editing.
- The panel must render `Timeline.warnings` (item 07) as visible UI, not swallow
  them. A timeline that silently omits half a composition is worse than none.
- **Filmstrip thumbnails**: throttled stills along the scrubber, generated
  lazily through the same still pipeline, cached on disk.

### Thumbnail cache key — the part that lies if you get it wrong

Key on **everything that feeds pixels**: `compId`, resolved-props hash,
resolved-config hash, capture settings (scale/format), **and a source hash**.
Item 14 needs exactly the same "did the code change" answer — build the helper
once, in one module, and have both use it. Do not ship two different definitions
of "is this stale".

Cheap correct-enough source hash: content hash over `src/**` + `public/**` +
`package-lock.json`. Get the definition from item 14's file; do not invent a
second one.

### Verification (08b)

- Lane click at x → Player readout lands on the expected frame (manual script
  with exact pixel→frame math asserted in a unit test on the mapping function,
  which should be pure)
- Thumbnails regenerate after a props change **and** after touching a
  composition source file (the stale-cache test; the second half is the one
  that catches a key missing the source hash)
- `warnings` from a frame-conditional composition are visible in the UI
- Panel matches `WithSeries`'s known structure

---

## Files touched

`studio.html` + `src/studio/*` (new), `vite.config.ts` (multi-page input — note
this changes `npm run build` output and therefore item 17's `npm pack` file-list
gate), a dev-only Vite plugin for the render endpoint, `Player.tsx` (keys in
08a, `PlayerRef` in 08b).

Keeping studio on a **separate page** from `src/App.tsx` is right: the minimal
teaching app is itself a documented artifact (chapter 6) and should stay small.

## STOP — decisions the executor must not make alone

1. **Do not ship drag-editing.** Editing implies mutating source, which is a
   different product.
2. **Do not lift the Player clock** into a parent without an explicit decision —
   see the table above.
3. **Do not expose the render endpoint in a production build.**

## Risks

- Scope creep — this is the item most likely to sprawl. 08a's success criterion
  is "one button, correct hash, cancellable".
- React traps from root `AGENTS.md` apply hard here: no freshly-created objects
  in effect deps, derive during render where possible (`App.tsx:81-83`'s
  `settledText` pattern is the worked example).
- Two sources of truth for "what does this composition look like" (studio vs
  CLI). The sha256-equality test above is the guard.

## Docs

Chapter 5 (Player) gains the keyboard table and, in 08b, the `PlayerRef` API.
A new chapter 13 "Studio" (after transitions takes 12) or a major section — and
it must state that the render endpoint is dev-only and spawns local processes.
README dev-workflow mention. Source-map entries.

## Definition of done

- [ ] 08a: render button produces a hash equal to the CLI's for the same options
- [ ] 08a: cancel works; no orphan processes; endpoint absent from `vite build`
- [ ] 08a: transport keys tested, opt-in, documented in chapter 5
- [ ] 08b: `PlayerRef` decision recorded; seek mapping unit-tested
- [ ] 08b: stale-cache test covers both props changes and source changes
- [ ] 08b: `Timeline.warnings` surfaced in the UI
- [ ] `npm run verify` green; multi-page build's effect on `npm pack` checked
