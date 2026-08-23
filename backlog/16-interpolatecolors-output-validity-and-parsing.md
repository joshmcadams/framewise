# 16 — `interpolateColors`: invalid output past the range, plus two parsing gaps

**Type:** Correctness / polish · **Severity:** Low · **Introduced by:** plan 020 (`fef3e9c`)
**Status:** DONE — fixed by plan 037 (16a: formatColor clamps into gamut — extend math kept, string always valid CSS; 16b: lowercased once in parseColor; 16c: empty rgb/hue components rejected)

Three issues in `src/framewise-lite/interpolate-colors.ts`. One PR.

## 16a — `extend` emits out-of-gamut, invalid CSS

`formatColor` (line 161) rounds but never clamps, and the default extrapolation
is `extend`, so:

```js
interpolateColors(-1, [0, 1], ['#ff0000', '#0000ff'])  // → "rgba(510, 0, -255, 1)"
interpolateColors(2,  [0, 1], ['rgba(0,0,0,0)', 'rgba(0,0,0,1)'])  // → "rgba(0, 0, 0, 2)"
```

This is *deliberate* — it mirrors `interpolate`'s `extend` default and is pinned
by `interpolate-colors.test.ts:52` — so treat it as a decision to revisit, not an
oversight. The argument for revisiting: browsers are the only consumer that
silently clamps out-of-range `rgb()` per CSS Color 4. Canvas APIs, CSS-in-JS
libraries, and any downstream color parser will reject or mangle it, and
`alpha: 2` is invalid everywhere.

Clamping inside `formatColor` (channels to `[0,255]`, alpha to `[0,1]`) keeps the
`extend` *math* — the mix continues linearly past the range — while guaranteeing
the returned string is always a valid color. Update the pinned test with the
reasoning either way.

## 16b — uppercase `HSL(...)` throws; uppercase `RGB(...)` works

`parseColor` (lines 147-151) lowercases only on the rgb branch:

```js
if (/^rgba?[(]/i.test(trimmed)) return parseRgbLike(trimmed.toLowerCase());  // ok
if (/^hsla?[(]/i.test(trimmed)) return parseHslLike(trimmed);                // not lowered
```

The detection regex is case-insensitive but `parseHslLike`'s
`.replace(/^hsla?\(/, '')` is not, so the prefix survives and `Number("HSL(240")`
is `NaN`:

```
interpolateColors(0, [0,1], ['HSL(240, 100%, 50%)', '#fff'])
// Error: Invalid hue "HSL(240" in "HSL(240, 100%, 50%)".
```

Lowercase once in `parseColor` before dispatching.

## 16c — empty rgb channels parse as black

`Number('')` is `0`, which is finite and in range, so `parseRgbChannel` accepts
it: `interpolateColors(0, [0,1], ['rgb(, , )', '#fff'])` → `rgba(0, 0, 0, 1)`.
Reject empty/whitespace components explicitly.

## Acceptance

- Tests covering: extend past both ends returns a valid CSS color; `HSL(...)`,
  `hsl(...)`, `RGB(...)`, `rgb(...)` all parse identically; `rgb(, , )` throws.
