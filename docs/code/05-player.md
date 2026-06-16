# Chapter 5 — The Player

**File:** `src/framewise-lite/Player.tsx`

Everything so far has been *pure*: given a frame, produce pixels. The Player is
the one piece that introduces *time*. It owns a clock, turns elapsed wall-clock
time into a frame number, and feeds that number into the contexts from
chapter 1. It's the most code in the project, but it does only three things:
drive a clock, render the scaled composition, and offer transport controls.

## Props

```ts
export type PlayerProps<P extends Record<string, unknown>> = VideoConfig & {
  component: ComponentType<P>;   // the composition to play
  inputProps?: P;                // props passed into it
  loop?: boolean;
  autoPlay?: boolean;
  controls?: boolean;
};
```

It extends `VideoConfig` (so the caller supplies `width/height/fps/
durationInFrames` directly) and adds the composition `component` plus playback
options. It's generic over `P` so `inputProps` is type-checked against the
component's own props — pass the wrong shape and TypeScript complains at the
call site.

## State and refs — and why both

```tsx
const [frame, setFrameState] = useState(0);
const [playing, setPlaying] = useState(autoPlay);

const frameRef = useRef(0);        // mirror of frame, readable inside rAF
const startTimeRef = useRef(0);    // wall-clock time when this play run began
const startFrameRef = useRef(0);   // frame we were on when this play run began
```

`frame` and `playing` are **state** because the UI must re-render when they
change. But the `requestAnimationFrame` loop needs to read the *latest* frame
without re-subscribing every tick — so `frameRef` mirrors `frame`. The
`startTime`/`startFrame` refs are the clock's baseline (explained below). A tiny
helper keeps the ref and state in sync:

```tsx
const setFrame = useCallback((f: number) => {
  frameRef.current = f;
  setFrameState(f);
}, []);
```

## The clock — and the #1 playback bug it avoids

This is the load-bearing part of the whole file:

```tsx
useEffect(() => {
  if (!playing) return;

  // If we're sitting on the last frame, rewind so Play replays.
  if (!loop && frameRef.current >= durationInFrames - 1) setFrame(0);

  startTimeRef.current = performance.now();      // baseline: when we hit play
  startFrameRef.current = frameRef.current;       // baseline: where we were

  let raf = 0;
  const tick = () => {
    const elapsedMs = performance.now() - startTimeRef.current;
    const framesElapsed = (elapsedMs * fps) / 1000;
    const exact = startFrameRef.current + framesElapsed;

    if (loop) {
      setFrame(Math.floor(exact % durationInFrames));
    } else if (exact >= durationInFrames) {
      setFrame(durationInFrames - 1);
      setPlaying(false);
      return;                                      // stop the loop at the end
    } else {
      setFrame(Math.floor(exact));
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [playing, loop, fps, durationInFrames, setFrame]);
```

The crucial line is:

```ts
const framesElapsed = (elapsedMs * fps) / 1000;
```

The frame is computed from **how much wall-clock time has elapsed**, never by
incrementing a counter once per animation frame. This matters enormously:

> **The bug we're avoiding:** the naive approach is `frame++` inside `tick`. But
> `requestAnimationFrame` fires at the *display's* refresh rate — 60Hz on most
> screens, 120Hz on a ProMotion display, less under load. So `frame++` would
> play a 30fps composition at 2× speed on a 120Hz monitor, and stutter whenever
> the browser drops frames. Deriving the frame from real elapsed time makes
> playback speed depend only on `fps`, exactly as it should. (The verification
> caught this working: across two 500ms samples the counter advanced +16 then
> +15 — i.e. ~30 frames/second for a 30fps comp, independent of the refresh
> rate.)

### The baseline trick

`startTimeRef` and `startFrameRef` are captured the moment play begins. Every
tick then computes `frame = startFrame + (now - startTime) * fps / 1000`. This
means the clock is always measured *relative to where playback started*, which
makes pause/resume and seek-while-playing correct: when you resume, you set a
fresh baseline and time accumulates from there rather than from frame 0.

