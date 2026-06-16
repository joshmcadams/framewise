# Chapter 8 — delayRender (Stage 3)

**Files:** `src/framewise-lite/delay-render.ts`, `src/framewise-lite/Img.tsx`,
`src/compositions/AsyncImage.tsx`, changes to `scripts/render.mjs`,
`src/render/main-render.tsx`, `src/framewise-lite/Player.tsx`, `src/App.tsx`

[Chapter 7](07-renderer.md) ended with the naive renderer's fatal flaw: it
screenshots *immediately*, so any frame that depends on something loading
asynchronously (an image, a font, fetched data) gets captured too early. Stage 3
fixes that with the single mechanism that does it: `delayRender` /
`continueRender`.

## The idea

A composition that needs to load something says: **"don't capture this frame
yet."** It calls `delayRender()` to register a *handle*, does its async work,
then calls `continueRender(handle)` when ready. The renderer waits until **every
outstanding handle is cleared** before screenshotting each frame.

That's the whole concept. It turns "capture and hope it's loaded" into "capture
only when the frame is provably settled." It is the difference between a toy and
a renderer.

## The registry (`delay-render.ts`)

The core is a module-level set of pending handles:

```ts
const pending = new Map<DelayRenderHandle, {label: string; timeout: …}>();

export function delayRender(label = 'delayRender()', options?) {
  const handle = nextHandle++;
  const timeout = setTimeout(() => {
    console.error(`delayRender(): handle ${handle} ("${label}") was not cleared…`);
  }, options?.timeoutInMilliseconds ?? 30_000);
  pending.set(handle, {label, timeout});
  notify();
  return handle;
}

export function continueRender(handle) {
  const entry = pending.get(handle);
  if (!entry) return;            // idempotent
  clearTimeout(entry.timeout);
  pending.delete(handle);
  notify();
}
```

Two details worth noting:

