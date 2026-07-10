# Chapter 7 — The Renderer (Stage 2)

**Files:** `scripts/render.mjs`, `scripts/render-lib.mjs`, `render.html`,
`src/render/main-render.tsx`, `src/render/registry.ts`

Everything in chapters 1–6 was the _easy, elegant_ half of Framewise. This
chapter is the start of the hard half: turning the in-browser animation into an
actual `.mp4` file. The Stage 2 renderer is deliberately **naive** — it works,
and understanding exactly _where_ it would break is the whole lesson.

## The pipeline

```
   React component
        │  (served by Vite)
        ▼
   headless Chrome  ──set frame 0──▶ screenshot ─▶ frame-00000.png
   (Puppeteer)      ──set frame 1──▶ screenshot ─▶ frame-00001.png
                    ──    …      ──▶     …      ─▶      …
        │
        ▼
   ffmpeg  ─stitch PNGs at fps─▶  out/video.mp4
```

There is no magic export format. A video file is just _screenshots of the same
React app, one per frame, glued together at the right rate_. Run it with:

```bash
npm run render -- --out out/hello.mp4        # default composition
npm run render -- --comp HelloWorld --out out/hello.mp4
```

## The seam: driving frames from outside

This is where Stage 2 cashes in the Stage 1 design. The Player advances frames
with a clock. The renderer needs to advance them _manually_, deterministically,
one screenshot at a time. Because `useCurrentFrame()` is a pure context reader
(chapter 1), both are possible without the composition knowing which is in play.

`src/render/main-render.tsx` is a chrome-less page — no Player, no controls — that
exposes a hook on `window`:

```tsx
const renderFrame = (frame: number) => {
  beginAudioFrame(); // arm audio collection (ch. 9)
  flushSync(() => {
    root.render(
      // No `playback` prop: the PlaybackContext stays null, which is how
      // <Audio>/<Video> know they're rendering and must not drive the element.
      <CompositionHost config={config} frame={frame}>
        <Component {...mergedProps} />
      </CompositionHost>,
    );
  });
};

renderFrame(0);
window.framewiseLite = {
  config,
  renderFrame,
  getPending: getPendingDelayRenders, // delayRender handles (ch. 8)
  getAudioFrame: readAudioFrame, // per-frame audio reports (ch. 9)
  compositionIds: compositions.map((c) => c.id),
};
```

At Stage 2 this object held only `config` and `renderFrame`; audio collection
(ch. 9), delayRender-pending queries (ch. 8), and the composition-id list
(ch. 11/README) widened it later. The file has also adopted `CompositionHost` —
the same shared provider wrapper the Player uses (ch. 5) — making explicit that
both frame sources render through identical context plumbing. The render entry
passes **no `playback`** prop; that absence is how `<Audio>` and `<Video>` know
they're rendering (see "One wrapper, two frame sources" in chapter 5).

Where Stage 2 used `comp.defaultProps` directly, the code now builds
`mergedProps` — a shallow merge with `?props=<json>` from the URL, letting the
CLI pass per-render prop overrides (`--props '{"text": "hello"}'`).

Two things make this correct:

- **`flushSync`** forces React to commit the new frame to the DOM
  _synchronously_. A normal `setState` could be batched or deferred, and the
  renderer might screenshot a stale frame. `flushSync` guarantees "by the time
  this call returns, the DOM shows frame N."
- **`window.framewiseLite`** is the external handle. The Node script reaches into
  the page with `page.evaluate(f => window.framewiseLite.renderFrame(f))`. This is
  exactly the mechanism real Framewise uses (`window.framewise_setFrame`).

`registry.ts` is the minimal `<Composition>` registry — the renderer is told
_which_ composition to render by id (`?comp=HelloWorld`), and the page looks up
its component + metadata there. This is the piece Stage 1 didn't need (the
Player took config as props) but a renderer does.

## The Node script, and the four traps it sidesteps

`scripts/render.mjs` orchestrates everything. The happy path is short — boot
Vite, launch Chrome, loop, ffmpeg — but four details separate "works" from
"intermittently wrong," and each is handled deliberately:

