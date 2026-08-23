import type {ComponentType} from 'react';
import {HelloWorld} from '../compositions/HelloWorld';
import {AsyncImage} from '../compositions/AsyncImage';
import {WithAudio} from '../compositions/WithAudio';
import {WithVideo} from '../compositions/WithVideo';
import {WithSeries} from '../compositions/WithSeries';
import {WithOffthread} from '../compositions/WithOffthread';
import {Countdown} from '../compositions/Countdown';

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
   * their static values. Throw to reject bad inputs; the message surfaces
   * on the render page.
   */
  calculateMetadata?: (args: {
    props: Record<string, unknown>;
    composition: Composition;
  }) => CalculatedMetadata;
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
 * Resolves a composition's final config for a given inputProps:
 * merge props → run calculateMetadata (if any) → validate → apply over the
 * static fields. Shared by the preview app and the render entry so both paths
 * always agree. `inputProps` win over defaultProps; returned metadata wins
 * over both statics.
 */
export const resolveCompositionConfig = (
  comp: Composition,
  inputProps: Record<string, unknown> = {},
): {
  config: Pick<Composition, 'width' | 'height' | 'fps' | 'durationInFrames'>;
  props: Record<string, unknown>;
} => {
  const props = {...comp.defaultProps, ...inputProps};

  let calculated: CalculatedMetadata = {};
  if (comp.calculateMetadata) {
    calculated = comp.calculateMetadata({props, composition: comp}) ?? {};

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
