# Getting started: build a promo video, step by step

This is the author-facing tutorial: how to _make videos_ with framewise-lite.
For how the machinery works inside, read the [11-chapter code
walkthrough](code/README.md); for repo orientation and workflows,
[OVERVIEW](OVERVIEW.md).

You'll build one small project — a three-scene product promo — and each step
introduces exactly one feature. By the end you'll have used: `useCurrentFrame`,
`interpolate` (+ `Easing`), `spring`, `random`, `<Sequence>` / `<Series>` /
`<Loop>`, `staticFile` + `<Img>` / `<Video>` / `<Audio>` (with volume
automation), props with dynamic metadata, and the render CLI.

Everything here runs against the repo as installed:

```bash
npm install
npm run dev     # preview at http://localhost:5173 (Space = play/pause, ←/→ = step)
```

## The one idea

**A video is a pure function of the frame number.** Your composition is an
ordinary React component that asks "what frame are we on?" via
`useCurrentFrame()` and renders accordingly. There is no timeline API to push
to, no tween objects — frame 42 always renders identically, in the browser
preview and in the exporter. Everything below follows from that.

## Step 0 — register a composition

A composition = a component + its declared box. Add an entry to the registry in
`src/render/registry.ts`; both the preview app and the renderer discover it
there.

```tsx
// src/compositions/Promo.tsx
import {AbsoluteFill, useCurrentFrame} from '../framewise-lite';

export const Promo = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#101828', color: 'white'}}>
      <h1>frame {frame}</h1>
    </AbsoluteFill>
  );
};
```

```ts
// src/render/registry.ts — add to the compositions array
{
  id: 'Promo',
  component: Promo,
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 150, // 5 seconds at 30fps
  defaultProps: {},
},
```

Run `npm run dev`, pick **Promo** from the dropdown, press Space. You should see
a counter ticking 0…149, then looping. That's the whole engine: the `<Player>`
is advancing a number; your component is a function of it.

## Step 1 — animate with `interpolate`

`interpolate(input, inputRange, outputRange, options?)` maps the frame onto a
value. Fade the title in over the first second (frames 0–30):

```tsx
import {AbsoluteFill, interpolate, useCurrentFrame} from '../framewise-lite';

export const Promo = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const titleY = interpolate(frame, [10, 40], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{background: '#101828', justifyContent: 'center', alignItems: 'center'}}>
      <h1 style={{opacity, transform: `translateY(${titleY}px)`, color: 'white', fontSize: 72}}>
        framewise-lite
      </h1>
    </AbsoluteFill>
  );
};
```

Two things worth internalizing:

- **Extrapolation defaults to `'extend'`**, not clamp — values keep moving
  linearly past your range. That's deliberate (it makes overshoot effects
  natural), but when you mean "stop at the ends", say so:
  `{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}`.
- The **easing option** takes any `(t) => t` function; `Easing` ships
  `quad/cubic/sin/back/bounce/elastic/bezier(...)` and friends. `Easing.out`
  wraps an ease for deceleration.

## Step 2 — physics with `spring`

`interpolate` gives you keyframes; `spring` gives you motion that settles like
a mass on a spring. Pop a badge in after the title:

```tsx
import {spring} from '../framewise-lite';

// inside Promo's JSX, after the <h1>:
const pop = spring({frame: frame - 25, fps}); // starts at frame 25
// ...
<div
  style={{
    marginTop: 24,
    padding: '10px 26px',
    borderRadius: 999,
    background: '#7f5af0',
    transform: `scale(${pop})`,
  }}
>
  a video is a function of frame
</div>;
```

Notes:

- `frame - 25` is the idiomatic delay: before frame 25 the spring sees negative
  time and sits at its start value.
- It's underdamped by default, so it **overshoots** past scale 1 and settles.
  `{config: {damping: 12}}` calms it; `{config: {overshootClamping: true}}`
  forbids overshoot entirely. `from`/`to` remap the normalized curve (e.g.
  `from: 0, to: 100`).
- Need a spring to land exactly N frames in? Pass `durationInFrames: N` (it
  time-warps internally via `measureSpring`). `reverse: true` plays it backward.

## Step 3 — deterministic randomness with `random()`

Want variety? Seed it. `random(seed)` returns the same value in the preview,
every parallel render worker, and every re-render — which is what keeps output
byte-identical. **Never call `Math.random()` in a composition**: it would break
that guarantee silently. Scatter some stars behind everything:

```tsx
import {random} from '../framewise-lite';

const STARS = Array.from({length: 40}, (_, i) => ({
  x: random(`star-${i}-x`) * 100, // percent
  y: random(`star-${i}-y`) * 100,
  r: 2 + random(`star-${i}-r`) * 4,
  phase: Math.floor(random(`star-${i}-p`) * 30), // stagger twinkle start
}));

// inside AbsoluteFill, before the text:
{
  STARS.map((s, i) => (
    <div
      key={i}
      style={{
        position: 'absolute',
        left: `${s.x}%`,
        top: `${s.y}%`,
        width: s.r,
        height: s.r,
        borderRadius: '50%',
        background: 'white',
        opacity: interpolate(frame - s.phase, [0, 15, 30], [0.2, 1, 0.2]),
      }}
    />
  ));
}
```

String seeds are hashed (FNV-1a → mulberry32), so `"star-3-x"` is stable
forever. Seeds don't need to be unique across shapes — but distinct seeds per
property is how you avoid correlated values.

## Step 4 — scenes and timing: `<Sequence>`, `<Series>`, `<Loop>`

A composition gets busy fast if everything animates off the global frame.
`<Sequence>` carves out a window of the timeline and — crucially — **re-bases
the frame for its children**: inside a sequence starting at frame 90,
`useCurrentFrame()` returns 0 at composition frame 90. You author each scene as
if it were its own video.

Restructure the promo into scenes with `<Series>`, which stacks sequences back
to-back (plus optional gaps):

```tsx
import {Series, Sequence, Loop, useCurrentFrame, interpolate} from '../framewise-lite';

const TitleScene = () => {
  const frame = useCurrentFrame(); // LOCAL to this scene — 0 on entry
  /* …steps 1–3 content… */
};

const FeatureScene = ({emoji, label}: {emoji: string; label: string}) => (
  <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 20}}>
    <div style={{fontSize: 120}}>{emoji}</div>
    <div style={{fontSize: 48, color: 'white'}}>{label}</div>
  </AbsoluteFill>
);

export const Promo = () => (
  <AbsoluteFill style={{background: '#101828'}}>
    <Series>
      <Series.Sequence durationInFrames={75}>
        <TitleScene />
      </Series.Sequence>
      <Series.Sequence durationInFrames={45}>
        <FeatureScene emoji="🎬" label="frame-as-state" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={45}>
        <FeatureScene emoji="⚡" label="parallel rendering" />
      </Series.Sequence>
    </Series>

    {/* a persistent element on the GLOBAL timeline, pulsing forever */}
    <Loop durationInFrames={30} layout="none">
      <Pulse />
    </Loop>
  </AbsoluteFill>
);

const Pulse = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        right: 40,
        bottom: 40,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#2cb67d',
        opacity: interpolate(frame, [0, 15, 30], [0.3, 1, 0.3]),
      }}
    />
  );
};
```

- `<Sequence from={90} durationInFrames={45}>` places a window manually;
  `<Series>` computes those offsets for you (`spacing={n}` inserts gaps).
- `<Loop durationInFrames={30}>` repeats its children every 30 frames — the
  child's local frame resets each cycle. `times={3}` bounds the repetitions.
- Bump `durationInFrames` on the **registry entry** to fit the new length:
  75 + 45 + 45 = 165 frames.

## Step 5 — media: `staticFile`, `<Img>`, `<Video>`, `<Audio>`

Assets live in `public/`. Always wrap paths with `staticFile()` — it produces
the root-relative URL that works identically in dev and in the exported page.

```tsx
import {Img, Video, Audio, staticFile, interpolate} from '../framewise-lite';

// An image that fades in (same interpolate trick as step 1):
<Img src={staticFile('photo.png')}
     style={{position: 'absolute', inset: 0, objectFit: 'cover',
             opacity: interpolate(frame, [0, 20], [0, 1], {extrapolateRight: 'clamp'})}} />

// Embedded video, entered 2 seconds into the SOURCE clip (frame-accurate seek):
<Video src={staticFile('clip.mp4')} startFrom={60} style={{position: 'absolute', inset: 0}} />

// A soundtrack that fades out at the end of the comp — volume can be a
// FUNCTION OF THE FRAME, and interpolate takes multi-point ranges, so an
// envelope is one call:
<Audio
  src={staticFile('bg.wav')}
  volume={(f) =>
    interpolate(f, [0, 15, 135, 150], [0, 0.6, 0.6, 0], {
      extrapolateRight: 'clamp',
    })
  }
/>
```