- **The timeout.** A forgotten `continueRender()` would otherwise hang the render
  forever. Each handle self-destructs after 30s (Framewise's default) with a loud
  error naming the label — so "my render is stuck" becomes "handle X (`<Img>
  /photo.png`) never cleared." The renderer's own `waitForFunction` timeout is
  the hard backstop.
- **`notify()` / `subscribeToDelayRenders`.** A listener set lets the Player show
  a live "pending" badge. `useDelayRenderPending()` wraps it in
  `useSyncExternalStore` so React components can read the count reactively.

`getPendingDelayRenders()` returns the outstanding labels — this is what the
renderer reads each frame.

## The canonical use: `<Img>`

`Img.tsx` is a drop-in `<img>` that blocks until the image actually loads:

```tsx
export const Img = ({src, ...rest}) => {
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) return; // cached, no delay

    const handle = delayRender(`<Img> ${src}`);
    const done = () => continueRender(handle);
    img?.addEventListener('load', done);
    img?.addEventListener('error', done);
    return () => {
      img?.removeEventListener('load', done);
      img?.removeEventListener('error', done);
      continueRender(handle);
    };
  }, [src]);
  return <img ref={ref} src={src} {...rest} />;
};
```

Three non-obvious choices, each load-bearing:

1. **`useLayoutEffect`, not `useEffect`.** The renderer checks for pending
   handles right after a synchronous `flushSync` render (chapter 7). `flushSync`
   runs *layout* effects synchronously but defers *passive* (`useEffect`)
   effects — a `useEffect` handle would register *after* the capture, defeating
   the point. And it can't be a `useState(() => delayRender())` initializer
   either: that double-fires under StrictMode and orphans a handle (which the
   Player's new badge would surface as a permanently stuck "1 pending").
2. **Imperative `addEventListener`, not React `onLoad`.** A React `onLoad`
   handler closes over state that may not have committed when the image fires —
   a race. Attaching the listener in the same effect that creates the handle is
   race-free.
3. **The `complete` check.** A cached image may already be decoded by the time
   the effect runs; delaying for a load event that already fired would hang. If
   it's already complete, no handle is created at all.

The cleanup (`return () => continueRender(handle)`) is what makes StrictMode's
mount/unmount/mount net out to a single cleared handle.

## The deterministic discriminator: `SlowData`

`<Img>` is the *real* use, but it's a bad *demo* — a local image often loads
within the renderer's paint-wait, so you can't reliably see the bug. So
`AsyncImage.tsx` also includes `SlowData`, a simulated fetch with a controllable
delay:

```tsx
const SlowData = ({fetchDelayMs}) => {
  const [headline, setHeadline] = useState<string | null>(null);
  useLayoutEffect(() => {
    const handle = delayRender('SlowData fetch');
    const timer = setTimeout(() => {
      // CRITICAL: commit the DOM synchronously BEFORE clearing the handle.
      flushSync(() => setHeadline('Fetched headline ✨'));
      continueRender(handle);
    }, fetchDelayMs);
    return () => { clearTimeout(timer); continueRender(handle); };
  }, [fetchDelayMs]);
  return <h1>{headline ?? 'Loading…'}</h1>;
};
```

**The `flushSync` is the subtlest correctness point in all of Stage 3.** Without
it, `setHeadline` commits *asynchronously* — so `continueRender` on the next line
clears the handle while the DOM still says "Loading…", and the renderer
screenshots the stale frame even in wait mode. `flushSync` forces the commit
first, so "pending === 0" genuinely implies "the DOM is final." (`<Img>` doesn't
need this: the browser paints the decoded `<img>` itself, and the renderer's
post-pending paint-wait covers it.)

The delay defaults to **3000ms** — deliberately longer than the renderer's
cold-start latency (Vite boot + Chrome launch + page load). If it were shorter,
the timer might fire *during* renderer setup, and even the `--no-wait` render
would capture the resolved state — the experiment would falsely report "nothing
broke."

## Wiring the renderer

The render loop gains one step, in a specific position:

```js
for (let f = 0; f < durationInFrames; f++) {
  await page.evaluate((frame) => window.framewiseLite.renderFrame(frame), f);  // 1. commit frame

  if (!noWait) {                                                              // 2. WAIT
    await page.waitForFunction(() => window.framewiseLite.getPending().length === 0,
      {timeout: 30_000}).catch(/* report stuck labels */);
  }

  await page.evaluate(() => new Promise(r =>                                  // 3. paint
    requestAnimationFrame(() => requestAnimationFrame(r))));

  const pendingAtCapture = await page.evaluate(() =>                          // evidence
    window.framewiseLite.getPending().map(p => p.label));
  await rootHandle.screenshot({path: file});                                  // 4. capture
}
```

The order matters: **wait for handles (step 2) before the paint-wait (step 3)**,
not after. Blocking on async work is what makes the capture deterministic; if you
paint-waited first you'd just wait while still loading. The render entry exposes
`window.framewiseLite.getPending()` so the Node script can poll it.

## Proving it works: the controlled experiment

The `--no-wait` flag skips step 2 — reproducing the Stage 2 behaviour on purpose
— so you can render the same composition broken and fixed:

```bash
npm run render -- --comp AsyncImage --no-wait --out out/async-broken.mp4
npm run render -- --comp AsyncImage           --out out/async-fixed.mp4
```

The result, verified:

| | `--no-wait` (broken) | wait (fixed) |
|---|---|---|
| **frame 0 shows** | `Loading…` | `Fetched headline ✨` |
| **pending-at-capture log** | `[SlowData fetch]` on frames 0–~17 | `[]` everywhere |

The pending-at-capture log is the *timing-robust* evidence: it directly shows the
broken renderer screenshotting while `SlowData fetch` is still outstanding, and
the fixed renderer never doing so — regardless of paint timing. (Verified
separately that `HelloWorld`, which has no async work, renders the same scene
under the new renderer with **pending always 0** — so the new wait is a pure
no-op for synchronous compositions.)

## An honest caveat: why only frame 0 differs

In this clone the renderer reuses **one** page for the whole render, so an asset
loads **once** and stays loaded — only the early frames (before it resolved)
differ between broken and fixed. Real Framewise renders chunks in **fresh browser
contexts** (for parallelism), so *every* chunk's first frame must wait for its
assets independently. Same mechanism, bigger blast radius. The lesson — async work
must gate the capture — is identical; our single-page setup just concentrates the
visible damage at the start.

## Preview parity

The Player now reflects handles too: `useDelayRenderPending()` drives a
"● delayRender · N pending" badge, so previewing `AsyncImage` shows the badge for
~3s, then it clears as the data arrives — the same mechanism the renderer waits
on, made visible. `App.tsx` also became a registry-driven dropdown, so the
preview and the renderer now share one composition registry (`src/render/registry.ts`).

## What's still missing (the rest of the hard half)

`delayRender` is the keystone, but a production renderer also needs:

- **Audio** — extracted, mixed, and muxed separately (it isn't screenshotted).
- **Frame-accurate embedded `<Video>`** — decoding an external mp4 to the exact
  timestamp per frame, not relying on a flaky `<video>` seek.
- **Parallelism** — multiple tabs/workers, chunked frame ranges, concatenation.

Those are the next stages. See the [roadmap](../../README.md#roadmap).

---

← Back to the [walkthrough index](README.md)
