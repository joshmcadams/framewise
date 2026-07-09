# Chapter 1 — The Frame Engine

**File:** `src/framewise-lite/VideoConfig.tsx`

This is the smallest file in the project and the most important. It defines the
"frame as state" mechanism that everything else is built on. If you understand
this chapter, you understand the spine of Framewise.

## The two contexts

```tsx
const FrameContext = createContext<number>(0);
const VideoConfigContext = createContext<VideoConfig | null>(null);
```

There are exactly two pieces of ambient state a composition needs:

1. **The current frame** — a single number. Held in `FrameContext`.
2. **The video metadata** — `width`, `height`, `fps`, `durationInFrames`. Held
   in `VideoConfigContext`.

They're split into two contexts deliberately. The frame changes ~30–60 times a
second; the config is static for the life of a composition. Keeping them
separate means a config consumer doesn't have to care that the frame churns
(and keeps the mental model clean: "what time is it" vs. "what kind of video is
this").

`VideoConfig` is the type that mirrors Framewise's video config:

```ts
export type VideoConfig = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};
```

The providers are re-exported raw so other modules (the `Player`, and
`Sequence`) can supply values:

```tsx
export const FrameProvider = FrameContext.Provider;
export const VideoConfigProvider = VideoConfigContext.Provider;
```

## The hooks — note what they _don't_ do

```tsx
export const useCurrentFrame = (): number => {
  return useContext(FrameContext);
};
```

That's the entire implementation. Read it carefully and notice everything
that's **absent**: there's no `requestAnimationFrame`, no `useState`, no timer,
no subscription to a clock. `useCurrentFrame()` is a pure _reader_. It returns
whatever number the nearest `FrameProvider` above it is currently providing.

This is the seam the whole architecture pivots on. Because the hook only reads:

- The **Player** can drive it from a wall clock (chapter 5).
- A `<Sequence>` can drive its children from a _shifted_ number (chapter 4).
- A future **renderer** could drive it by setting frame 0, screenshotting,
  setting frame 1, screenshotting — with zero changes to any composition.

If `useCurrentFrame` had instead contained its own `requestAnimationFrame`
loop, you'd have built an _animation player_, not a Framewise clone — there'd be
no way for an exporter to step the frames deterministically. The decoupling
costs nothing and preserves the entire value proposition.

`useVideoConfig` is the same idea, with a guard:

```tsx
export const useVideoConfig = (): VideoConfig => {
  const config = useContext(VideoConfigContext);
  if (config === null) {
    throw new Error('useVideoConfig() was called outside of a composition…');
  }
  return config;
};
```

The default value is `null` precisely so that calling it outside a provider is
a loud, helpful error instead of a silent `undefined` that blows up later with
a confusing stack trace. The frame context, by contrast, defaults to `0` —
reading the frame "before time starts" is a sensible 0, not an error.

## How re-rendering happens

There's no explicit subscription code here, and there doesn't need to be. React
context already does the work: when the `Player` calls
`<FrameProvider value={42}>` and then `<FrameProvider value={43}>` on the next
tick, **every component that called `useCurrentFrame()` re-renders** with the
new value. So a composition "animates" simply by being a function of a context
value that changes. That's the entire reactivity model.

## AbsoluteFill

The last export is a convenience component, used constantly in compositions:

```tsx
const absoluteFillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

export const AbsoluteFill = ({children, style}) => {
  return <div style={{...absoluteFillStyle, ...style}}>{children}</div>;
};
```

It's a `<div>` that fills its positioned parent. Video work is almost entirely
_absolute layering_ — a background fills the frame, text sits on top, a logo in
the corner — so a "fill the whole frame, stack children in a column by default,
let me override with `style`" primitive removes a huge amount of repetitive
positioning. Note the `flexDirection: 'column'` default matches Framewise's, and
that user `style` spreads _after_ the defaults so it can override any of them.

## Why this file has no tests

`interpolate` and `spring` have unit tests because they're math. This file is
"plumbing React context together" — there's no behavior to assert that the
type-checker and the running app don't already cover. The right test for this
module is the visual one in the [verification](../../README.md) (the demo
mounts and the frame counter advances), which exercises the whole context flow
end-to-end.

---

Next: [Chapter 2 — interpolate](02-interpolate.md), the first of the two
"real math" modules.
