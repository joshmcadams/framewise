# Chapter 6 — Demo & Wiring

**Files:** `src/compositions/HelloWorld.tsx`, `src/App.tsx`, `src/main.tsx`

The previous chapters built the library. This one shows the primitives working
together in a real composition, then traces how the app boots.

## `HelloWorld.tsx` — a composition is just a component

The demo is an ordinary React component that reads the clock and renders
accordingly. It exercises every primitive at once.

```tsx
export const HelloWorld = ({title, subtitle}: HelloWorldProps) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const scale = spring({frame, fps, config: {damping: 12, stiffness: 120}});
  const hue = interpolate(frame, [0, durationInFrames], [220, 320]);
  const titleOpacity = interpolate(
    frame,
    [0, 15, durationInFrames - 20, durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  …
};
```

Read what each line is doing, mapping back to the chapters:

| Animation | Primitive | What it does |
|---|---|---|
| `scale` | `spring` (ch. 3) | The title pops in — overshoots past full size, settles back. Starts at 0 (so the title is invisible at frame 0). |
| `hue` | `interpolate` (ch. 2) | Sweeps the background gradient from blue (220°) to magenta (320°) across the whole video. Uses the **default `extend`**, fine here since the input never leaves the range. |
| `titleOpacity` | `interpolate`, 4-keyframe (ch. 2) | Fade in over frames 0→15, hold, fade out over the last 20. Note the explicit `clamp` on both ends — without it, opacity would extrapolate to absurd values outside the range. |

These computed values are then just dropped into ordinary inline styles:

```tsx
<h1 style={{transform: `scale(${scale})`, opacity: titleOpacity, …}}>{title}</h1>
```

That's the whole animation model: **derive numbers from `frame`, put them in
styles.** No animation library, no keyframe CSS, no timeline objects — just a
function of the frame.

### Timing with `<Sequence>`

The subtitle and the looping dot are placed in time, not at frame 0:

```tsx
<Sequence from={25}>
  <Subtitle text={subtitle} />
</Sequence>

<Sequence from={40}>
  <LoopingDot />
</Sequence>
```

Inside `Subtitle`, `useCurrentFrame()` returns a frame **re-based to 0 at the
parent's frame 25** (chapter 4). So `Subtitle` is written innocently as "slide
up and fade in over my first 20 frames":

```tsx
const Subtitle = ({text}) => {
  const frame = useCurrentFrame();   // 0 when the outer timeline is at 25
  const y = interpolate(frame, [0, 20], [40, 0], {extrapolateRight: 'clamp'});
  const opacity = interpolate(frame, [0, 20], [0, 1], {extrapolateRight: 'clamp'});
  …
};
```

It has no idea it starts at frame 25 on the real timeline — that's the
`Sequence` doing its job.

### A re-triggering spring (a nice trick)

`LoopingDot` shows springs composing with arithmetic:

```tsx
const LoopingDot = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const bounce = spring({frame: frame % fps, fps, config: {damping: 8}});
  const x = interpolate(bounce, [0, 1], [-120, 120]);
  …
};
```

Feeding `frame % fps` into the spring **restarts it every second** (every `fps`
frames the input resets to 0), so the dot springs left-to-right once per second
forever. Then `interpolate` maps the spring's `0→1` output onto a `-120→120`
pixel range. This is the two math primitives composing: spring for the *feel*,
interpolate for the *range*.

## `App.tsx` — embedding the Player

This is the host page — the equivalent of dropping `@framewise/player` into your
own React site:

```tsx
export default function App() {
  return (
    <div style={{maxWidth: 960, margin: '0 auto', padding: 24}}>
      <h2>framewise-lite</h2>
      <p>…instructions…</p>
      <Player
        component={HelloWorld}
        inputProps={{title: 'framewise-lite', subtitle: 'a video is a function of frame'}}
        width={1280}
        height={720}
        fps={30}
        durationInFrames={150}
        loop
      />
    </div>
  );
}
```

The `Player` is handed the composition (`HelloWorld`), its props, and the video
metadata (`1280×720`, `30fps`, `150` frames = 5 seconds). Because `inputProps`
is type-checked against `HelloWorldProps`, getting the shape wrong is a compile
error. In full Framewise you'd *also* register this in a `Root.tsx` via
`<Composition>` so the Studio and the server renderer could discover it; here
the Player is the only consumer, so that registry isn't needed yet.

## `main.tsx` — the entry point

Standard React 18 bootstrap, nothing Framewise-specific:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`StrictMode` double-invokes effects in development, which is a useful stress
test for the Player's `requestAnimationFrame` setup/cleanup — if the clock
leaked a loop, Strict Mode would surface it.

## End-to-end data flow (the whole picture)

Putting all six chapters together, here's one frame's journey:

```
main.tsx renders <App>
  └─ App renders <Player component={HelloWorld} fps={30} durationInFrames={150} …>
       └─ Player's rAF clock: elapsed 500ms → frame = floor(500*30/1000) = 15
            └─ <VideoConfigProvider value={{fps:30,…}}>
                 └─ <FrameProvider value={15}>
                      └─ <HelloWorld>
                           ├─ useCurrentFrame() → 15
                           ├─ spring({frame:15,…}) → 1.08  → transform: scale(1.08)
                           ├─ interpolate(15,[0,150],[220,320]) → 230 → hsl(230 …)
                           └─ <Sequence from={25}>  // 15 < 25 → shifted=-10 → null
                                (subtitle not yet on screen at frame 15)
```

Advance the clock, the `FrameProvider` value changes, every consumer re-renders,
the pixels update. That loop, 30 times a second, is the video.

---

← Back to the [walkthrough index](README.md) · See the
[top-level README](../../README.md) for the Framewise mapping table and the
roadmap toward a renderer.
