# Chapter 2 — interpolate

**File:** `src/framewise-lite/interpolate.ts`

`interpolate` is the workhorse of Framewise animation. It maps a number from one
range to another. You use it constantly: "as the frame goes 0 → 30, take opacity
from 0 → 1," "as the frame goes 0 → 100, sweep the hue 220 → 320." It is a
faithful port of Framewise's numeric path (which itself derives from React
Native's `AnimatedInterpolation`).

## The signature

```ts
interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options?: InterpolateOptions,
): number
```

```ts
interpolate(5, [0, 10], [0, 100]); // => 50
```

Read it as: "`input` is currently 5; it lives on a scale from 0 to 10; map that
onto a scale from 0 to 100." 5 is halfway through `[0,10]`, so the answer is
halfway through `[0,100]` = 50.

## The one thing everyone gets wrong: the default is `extend`, not `clamp`

```ts
const extrapolateLeft = options?.extrapolateLeft ?? 'extend';
const extrapolateRight = options?.extrapolateRight ?? 'extend';
```

What happens for inputs _outside_ `inputRange`? Most people assume it clamps to
the output bounds. It does **not**. The default is `extend`, which keeps
extrapolating the line:

```ts
interpolate(15, [0, 10], [0, 100]); // => 150  (NOT 100!)
interpolate(-5, [0, 10], [0, 100]); // => -50  (NOT 0!)
```

This is the single most common Framewise footgun, which is exactly why the demo
composition and the tests both pin it down. When you want clamping — which for
opacity/position you almost always do — you ask for it explicitly:

```ts
interpolate(15, [0, 10], [0, 100], {extrapolateRight: 'clamp'}); // => 100
```

The four modes (`ExtrapolateType`) and how each treats an out-of-range input:

| Mode               | Behavior outside the range         |
| ------------------ | ---------------------------------- |
| `extend` (default) | Keep going linearly past the edge  |
| `clamp`            | Pin to the nearest edge value      |
| `identity`         | Return the raw input unchanged     |
| `wrap`             | Modulo back into the range (loops) |

## The core: `interpolateFunction`

This private function does the actual mapping for a _single_ segment (a pair of
input/output endpoints). The flow:

```ts
// 1. Handle the left edge (input below inputMin) per extrapolateLeft
if (result < inputMin) { … identity / clamp / wrap / extend … }
// 2. Handle the right edge (input above inputMax) per extrapolateRight
if (result > inputMax) { … }
// 3. Degenerate output: if both outputs equal, short-circuit
if (outputMin === outputMax) return outputMin;
// 4. Normalize input into [0, 1] within the segment
result = (result - inputMin) / (inputMax - inputMin);
// 5. Apply easing to that normalized 0..1 value
result = easing(result);
// 6. Scale up into the output segment
result = result * (outputMax - outputMin) + outputMin;
```

Two details worth pausing on:

- **`identity` returns early** (`return result`) before normalization, because
  "return the raw input" means exactly that — it bypasses the output range
  entirely. `clamp` and `wrap` instead _adjust_ `result` and then fall through
  to the normal math.
- **Easing is applied to the normalized `[0,1]` value** (step 5), _between_
  normalization and scaling. That's why an easing function is always written
  against a 0→1 domain regardless of your actual ranges — it shapes the
  _progress_, then the result is scaled to wherever your output lives. The
  `wrap` formula `((((result - inputMin) % range) + range) % range) + inputMin`
  is the standard "positive modulo" — the double `% + range %` dance makes it
  work for negative inputs too.

## Multiple segments (keyframes)

Real animations have more than two points: "0 → fade in → hold → fade out." You
express that with longer ranges:

```ts
interpolate(frame, [0, 15, 130, 150], [0, 1, 1, 0]); // a fade-in/hold/fade-out
```

`interpolate` finds which segment the input falls into and maps within it. That
dispatch is `findRange`:

```ts
function findRange(input, inputRange) {
  let i;
  for (i = 1; i < inputRange.length - 1; ++i) {
    if (inputRange[i] >= input) break;
  }
  return i - 1;
}
```

It returns the index of the segment's left endpoint, then the public function
hands `interpolateFunction` just that one pair:

```ts
const range = findRange(posterizedInput, inputRange);
return interpolateFunction(
  posterizedInput,
  [inputRange[range], inputRange[range + 1]],
  [outputRange[range], outputRange[range + 1]],
  {easing, extrapolateLeft, extrapolateRight},
);
```

So multi-segment interpolation is just "pick the segment, then do the
two-point math." Easing can even be _per-segment_ — `options.easing` may be an
array with one function per segment, resolved here:

```ts
const easing =
  easingOption === undefined
    ? defaultEasing
    : typeof easingOption === 'function'
      ? easingOption
      : easingOption[range]; // array → the easing for THIS segment
```

## Validation — failing loud and early

Before any math, the public `interpolate` runs guards that match Framewise's
error messages. The important ones:

```ts
// lengths must match
if (inputRange.length !== outputRange.length)
  throw new Error('inputRange (…) and outputRange (…) must have the same length');

// inputRange must be strictly increasing — required for findRange to work
function checkValidInputRange(arr) {
  for (let i = 1; i < arr.length; ++i)
    if (!(arr[i] > arr[i - 1]))
      throw new Error('inputRange must be strictly monotonically increasing…');
}
```

Why monotonic? `findRange` walks the input range assuming it ascends. A
non-increasing range like `[0, 0]` or `[10, 0]` would silently produce garbage
(or divide by zero in normalization). Catching it up front turns a subtle wrong
number into a clear error at the call site. There are also finite-number checks
(`checkFiniteRange`) so a stray `NaN`/`Infinity` is rejected rather than
propagating.

## Easing