The volume function receives the sequence-local frame and runs per-frame in the
renderer's audio mix, so automating gain costs nothing extra — no keyframe
format, just code. (`<Audio>` also takes `startFrom` to skip into a track.)
For pixel-exact extraction of video frames instead of live seeking, there's
`<OffthreadVideo>` — same props, different engine; see chapter 10.

## Step 6 — props & dynamic metadata

Hard-coding is for tutorials. Give the composition inputs via `defaultProps`,
and derive **metadata from props** with `calculateMetadata`:

```tsx
// registry entry:
{
  id: 'Promo',
  component: Promo,
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 150,
  defaultProps: {title: 'framewise-lite', seconds: 5},
  calculateMetadata: ({props, composition}) => {
    const seconds = Number(props.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
      throw new Error(`seconds must be a whole number 1–60`);
    }
    return {durationInFrames: Math.ceil(seconds * composition.fps)};
  },
},
```

```tsx
// the component becomes:
export const Promo = ({title}: {title: string}) => {
  /* …read title instead of the hard-coded string… */
};
```

Now the CLI (and the preview's props box) can drive it:

```bash
npm run render -- --comp Promo --props '{"title":"Hi mom","seconds":3}' --out out/promo.mp4
```

Bad props throw a named error immediately — the hook runs once at page init,
before anything renders. `calculateMetadata` may also be **async** (e.g. size
the comp to a media file's real duration — see the `MediaSized` demo and ch. 6).

### Async assets inside a composition: `delayRender`

If your component fetches data (as opposed to media files, which handle their
own readiness), wrap the promise so the renderer knows to wait:

```tsx
const handle = delayRender('loading captions');
fetch(url).then((captions) => {
  setCaptions(captions);
  continueRender(handle);
});
```

Rendering blocks until every handle clears (or a labeled timeout names the
stuck one). The `AsyncImage` demo shows the pattern; chapter 8 explains it.

## Step 7 — export it

```bash
npm run render -- --list                              # discoverable comp ids
npm run render -- --comp Promo --out out/promo.mp4    # h264 + AAC in an mp4

# formats & stills
npm run render -- --comp Promo --format webm   --out out/promo.webm
npm run render -- --comp Promo --format gif    --out out/promo.gif   # drops audio
npm run render -- --comp Promo --still 45 --out out/frame45.png # one frame

# parametrize + tune encode
npm run render -- --comp Promo --props '{"seconds":3}' --crf 24 --codec libx265 --out out/promo-small.mp4

# speed: parallel browsers (identical bytes, ~2.6x faster at 4x)
npm run render -- --comp Promo --concurrency 4 --out out/promo.mp4

# distributed chunk-encode+concat for long comps / many machines
npm run render -- --comp Promo --concurrency 4 --distributed --out out/promo.mp4
```

Determinism you can check: rendering the same composition twice — or at any
concurrency, or distributed — yields a byte-identical frame set (the renderer
verifies this with a sha256 hash over all frames). That only holds because
compositions are pure functions of the frame number; if you ever reach for
`Math.random()` or wall-clock time in a composition, this is the guarantee you
break.

Requires system **ffmpeg** plus Chrome (auto-found, or point
`--chrome`/`CHROME_PATH` at one).

## Where to go next

| Want to…                       | Read                                                |
| ------------------------------ | --------------------------------------------------- |
| Understand the frame engine    | [ch. 1 — the frame engine](code/01-frame-engine.md) |
| All interpolation modes        | [ch. 2](code/02-interpolate.md)                     |
| Spring internals & measurement | [ch. 3](code/03-spring.md)                          |
| Sequences, Series, Loop        | [ch. 4](code/04-sequence.md)                        |
| The Player & preview clock     | [ch. 5](code/05-player.md)                          |
| How demos wire up              | [ch. 6](code/06-demo-and-wiring.md)                 |
| The renderer CLI end-to-end    | [ch. 7](code/07-renderer.md)                        |
| `delayRender` deeply           | [ch. 8](code/08-delay-render.md)                    |
| Audio mixing                   | [ch. 9](code/09-audio.md)                           |
| Embedded/offthread video       | [ch. 10](code/10-video.md)                          |

Working demos of every feature live in `src/compositions/` (`HelloWorld`,
`AsyncImage`, `WithAudio`, `WithVideo`, `WithSeries`, `WithOffthread`,
`Countdown`, `MediaSized`) — registered in `src/render/registry.ts`, rendered
with `npm run render -- --comp <id>`.