The effect re-runs whenever `playing` (or `fps`/`loop`/`durationInFrames`)
changes, and its cleanup `cancelAnimationFrame(raf)` guarantees only one loop is
ever live. Pausing flips `playing` to `false`, the effect cleans up, the loop
stops.

## Seeking

```tsx
const seekTo = useCallback((f: number) => {
  const clamped = clamp(Math.round(f), 0, durationInFrames - 1);
  setFrame(clamped);
  startTimeRef.current = performance.now();   // re-baseline the clock…
  startFrameRef.current = clamped;            // …so playback resumes from here
}, [durationInFrames, setFrame]);
```

`seekTo` jumps to a frame (clamped into valid range) and **re-baselines the
clock**. That last part is what makes "scrub while playing" behave: after
dragging, the baseline is reset so the next tick continues from the scrubbed
position instead of snapping back.

## Transport: scrubber and keyboard

The scrubber is a plain range input bound to `frame`:

```tsx
<input type="range" min={0} max={durationInFrames - 1} value={frame}
  onChange={(e) => { setPlaying(false); seekTo(Number(e.target.value)); }} />
```

Dragging it pauses and seeks. Keyboard shortcuts mirror video editors:

```tsx
const onKeyDown = (e) => {
  if (e.key === ' ')          { e.preventDefault(); toggle(); }      // play/pause
  else if (e.key === 'ArrowLeft')  { setPlaying(false); seekTo(frameRef.current - 1); }
  else if (e.key === 'ArrowRight') { setPlaying(false); seekTo(frameRef.current + 1); }
};
```

Note the arrows read `frameRef.current` (the live value), not the `frame` from
the render closure — another reason the ref mirror exists.

## Rendering the composition (the context handoff)

This is where the Player connects back to chapter 1:

```tsx
<VideoConfigProvider value={config}>
  <FrameProvider value={frame}>
    <Component {...((inputProps ?? {}) as P)} />
  </FrameProvider>
</VideoConfigProvider>
```

The Player wraps the user's `component` in both providers. So *this* is the
thing that "writes" the frame the whole architecture reads. `config` is
memoized so the static-metadata context doesn't churn every frame:

```tsx
const config = useMemo(() => ({width, height, fps, durationInFrames}),
  [width, height, fps, durationInFrames]);
```

## Responsive scaling

A composition is authored at a fixed size (e.g. 1280×720) but must fit whatever
container it's dropped into. The Player renders the stage at native size and
scales it with CSS:

```tsx
const [scale, setScale] = useState(1);
useLayoutEffect(() => {
  const el = containerRef.current; if (!el) return;
  const observer = new ResizeObserver(() => {
    setScale(Math.min(el.clientWidth / width, 1));   // never upscale past 1:1
  });
  observer.observe(el);
  return () => observer.disconnect();
}, [width]);
```

A `ResizeObserver` watches the container; `scale` is the ratio of available
width to native width (capped at 1 so it never blows up past full size). The
stage is then `transform: scale(scale)` with `transformOrigin: 'top left'`, and
the visible box is sized `width*scale × height*scale` so layout reserves the
right space. Authoring happens in native pixels; display adapts. (Using
`useLayoutEffect` avoids a flash of unscaled content on first paint.)

## What this is, in Framewise terms

This is a stripped-down `@framewise/player`. Real Framewise's `<Player>` adds
volume/mute, fullscreen, a richer timeline, buffering states for media, click-to-
play overlays, and an imperative ref API (`playerRef.current.seekTo(...)`). The
*core* — a wall-clock frame source that feeds the same contexts a renderer
would — is exactly what's here.

---

Next: [Chapter 6 — Demo & wiring](06-demo-and-wiring.md), where all five
primitives combine into the animation you see on screen.
