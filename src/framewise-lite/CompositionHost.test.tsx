// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ReactNode} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {getPendingDelayRenders, continueRender} from './delay-render';
import {CompositionHost} from './CompositionHost';
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {usePlayback} from './playback';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  for (const {handle} of getPendingDelayRenders()) continueRender(handle);
  act(() => root.unmount());
  container.remove();
});

const renderAt = (frame: number, playback: {playing: boolean} | undefined, children: ReactNode) =>
  act(() =>
    root.render(
      <CompositionHost
        config={{width: 100, height: 100, fps: 30, durationInFrames: 150}}
        frame={frame}
        playback={playback}
      >
        {children}
      </CompositionHost>,
    ),
  );

const FrameProbe = ({expectedFrame}: {expectedFrame: number}) => {
  const frame = useCurrentFrame();
  return <span data-testid="frame">{frame === expectedFrame ? 'OK' : 'WRONG'}</span>;
};

const ConfigProbe = ({
  expectedConfig,
}: {
  expectedConfig: {width: number; height: number; fps: number; durationInFrames: number};
}) => {
  const config = useVideoConfig();
  const match =
    config.width === expectedConfig.width &&
    config.height === expectedConfig.height &&
    config.fps === expectedConfig.fps &&
    config.durationInFrames === expectedConfig.durationInFrames;
  return <span data-testid="config">{match ? 'OK' : 'WRONG'}</span>;
};

const PlaybackProbe = ({expectsNull}: {expectsNull: boolean}) => {
  const playback = usePlayback();
  return (
    <span data-testid="playback">
      {(expectsNull && playback === null) || (!expectsNull && playback !== null) ? 'OK' : 'WRONG'}
    </span>
  );
};

describe('CompositionHost', () => {
  it('provides the frame and config to children', async () => {
    await renderAt(
      42,
      undefined,
      <>
        <FrameProbe expectedFrame={42} />
        <ConfigProbe expectedConfig={{width: 100, height: 100, fps: 30, durationInFrames: 150}} />
      </>,
    );

    expect(container.querySelector('[data-testid="frame"]')!.textContent).toBe('OK');
    expect(container.querySelector('[data-testid="config"]')!.textContent).toBe('OK');
  });

  it('returns null from usePlayback when no playback prop is given', async () => {
    await renderAt(0, undefined, <PlaybackProbe expectsNull />);
    expect(container.querySelector('[data-testid="playback"]')!.textContent).toBe('OK');
  });

  it('provides the playback value when the prop is passed', async () => {
    await renderAt(0, {playing: true}, <PlaybackProbe expectsNull={false} />);
    expect(container.querySelector('[data-testid="playback"]')!.textContent).toBe('OK');
  });
});
