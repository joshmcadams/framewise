import type {ComponentType} from 'react';
import {HelloWorld} from '../compositions/HelloWorld';
import {AsyncImage} from '../compositions/AsyncImage';
import {WithAudio} from '../compositions/WithAudio';
import {WithVideo} from '../compositions/WithVideo';
import {WithSeries} from '../compositions/WithSeries';
import {WithOffthread} from '../compositions/WithOffthread';
import {Countdown} from '../compositions/Countdown';
import {MediaSized} from '../compositions/MediaSized';
import {probeMediaDurationInSeconds} from './probe-media';
import {staticFile} from '../framewise-lite/staticFile';

/**
 * A composition descriptor — a component plus the metadata needed to render it.
 * This is the minimal version of Framewise's `<Composition>` registry (normally
 * declared in `Root.tsx`). The Stage 1 Player took these fields as props; the
 * renderer needs a *registry* so it can be told "render the comp with this id"
 * from the command line.
 */
export type CalculatedMetadata = Partial<{
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}>;

export type Composition = {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous composition props (justified any)
  component: ComponentType<any>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: Record<string, unknown>;
  /**
   * Optional hook that derives metadata overrides from the RESOLVED props
   * (defaultProps merged with inputProps). Runs once at page init — in both
   * preview and render, before first paint and before the renderer probes —
   * so dimensions/duration can adapt to inputs. Fields not returned keep
   * their static values. Throw (or reject) to reject bad inputs; the message
   * surfaces on the render page and in the preview editor.
   *
   * May return a promise — e.g. deriving durationInFrames by probing the
   * media itself (`probeMediaDurationInSeconds`). Resolution is awaited on
   * both paths; see resolveCompositionConfig.
   */
  calculateMetadata?: (args: {
    props: Record<string, unknown>;
    composition: Composition;
  }) => CalculatedMetadata | Promise<CalculatedMetadata>;
};

export const compositions: Composition[] = [
  {
    id: 'HelloWorld',
    component: HelloWorld,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 150,
    defaultProps: {
      title: 'framewise-lite',
      subtitle: 'a video is a function of frame',
    },
  },
  {
    id: 'AsyncImage',
    component: AsyncImage,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 90,
    defaultProps: {
      fetchDelayMs: 3000,
    },
  },
  {
    id: 'WithAudio',
    component: WithAudio,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 150,
    defaultProps: {},
  },
  {
    id: 'WithVideo',
    component: WithVideo,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 150,
    defaultProps: {},
  },
  {
    id: 'WithSeries',
    component: WithSeries,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 150,
    defaultProps: {},
  },
  {
    id: 'WithOffthread',
    component: WithOffthread,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 150,
    defaultProps: {},
  },
  {
    id: 'Countdown',
    component: Countdown,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 150, // default for seconds=5; calculateMetadata derives it
    defaultProps: {seconds: 5},
    calculateMetadata: ({props, composition}) => {
      const seconds = Number(props.seconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
        throw new Error(
          `Countdown "seconds" must be a whole number from 1 to 60, got ${JSON.stringify(props.seconds)}`,
        );
      }
      return {durationInFrames: Math.ceil(seconds * composition.fps)};
    },
  },
  {
    id: 'MediaSized',
    component: MediaSized,
    width: 1280,
    height: 720,
    fps: 30,
    // Deliberately WRONG (the file is 5.000 s): a correct render proves the
    // async probe below ran. See MediaSized.tsx.
    durationInFrames: 30,
    defaultProps: {src: 'clip.mp4'},
    calculateMetadata: async ({props, composition}) => ({
      durationInFrames: Math.ceil(
        (await probeMediaDurationInSeconds(staticFile(String(props.src)))) * composition.fps,
      ),
    }),
  },
];

/** Look up a composition by id, falling back to the first registered one. */
export const getComposition = (id?: string | null): Composition => {
  if (id) {
    const found = compositions.find((c) => c.id === id);
    if (!found) {
      throw new Error(
        `No composition with id "${id}". Available: ${compositions.map((c) => c.id).join(', ')}`,
      );
    }
    return found;
  }
  return compositions[0];
};

const assertPositiveInt = (field: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `calculateMetadata returned ${field}: ${JSON.stringify(value)} — must be a positive integer`,
    );
  }
  return value;
};

/**
 * Bounds a promise with a NAMED deadline: on expiry it rejects with an error
 * naming what did not settle, so the caller can surface that instead of a
 * generic timeout further up. Used for async calculateMetadata — a hook that
 * never settles must fail as "[comp]: calculateMetadata …" rather than as the
 * renderer's generic 60 s ready-wait. The 30 s value aligns with the shortest
 * layer of the delayRender ladder (see scripts/delay-render-defaults.mjs) and
 * must stay below render.mjs's ready-wait (60 s) to keep errors named.
 */
export const CALCULATE_METADATA_TIMEOUT_MS = 30_000;

export const orTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: did not settle within ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });

/**
 * Resolves a composition's final config for a given inputProps:
 * merge props → run calculateMetadata (if any, awaited — it may be async) →
 * validate → apply over the static fields. Shared by the preview app and the
 * render entry so both paths always agree. `inputProps` win over defaultProps;
 * returned metadata wins over both statics. ASYNC since plan 040: callers
 * await it (preview inside an effect with cancellation; render before first
 * paint / before publishing window.framewiseLite).
 */
export const resolveCompositionConfig = async (
  comp: Composition,
  inputProps: Record<string, unknown> = {},
): Promise<{
  config: Pick<Composition, 'width' | 'height' | 'fps' | 'durationInFrames'>;
  props: Record<string, unknown>;
}> => {
  const props = {...comp.defaultProps, ...inputProps};

  let calculated: CalculatedMetadata = {};
  if (comp.calculateMetadata) {
    calculated = (await comp.calculateMetadata({props, composition: comp})) ?? {};

    const known = ['width', 'height', 'fps', 'durationInFrames'] as const;
    for (const key of Object.keys(calculated)) {
      if (!known.includes(key as (typeof known)[number])) {
        console.warn(
          `[${comp.id}] calculateMetadata: ignoring unknown field "${key}" — supported: ${known.join(', ')}`,
        );
      }
    }
  }

  return {
    props,
    config: {
      width:
        calculated.width !== undefined ? assertPositiveInt('width', calculated.width) : comp.width,
      height:
        calculated.height !== undefined
          ? assertPositiveInt('height', calculated.height)
          : comp.height,
      fps: calculated.fps !== undefined ? assertPositiveInt('fps', calculated.fps) : comp.fps,
      durationInFrames:
        calculated.durationInFrames !== undefined
          ? assertPositiveInt('durationInFrames', calculated.durationInFrames)
          : comp.durationInFrames,
    },
  };
};
