# 02 — `spring({overshootClamping: true})` is a silent no-op unless `to === 1`

## Problem (confirmed bug)

`overshootClamping` is supposed to prevent a spring from ever passing its target.
It works for the default `to: 1` but silently does nothing for any other `to`.

In `src/framewise-lite/spring.ts`:

- `springCalculation` always animates in normalized space, `from = 0; to = 1`
  (lines 107–108). So `spr.current` is a value around `0..~1.16`.
- `spring()` then clamps that **normalized** value against the **user's** `to`
  (lines 167–171):

  ```js
  const inner = config.overshootClamping
    ? to >= from ? Math.min(spr.current, to) : Math.max(spr.current, to)
    : spr.current;
  return from === 0 && to === 1 ? inner : interpolate(inner, [0, 1], [from, to]);
  ```

When `to = 100`, `Math.min(spr.current /* ~1.16 */, 100)` never clamps, and the
subsequent `interpolate(1.16, [0,1], [0,100])` maps the overshoot straight to
116. The clamp is dimensionally inconsistent: it compares a `0..1` quantity
against an output-space target.

### Reproduction (verified)

Porting the module's own math and sampling frames 0–89 at fps 30:

```
to=1   unclamped max = 1.1629   clamped max = 1.0000   (clamp works)
to=100 unclamped max = 116.2911 clamped max = 116.2911 (clamp does NOTHING)
```

The existing test only covers `to = 1` (`spring.test.ts:23`), so the bug is
invisible to the suite.

## Fix

Clamp in the correct space. Either clamp the normalized value against the
normalized target (`1`) before mapping, or interpolate first and clamp against
`to` after. The second is clearest:

```js
const mapped =
  from === 0 && to === 1 ? spr.current : interpolate(spr.current, [0, 1], [from, to]);

if (!config.overshootClamping) return mapped;
return to >= from ? Math.min(mapped, to) : Math.max(mapped, to);
```

Confirm this matches upstream Framewise/Remotion behavior before committing —
the file claims to be a verbatim port ("`overshootClamping` ... behave exactly
like Framewise", spring.ts:6-7), so if upstream has the same defect, document
the deviation in the comment; if upstream is correct, this aligns the port.

## Acceptance criteria

- Add a regression test: with `from: 0, to: 100, config: {overshootClamping: true}`
  over frames 0–89, `Math.max(...) <= 100`.
- Add the mirror test for a descending spring (`from: 100, to: 0`): values never
  drop below `0`.
- Existing `to: 1` tests still pass; the no-clamp path is numerically unchanged.
