import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {VideoConfig} from '../framewise-lite/VideoConfig';
import {CompositionHost} from '../framewise-lite/CompositionHost';
import {getPendingDelayRenders} from '../framewise-lite/delay-render';
import {beginAudioFrame, readAudioFrame} from '../framewise-lite/audio-registry';
import type {AudioReport} from '../framewise-lite/audio-registry';
import {
  getComposition,
  resolveCompositionConfig,
  compositions,
  orTimeout,
  CALCULATE_METADATA_TIMEOUT_MS,
} from './registry';

/**
 * The RENDER entry point — a deliberately chrome-less counterpart to the Player.
 *
 * Where the Player owns a clock and *pushes* frames forward, this page exposes
 * an external hook (`window.framewiseLite.renderFrame`) and lets the renderer
 * script *pull* one frame at a time: set frame N, screenshot, set frame N+1,
 * screenshot. The composition can't tell the difference — it still only calls
 * useCurrentFrame(). That indifference is the entire reason the Stage 1 hook was
 * built as a pure context reader.
 *
 * This is the exact seam real Framewise uses (it exposes `window.framewise_setFrame`).
 */

declare global {
  interface Window {
    framewiseLite?: {
      /** Undefined iff configError is set (calculateMetadata failed). */
      config?: VideoConfig;
      /** Why composition metadata could not be resolved (calculateMetadata threw). */
      configError?: string;
      renderFrame: (frame: number) => void;
      /** Outstanding delayRender handles — the renderer waits for this to empty. */
      getPending: () => {handle: number; label: string}[];
      /**
       * Resolves once every delayRender handle has cleared, or rejects with
       * the stuck handles' JSON after timeoutMs. Lets the renderer fold
       * render→wait into one CDP round trip.
       */
      waitForPendingEmpty: (timeoutMs: number) => Promise<void>;
      /** The audio active in the frame most recently rendered. */
      getAudioFrame: () => AudioReport[];
      /** All registered compositions — used by --list in render.mjs. */
      compositionIds: string[];
    };
  }
}

const params = new URLSearchParams(window.location.search);
const comp = getComposition(params.get('comp'));
const Component = comp.component;

// Optional CLI props (?props=<json>) override the composition's defaultProps.
// The renderer validates the JSON before injecting it, so parsing is a
// best-effort fallback here.
const propsParam = params.get('props');
let overrideProps: Record<string, unknown> = {};
if (propsParam) {
  try {
    overrideProps = JSON.parse(propsParam) as Record<string, unknown>;
  } catch (e) {
    console.error(`Ignoring malformed ?props= value: ${(e as Error).message}`);
    overrideProps = {};
  }
}
// Shallow merge: a nested-object prop in ?props= replaces the corresponding
// default wholesale rather than merging into it (e.g. `{settings: {b: 1}}`
// drops `settings.a` from defaultProps rather than combining the two).

const el = document.getElementById('render-root');
if (!el) {
  throw new Error('main-render: #render-root not found — is render.html the page being served?');
}

/**
 * Metadata resolution is ASYNC (calculateMetadata may probe media), so the
 * whole boot lives behind one await. Until it settles, neither `config` nor
 * `configError` is published — the renderer's ready-wait (60 s,
 * render.mjs openWorker) covers that window. Two failure shapes:
 *
 * - REJECTING hook → caught below, published as configError: fast and named,
 *   exactly the sync version's contract.
 * - HUNG hook → orTimeout's named deadline (30 s, CALCULATE_METADATA_TIMEOUT_MS)
 *   fires first, also publishing a named configError. It must sit AHEAD of the
 *   60 s generic ready-wait so the user learns "calculateMetadata did not
 *   settle", not "page never became ready" — same named-before-generic
 *   ordering contract as the delayRender ladder. The PREVIEW path adds no
 *   deadline: a hanging hook there is visible as a spinner in your own dev
 *   server; only export must fail loudly.
 */
let mergedProps: Record<string, unknown> = {};
let config: VideoConfig | undefined;
let configError: string | undefined;
try {
  const resolved = await orTimeout(
    resolveCompositionConfig(comp, overrideProps),
    CALCULATE_METADATA_TIMEOUT_MS,
    `${comp.id}: calculateMetadata`,
  );
  ({config, props: mergedProps} = resolved);
} catch (e) {
  configError = `${comp.id}: ${e instanceof Error ? e.message : String(e)}`;
  // Banner appended to (not replacing) the body — #render-root must survive.
  const banner = document.createElement('pre');
  banner.style.cssText = 'color:#f88;background:#300;padding:16px;font-size:14px';
  banner.textContent = configError;
  document.body.appendChild(banner);
}

if (config) {
  // Size the positioned containing block so AbsoluteFill resolves against it
  // (not the viewport) and the capture is exactly the composition box.
  el.style.width = `${config.width}px`;
  el.style.height = `${config.height}px`;
}

const root = createRoot(el);

const renderFrame = (frame: number) => {
  if (!config) {
    throw new Error(configError ?? `${comp.id}: metadata failed to resolve`);
  }
  // Arm audio collection BEFORE the render pass, so each <Audio>'s layout effect
  // reports into a freshly-cleared bucket for this frame.
  beginAudioFrame();
  // flushSync forces React to commit synchronously, so the DOM reflects this
  // frame *before* the renderer takes its screenshot. A plain setState could be
  // batched/deferred and we'd screenshot a stale frame.
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

// Publish the API even on metadata failure (with configError set): the
// renderer's probe then fails FAST with the named reason instead of timing out.
window.framewiseLite = {
  config,
  configError,
  renderFrame,
  getPending: getPendingDelayRenders,
  waitForPendingEmpty: (timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + timeoutMs;
      const tick = () => {
        const pending = getPendingDelayRenders();
        if (pending.length === 0) {
          resolve();
          return;
        }
        if (performance.now() > deadline) {
          reject(new Error(JSON.stringify(pending)));
          return;
        }
        setTimeout(tick, 10);
      };
      tick();
    }),
  getAudioFrame: readAudioFrame,
  compositionIds: compositions.map((c) => c.id),
};

// Render frame 0 immediately so the page isn't blank.
if (!configError) {
  renderFrame(0);
}
