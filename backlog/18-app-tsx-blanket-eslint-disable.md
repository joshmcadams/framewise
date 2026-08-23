# 18 — `App.tsx` silences two React hooks rules file-wide

**Type:** Quality / teaching · **Severity:** Low · **Introduced by:** plan 027 (`0a84f6d`)
**Status:** DONE — fixed by plan 037, going one step further than the suggested fix: the file now carries **no** disables at all. The derived-state effect became a `key={comp.id}` remount (`<CompositionView>`), and the render-phase ref write was eliminated entirely by moving resolution into the change handler as `Resolved` state — the hooks-compiler rules flag ref *reads* during render too, so a narrowed disable would have only relocated the smell.

## Problem

`src/App.tsx:1`:

```js
/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect */
```

This turns both rules off for the **entire file**, permanently, to accommodate
two specific patterns:

1. **A ref written during render** (line 118-120) — `lastGoodRef.current` is
   assigned in the component body, not in an effect or event handler. Benign
   here (same value on a StrictMode double-render), but it is exactly the write
   the rule exists to catch, and it is not concurrent-safe as a general pattern.
2. **Derived state in an effect** (lines 69-73) — `setPropsText` / `setInputProps`
   / `setParseError` fire in a `useEffect` keyed on `comp`, causing a second
   render pass on every composition switch.

In a repo whose stated product is its docs — "Docs are the product", CLAUDE.md —
modeling both anti-patterns *and* silencing the linter that names them is the
part worth fixing. A blanket disable also hides any future violation anywhere in
the file.

## Fix

- Replace the derived-state effect with a `key={comp.id}` on the editor subtree
  (React's own recommendation for "reset state when a prop changes"), which
  removes the effect entirely.
- If `lastGoodRef` survives that refactor, narrow the suppression to a single
  line with a comment explaining why the render-phase write is safe here.

## Acceptance

- No file-level `eslint-disable` in `App.tsx`; `npm run lint` clean.
- `App.test.tsx` still passes — in particular "clicking a poster switches back to
  single and selects that composition" and the props-editor default-props test.
