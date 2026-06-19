import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {type VideoConfig} from '../framewise-lite/VideoConfig';
import {CompositionHost} from '../framewise-lite/CompositionHost';
import {getPendingDelayRenders} from '../framewise-lite/delay-render';
import {beginAudioFrame, readAudioFrame} from '../framewise-lite/audio-registry';
import type {AudioReport} from '../framewise-lite/audio-registry';
import {getComposition, compositions} from './registry';

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
      config: VideoConfig;
      renderFrame: (frame: number) => void;
      /** Outstanding delayRender handles — the renderer waits for this to empty. */
      getPending: () => {handle: number; label: string}[];
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
  } catch {
    overrideProps = {};
  }
}
const mergedProps = {...comp.defaultProps, ...overrideProps};

const config: VideoConfig = {
  width: comp.width,
  height: comp.height,
  fps: comp.fps,
  durationInFrames: comp.durationInFrames,
};

const el = document.getElementById('render-root')!;
// Size the positioned containing block so AbsoluteFill resolves against it
// (not the viewport) and the capture is exactly the composition box.
el.style.width = `${config.width}px`;
el.style.height = `${config.height}px`;

const root = createRoot(el);

const renderFrame = (frame: number) => {
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

// Render frame 0 immediately so the page isn't blank, then publish the API.
renderFrame(0);
window.framewiseLite = {
  config,
  renderFrame,
  getPending: getPendingDelayRenders,
  getAudioFrame: readAudioFrame,
  compositionIds: compositions.map((c) => c.id),
};
