# Chapter 4 — Sequence

**File:** `src/framewise-lite/Sequence.tsx`

`<Sequence>` is the most important *compositional* primitive in Framewise, and
it's almost suspiciously small. Its entire job is to **shift the frame number**
for its children. From that one trick, whole timelines emerge.

## The problem it solves

Every animation in a composition is written as a function of `frame`, starting
at frame 0. But a real video has many elements that start at *different* times:
a title at frame 0, a subtitle at frame 25, a logo at frame 60. You don't want
to litter every component with `frame - 25` offsets. `<Sequence from={25}>`
lets a child be written as if *it* starts at 0, and places it in time from the
outside.

## The whole implementation

```tsx
export const Sequence = ({from = 0, durationInFrames = Infinity, layout = 'absolute-fill', style, children}) => {
  const frame = useCurrentFrame();      // the OUTER timeline's frame
  const shifted = frame - from;          // re-based to this sequence's start

  const isActive = shifted >= 0 && shifted < durationInFrames;
  if (!isActive) {
    return null;                          // outside the window → unmount
  }

  const content = layout === 'none'
    ? <>{children}</>
    : <AbsoluteFill style={style}>{children}</AbsoluteFill>;

  return <FrameProvider value={shifted}>{content}</FrameProvider>;
};
```

That's it. Walk it:

1. **Read the outer frame.** `useCurrentFrame()` gives the frame from whatever
   provider is above — the `Player`, or another enclosing `Sequence`.
2. **Shift it.** `shifted = frame - from`. When the outer timeline is at frame
   25 and `from = 25`, `shifted` is 0.
3. **Re-provide it.** `<FrameProvider value={shifted}>` wraps the children. Now
   *inside* this sequence, `useCurrentFrame()` returns `shifted`. The child
   genuinely believes time starts at 0 — it has no idea it's been placed later
   on a bigger timeline.

This is why chapter 1 insisted that `useCurrentFrame` must be a pure reader.
Because it just reads the nearest provider, `Sequence` can transparently lie to
its children about what time it is, and every animation primitive
(`interpolate`, `spring`) automatically respects the shifted clock with no
special-casing.

## Clipping: the active window

```tsx
const isActive = shifted >= 0 && shifted < durationInFrames;
if (!isActive) return null;
```

A sequence is only "on screen" during `[from, from + durationInFrames)`:

- Before `from`, `shifted` is negative → not active → renders `null`.
- After `from + durationInFrames`, `shifted >= durationInFrames` → renders
  `null`.

`durationInFrames` defaults to `Infinity`, so a `<Sequence from={25}>` with no
duration simply appears at frame 25 and stays forever. Returning `null` outside
the window means the children **unmount** — they're not just hidden, they leave
the tree (and stop running any hooks). That matches the common Framewise case and
keeps things simple.

## The `layout` prop

```tsx
const content = layout === 'none'
  ? <>{children}</>
  : <AbsoluteFill style={style}>{children}</AbsoluteFill>;
```

By default (`'absolute-fill'`), a Sequence wraps its children in an
`AbsoluteFill` (chapter 1) — because the overwhelmingly common case is "a
full-frame layer that appears at time X." When you don't want that wrapper —
say the child is an inline element you're positioning yourself — pass
`layout="none"` and the children render bare. This mirrors Framewise's
`layout="none"` escape hatch.

## Why this tiny thing is a big deal

Almost every higher-level timing API in Framewise is built on `Sequence`:

- **`<Series>`** (play clips back-to-back) is `Sequence`s with auto-computed
  `from` offsets.
- **Transitions** are overlapping `Sequence`s with interpolated cross-fades.
- **Nested timing** works for free: a `Sequence` inside a `Sequence` shifts an
  already-shifted frame, so you can build sub-timelines arbitrarily deep. In the
  demo, the looping dot lives in `<Sequence from={40}>` *inside* the main
  composition — it sees a frame re-based to the parent's frame 40.

Twenty lines, because all the heavy lifting was already done by making the
frame a context value.

---

Next: [Chapter 5 — the Player](05-player.md), the one component that actually
*creates* a changing frame.
