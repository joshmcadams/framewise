import type {ComponentType} from 'react';
import {HelloWorld} from '../compositions/HelloWorld';
import {AsyncImage} from '../compositions/AsyncImage';
import {WithAudio} from '../compositions/WithAudio';
import {WithVideo} from '../compositions/WithVideo';

/**
 * A composition descriptor — a component plus the metadata needed to render it.
 * This is the minimal version of Framewise's `<Composition>` registry (normally
 * declared in `Root.tsx`). The Stage 1 Player took these fields as props; the
 * renderer needs a *registry* so it can be told "render the comp with this id"
 * from the command line.
 */
export type Composition = {
  id: string;
  component: ComponentType<any>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: Record<string, unknown>;
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
