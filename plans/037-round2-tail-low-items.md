# 037 — Round 2 tail: interpolateColors polish, renderer cleanups, App.tsx disables

**Status:** DONE — 2026-08-24 — 16: formatColor clamps into gamut (extend math
kept, string always valid CSS), parseColor lowercases once (uppercase HSL
fixed), empty rgb/hue components rejected; 17: concat-list quote escaping
(O'Brien test), dead base64 catch removed (Buffer.from never throws),
tsconfig target=ES2022 matching lib with rationale comment; 18: file-level
hooks disables GONE — CompositionView under key={comp.id} resets state by
remount, resolution moved into the change handler as `Resolved` state so no
ref is touched during render at all (stronger than the backlog's ask). 315
tests green; ch. 2 formatting paragraph synced.

**Backlog items:** Round 2 #16, #17, #18 (all Low)

## 16 — interpolateColors

- **a)** `formatColor` clamps channels to `[0,255]` and alpha to `[0,1]` after
  mixing: `extend` math is unchanged, but the returned string is always valid
  CSS (browsers silently clamp; every other consumer rejects or mangles
  out-of-gamut values). Pinned test updated with the reasoning.
- **b)** `parseColor` lowercases once before dispatching — uppercase `HSL(…)`
  no longer throws while uppercase `RGB(…)` works.
- **c)** Empty/whitespace rgb components (`rgb(, , )`) throw instead of
  parsing as 0 via `Number('')`; same guard on an empty hsl hue.

## 17 — renderer/config cleanups

- **a)** `buildConcatList` escapes `'` as `'\''` per the concat demuxer's
  shell-like quoting (unreachable today under mkdtemp paths; exported helper
  should be correct anyway) + exact-string test.
- **b)** Drop the dead try/catch around `Buffer.from(…, 'base64url')` — it
  never throws; decoded content is already validated by the root-relative
  check below it.
- **c)** `tsconfig.json`: `target` raised to ES2022 to match `lib`, with a
  comment (node >=20 declares both; lib must not lead target silently).

## 18 — App.tsx

Remove the file-level `eslint-disable react-hooks/refs, set-state-in-effect`.
The derived-state effect disappears by extracting `<CompositionView>` mounted
with `key={comp.id}` (React's own reset-pattern); state initializes from
`defaultProps` directly. `lastGoodRef` keeps its render-phase write behind a
single-line disable with a justification comment (idempotent same-value write,
read-only fallback cache).

## Acceptance

- Tests: both-end extend returns valid CSS; HSL/hsl/RGB/rgb identical;
  `rgb(, , )` throws; concat list escapes quotes.
- No file-level eslint-disable in App.tsx; lint clean; App.test.tsx green
  (poster-switch + props-editor defaults).
- ch. 2 color-formatting paragraph synced to the clamp decision.