**1. Layout (the most likely wrong-first-render bug).** `AbsoluteFill` is
`position:absolute; inset:0`, so it fills its nearest _positioned, sized_
ancestor. In `render.html` the body margin is zeroed (`body{margin:0}` —
otherwise the browser's default 8px shifts and clips the whole frame) and
`#render-root` is `position:relative; overflow:hidden`, sized to the composition
in JS. The script then screenshots the **element handle**, not a viewport clip:

```js
const rootHandle = await page.$('#render-root');
…
await rootHandle.screenshot({path: file});   // exactly the composition box
```

**2. Readiness handshake.** The page mounts asynchronously, so `window.framewiseLite`
isn't there the instant `goto` resolves. Reading config or rendering a frame too
early is an intermittent "undefined is not an object" that only bites on a cold
run:

```js
await page.waitForFunction(() => Boolean(window.framewiseLite?.config));
const config = await page.evaluate(() => window.framewiseLite.config);
```

**3. `try/finally` cleanup + per-run temp dir.** You run this many times while
iterating. Any throw mid-loop (or in ffmpeg) would otherwise leak a headless
Chrome process and leave the Vite port bound, poisoning the next run. Frames go
into a fresh `fs.mkdtemp` dir so stale PNGs from a previous, longer render can't
contaminate the output:

```js
const framesDir = await mkdtemp(join(tmpdir(), 'framewise-lite-'));
try { … } finally {
  if (browser) await browser.close();
  await server.close();
  await rm(framesDir, {recursive: true, force: true});
}
```

**4. The capture loop.** `deviceScaleFactor: 1` so a 1280×720 comp yields a
1280×720 PNG. After setting each frame, it waits a real paint (double
`requestAnimationFrame`) before screenshotting:

```js
for (let f = 0; f < durationInFrames; f++) {
  // [0, durationInFrames)
  await page.evaluate((frame) => {
    window.framewiseLite.renderFrame(frame);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, f);
  await rootHandle.screenshot({path: join(framesDir, `frame-${String(f).padStart(5, '0')}.png`)});
}
```

Finally ffmpeg stitches them. `yuv420p` (not the PNGs' native RGB) is what makes
the file play in QuickTime, browsers, and social platforms — a subtlety that
trips up many first renders:

```js
await run('ffmpeg', [
  '-y',
  '-framerate',
  String(fps),
  '-start_number',
  '0',
  '-i',
  join(framesDir, 'frame-%05d.png'),
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  out,
]);
```

## Beyond mp4: `--format` and `--still`

Stage 2 hardcoded that final ffmpeg invocation (libx264, mp4). The renderer has
since grown format-aware output paths — and the shape of the change is the
lesson: because the capture pipeline is format-agnostic (it only ever produces
the shared, sha256-verified PNG frames dir), "output format" is purely an
**encode-time decision**. Nothing upstream of the frames dir changes.

```bash
npm run render -- --comp HelloWorld --format webm     # VP9 + Opus
npm run render -- --comp HelloWorld --format gif      # palette GIF (drops audio)
npm run render -- --comp HelloWorld --format png-seq  # raw frames, no ffmpeg
npm run render -- --comp WithVideo  --still 75        # one frame → PNG
```

The ffmpeg command is built by `planEncode()` in `scripts/render-lib.mjs` — a
**pure function** from settings (format, crf, codec, fps, audio segments) to
`{args, dropsAudio}`, with no fs access and no spawning. That's what makes the
format matrix testable without ffmpeg installed: the unit tests assert on the
planned argument lists for mp4/webm/gif/png-seq, audio and no-audio, the same
way `planChunks` is tested without Chrome.

Per-format notes:

- **mp4 / webm** share the encode path; only codecs differ (libx264+aac vs
  libvpx-vp9+libopus, `--codec` overrides the video side). The ffmpeg preflight
  checks the _effective_ codec for the chosen format.
- **gif** uses the two-stream palette filter (`split → palettegen → paletteuse`)
  in a single pass. GIF has no audio: if the composition reported audio
  segments, the renderer warns that they're dropped (`dropsAudio`). `--crf` and
  `--codec` don't apply.
- **png-seq** skips ffmpeg entirely — `--out` is treated as a _directory_ and
  the verified frames are copied into it. The preflight is skipped too, so this
  path needs Chrome but not ffmpeg.
- **`--still <frame>`** renders exactly one frame — the chunk plan collapses to
  `[N, N+1)` — and copies the single PNG to `--out`. It's mutually exclusive
  with `--format` and `--concurrency` (there's nothing to encode and nothing to
  parallelize), and validated against the composition's frame range after the
  config probe.

When `--out` is omitted, the default output path follows the format
(`out/video.<ext>`, `out/frames/`, `out/still-<N>.png`). An explicit `--out`
whose extension contradicts the format is obeyed but warned about — the flag,
not the filename, decides the content.

## Why "Puppeteer + system Chrome"?

The script uses `puppeteer-core` (no bundled Chromium download) pointed at the
installed Google Chrome via `executablePath`. Real Framewise goes further and
ships its _own_ patched Chromium build — partly for H.264 codec support stock
headless Chrome lacks, partly so renders are reproducible across machines
regardless of the user's local browser. Managing that browser binary is a real
chunk of Framewise's surface area; we sidestep it by borrowing the system Chrome,
which is fine for learning.

## This works — and here's exactly where it stops working

The renderer produces a correct mp4 for `HelloWorld`, **verified** by extracting
frame 45 from the output and confirming it shows the _identical scene_ — title
scale, subtitle position, dot position, gradient hue — as the Stage 1 Player's
frame 45. (Not a literal bit-for-bit comparison: the Player capture is scaled
inside the page and the mp4 frame went through lossy h264/yuv420p encoding. The
match that matters is that the _same animation state_ renders under both frame
sources.) Same component, two frame sources, same result — the thesis of the
whole project.

But it only works because `HelloWorld` is **pure CSS**: gradients, system fonts,
math-driven transforms. There is nothing that loads _asynchronously_, so every
screenshot captures a fully-settled frame.

The moment a composition does this:

```tsx
<img src="/some-photo.jpg" /> // loads over the network
// or a custom @font-face that isn't ready yet
// or data fetched in a useEffect
```

…the naive renderer **screenshots too early**. `flushSync` commits the React
tree synchronously, but it can't make a network image _arrive_ synchronously.
You'd get frames with missing images, fallback fonts, or empty data — and worse,
_non-deterministically_, depending on cache and timing.

The `await page.evaluate(() => document.fonts.ready)` in the script is a _gesture_
toward fixing this — it waits for fonts once before the loop. But it's
deliberately insufficient: it does nothing for per-frame images or data. **That
gap is the entire motivation for Stage 3.**

## What Stage 3 adds (the real moat)

Framewise's answer is `delayRender()` / `continueRender()`. A composition that
loads something async calls `delayRender()` to say "don't screenshot yet," does
its loading, then calls `continueRender(handle)` when ready. The renderer waits
for _all outstanding handles_ to clear before capturing each frame. That single
mechanism — making asynchronous work block the deterministic capture — is what
turns a toy screenshotter into a real renderer. Add to that audio extraction +
muxing and frame-accurate embedded `<Video>`, and you have the hard half of
Framewise.

See the [roadmap](../../README.md#roadmap) for where this goes next.

---

← Back to the [walkthrough index](README.md)