`interpolate` accepts an `EasingFunction` — a function `(t: number) => number` that
shapes the progress through a segment. It receives the normalized `[0,1]` value
(step 4 inside `interpolateFunction`) and returns a reshaped `[0,1]` value that
the segment then scales to the output range. You can pass a single function or an
array with one function per segment:

```ts
interpolate(frame, [0, 30], [0, 100], {easing: (t) => t * t}); // single
interpolate(frame, [0, 30, 60], [0, 100, 200], {easing: [quad, linear]}); // per-segment
```

The library ships a set of standard curves and combinators in `easing.ts`
(ported from Framewise / React Native `Easing`):

- **Primitive curves**: `linear`, `quad`, `cubic`, `poly(n)`, `sin`, `circle`,
  `exp` (note: `exp(0)` is 2⁻¹⁰ — near-zero, not zero, matching upstream).
- **Character curves**: `back(s)` (wind-up below 0 before accelerating;
  `s` defaults to 1.70158 ≈ 10% overshoot when mirrored with `out`),
  `bounce` (Penner's four-bounce piecewise parabola), and `elastic(b)`
  (damped spring wiggle; `b` half-oscillations, values > 1 overshoot past 1).
  All three are ease-IN shapes — wrap in `Easing.out(...)` for the familiar
  "settle into place" versions.
- **Custom**: `bezier(x1, y1, x2, y2)` — cubic bezier with a Newton-Raphson
  solver. `Easing.ease` is `bezier(0.42, 0, 1, 1)` — the CSS `ease-in` curve
  (upstream React Native/Framewise name it `ease`; CSS `ease` proper is
  `(0.25, 0.1, 0.25, 1)`).
- **Combinators**: `in(fn)`, `out(fn)`, `inOut(fn)`. `out` mirrors a curve so
  it decelerates: `out(fn)(t) = 1 - fn(1 - t)`. `inOut` splices ease-in on the
  first half and ease-out on the second.

The HelloWorld demo uses `Easing.out(Easing.cubic)` on the subtitle slide-up so
it decelerates into place rather than sliding linearly.

## Tuple and string-template outputs

The numeric path above is the core, but the shipped `interpolate` also accepts
richer output shapes — all three consume the **same input-side pipeline**
(extrapolation → normalize → ease), differing only in how the eased progress
`t` maps onto the output:

```ts
// Tuples: every lane interpolates independently.
interpolate(
  5,
  [0, 10],
  [
    [0, -100],
    [100, -200],
  ],
); // → [50, -150]

// String templates: embedded numbers are extracted, interpolated slot by
// slot, and substituted back in order (React Native's classic pattern).
interpolate(5, [0, 10], ['scale(0)', 'scale(2)']); // → "scale(1)"
```

Implementation notes worth knowing:

1. **Mode dispatch happens on `typeof outputRange[0]`**, before any math. Each
   mode validates its shape up front: tuples must be non-empty, equal-length,
   finite; string templates must contain the same number of slots in every
   entry (zero-slot templates are constants and must be byte-identical).
2. **Slot formatting** rounds to four decimals (`Number(v.toFixed(4))`) so
   CSS-bound values don't carry binary-float noise.
3. **`'identity'` extrapolation throws** in tuple/string modes — it would have
   to invent a vector or a string from a raw scalar.
4. **The caveat that motivates `interpolateColors`:** numeric slots make
   `'rgb(255, 0, 0)'` templates work, but `'#ff00ff'` has no usable slots —
   its digits are one giant base-16 number. Colors parse first, then mix.

## `interpolateColors`

Colors live in their own module (`src/framewise-lite/interpolate-colors.ts`)
because they need parsing, not templating. It accepts hex (`#rgb #rgba #rrggbb
#rrggbbaa`), comma-syntax `rgb()/rgba()`, and `hsl()/hsla()` — formats mix
freely because everything normalizes to `{r, g, b, a}` first:

```ts
interpolateColors(progress, [0, 1], ['#ff0000', 'rgb(0, 0, 255)']);
// → "rgba(128, 0, 128, 1)"
```

Channels mix independently with the same easing contract as `interpolate`
(single function or per-segment array); extrapolation accepts `'extend'`
(the default) or `'clamp'` only — `'wrap'` would cycle hues backwards through
magenta and `'identity'` would return a raw number, so both throw with an
explanation. The output is always a normalized `rgba(r, g, b, a)` string:
channels rounded to integers, alpha to three decimals.

Structurally it is a thin client of this chapter's machinery: validation,
segment finding, easing resolution, and the input-side pipeline are all
imported from `interpolate.ts` (marked `@internal`), leaving only parsing,
per-channel mixing, and formatting as new code.

## The tests

`interpolate.test.ts` asserts exact outputs, which is the right kind of test for
pure math (a structural test would let an off-by-one slip through):

```ts
expect(interpolate(5, [0, 10], [0, 100])).toBe(50); // linear
expect(interpolate(15, [0, 10], [0, 100])).toBe(150); // extend default!
expect(interpolate(15, [0, 10], [0, 100], {extrapolateRight: 'clamp'})).toBe(100);
expect(interpolate(5, [0, 10], [0, 100], {easing: (t) => t * t})).toBe(25); // eased
expect(
  interpolate(
    5,
    [0, 10],
    [
      [0, -100],
      [100, -200],
    ],
  ),
).toEqual([50, -150]); // tuples
expect(() => interpolate(5, [0, 0], [0, 100])).toThrow(/monotonic/); // guard
```

`interpolate-colors.test.ts` pins format parsing, midpoint blends
(`red ⊕ blue = rgba(128, 0, 128, 1)`), alpha handling, hsl→rgb conversion,
easing, clamp-vs-extend, and the full error matrix.

---

Next: [Chapter 3 — spring](03-spring.md), the other math module, and the one
with real physics in it.
