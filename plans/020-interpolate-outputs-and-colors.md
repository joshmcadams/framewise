# Plan 020 — Completing `interpolate`: tuple & string outputs + `interpolateColors`

**Status:** DONE (2026-08-23) — all three surfaces landed as designed. Tuple
and string-template modes branch on the output shape and share one
input-side pipeline (`resolveSegment`, now exported `@internal`) with the
scalar path; `interpolateColors` reuses validation, segment finding, easing,
and that same pipeline from `interpolate.ts`. 25 new tests across
`interpolate.test.ts` (tuples + templates) and a new
`interpolate-colors.test.ts` (parsing incl. hsl→rgb, blending, easing,
clamp-vs-extend, error matrix); existing 14 interpolate tests untouched.
Docs: chapter 2 gained "Tuple and string-template outputs" +
"`interpolateColors`" sections; source map, README table, and OVERVIEW §5
updated. Phase 1 of the OVERVIEW roadmap is now fully complete.
**Priority:** P2 · **Effort:** M · **Risk:** LOW-MEDIUM (`interpolate`'s numeric path is pinned by tests; new modes must be purely additive)
**Depends on:** none open
**Category:** direction (backlog item B — the last open Phase 1 item in `docs/OVERVIEW.md` §14)

## Why

Backlog item B deferred "`interpolate` string/tuple outputs + color
interpolation". `interpolate.ts`'s own header names the gap: upstream supports
string templates (`"scale(2)"`) and tuple output ranges; and colors need their
own entry point because RGB components don't survive naive string templating
(`"#ff00ff"` is not three numbers). This plan closes Phase 1: after it, every
primitive named in the repo's deferred lists exists.

## API design

### Tuple output ranges (in `interpolate`)

```ts
interpolate(frame, [0, 30], [[0, -120], [1, 0]]) // → [x, y] pair
```

- Triggered when `outputRange[0]` is an array; **every** entry must then be an
  array of finite numbers with the same length (teaching-first errors).
- Semantics: the input-side machinery (segment finding, extrapolation, wrap,
  posterize, easing incl. per-segment arrays) runs once on the scalar input;
  each lane is then mapped through the same linear segment math.
- `'identity'` extrapolation is meaningless for a vector target → throws with
  a clear message in tuple mode.
- Return type widens to `number | number[] | string`; JSDoc documents how to
  narrow.

### String template outputs (in `interpolate`)

```ts
interpolate(frame, [0, 30], ['scale(0)', 'scale(1.2)']) // → "scale(0.83)"
```

- Triggered when `outputRange[0]` is a string; all entries must be strings.
- RN-style pattern extraction: pull every number out of the first template,
  require each subsequent template to contain exactly the same count,
  interpolate each slot through the same pipeline as tuples, and substitute
  the results back into the template in order.
- Formatting: values are rendered via `Number(v.toFixed(4))` (trims floating-
  point noise, drops trailing zeros).
- Zero-slot templates (constant strings like `"none"`): allowed only if every
  entry is byte-identical; otherwise throw.
- Caveat documented, not hidden: numeric slots make `rgb(r,g,b)` templates
  work but `#hex` templates silently nonsense — colors belong in
  `interpolateColors`.

### `interpolateColors(input, inputRange, outputRange, options?)`

New `src/framewise-lite/interpolate-colors.ts`, exported from the barrel:

```ts
interpolateColors(progress, [0, 1], ['#ff0000', 'rgb(0, 0, 255)'])
// → "rgba(127, 0, 127, 1)"
```

- Parses `#rgb` `#rgba` `#rrggbb` `#rrggbbaa`, `rgb()` / `rgba()` (comma
  syntax), `hsl()` / `hsla()` (degrees or any angle unit-less number); mixes
  formats freely by normalizing everything to `{r, g, b, a}`.
- Interpolates channels independently with the same easing/extrapolation
  contract as `interpolate`; returns an `rgba(r, g, b, a)` string (channels
  rounded to integers, alpha to ≤ 3 decimals).
- Options: `easing` (single or per-segment array), `extrapolateLeft/Right`
  accepting `'clamp' | 'extend'` (default `'extend'`, matching its sibling);
  other modes throw with a pointer to why.
- Validation mirrors `interpolate` (monotonic input range, equal lengths,
  finite inputs) by reusing `interpolate.ts` internals exported as
  `@internal`.

## Non-goals

- No demo composition or HelloWorld refactor: the API is exercised in docs
  examples instead; HelloWorld's HSL hue drift stays as-is (its look depends
  on HSL-space blending, which RGB interpolation would subtly change).
- Named colors (`'rebeccapurple'`) and `oklch()` etc.: unsupported, explicit
  error listing what *is* supported.

## Steps

1. **Refactor-free additive change** in `interpolate.ts`: branch on
   `typeof outputRange[0]` into tuple mode and string-template mode; extract
   the shared "resolve input position within its segment" step so all three
   modes consume identical input handling. Export `@internal` validators.
2. **Implement** `src/framewise-lite/interpolate-colors.ts`; export
   `interpolateColors` from `index.ts`.
3. **Test**: extend `interpolate.test.ts` (tuples: basic/multi-segment/easing/
   clamp/extend/error matrix; strings: substitution/formatting/slot-count/
   constant-string/error matrix) and add `interpolate-colors.test.ts`
   (format parsing incl. hsl→rgb, blending accuracy, alpha, easing, clamp vs
   extend, error matrix). All existing tests untouched and passing.
4. **Docs**: extend chapter 2 with the two new sections; add
   `interpolate-colors.ts` to the `docs/code/README.md` tree + chapter 2 row;
   add a top-level README table row; update `docs/OVERVIEW.md` §5 and empty
   the Phase 1 table (all items shipped note).
5. **Gate**: `npm run verify`.

## STOP conditions

- Any existing `interpolate` test failing → stop; additive means additive.
- Changes leaking outside `interpolate.ts`, `interpolate-colors.ts`,
  `index.ts`, their tests, and docs → stop and report.

## Done means

All three surfaces land with tests + docs in one commit series; `npm run
verify` green; plan Status header and `plans/README.md` row flipped to DONE.
