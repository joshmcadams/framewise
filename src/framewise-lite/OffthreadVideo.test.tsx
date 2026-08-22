// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ReactNode} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {getPendingDelayRenders, continueRender} from './delay-render';
import {CompositionHost} from './CompositionHost';
import {OffthreadVideo} from './OffthreadVideo';
import {PlaybackProvider} from './playback';
import {beginAudioFrame, readAudioFrame} from './audio-registry';

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

const renderAt = (frame: number, children: ReactNode) =>
  act(() =>
    root.render(
      <CompositionHost
        config={{width: 100, height: 100, fps: 30, durationInFrames: 150}}
        frame={frame}
      >
        {children}
      </CompositionHost>,
    ),
  );

const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('OffthreadVideo — render mode', () => {
  it('renders an <img> pointing at the extraction endpoint for this frame', async () => {
    await renderAt(75, <OffthreadVideo src="/clip.mp4" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(`/__framewise_extract/${b64('/clip.mp4')}/75.png?fps=30`);
  });

  it('maps composition frame + startFrom to the video-relative frame', async () => {
    await renderAt(45, <OffthreadVideo src="/clip.mp4" startFrom={30} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`/__framewise_extract/${b64('/clip.mp4')}/75.png?fps=30`);
  });

  it('blocks the capture through <Img> until the extracted PNG loads', async () => {
    await renderAt(10, <OffthreadVideo src="/clip.mp4" />);
    const pending = getPendingDelayRenders();
    expect(pending).toHaveLength(1);
    expect(pending[0].label).toContain('/__framewise_extract/');
  });

  it('reports audio exactly like <Video>; muted skips the report', async () => {
    beginAudioFrame();
    await renderAt(30, <OffthreadVideo src="/clip.mp4" volume={0.5} />);
    let reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].src).toBe('/clip.mp4');
    expect(reports[0].mediaTime).toBeCloseTo(1.0, 5);
    expect(reports[0].volume).toBeCloseTo(0.5, 5);

    beginAudioFrame();
    await renderAt(30, <OffthreadVideo src="/clip.mp4" muted />);
    reports = readAudioFrame();
    expect(reports).toHaveLength(0);
  });
});

describe('OffthreadVideo — preview mode', () => {
  it('delegates to a live <video> instead of extracting frames', async () => {
    await act(() =>
      root.render(
        <CompositionHost
          config={{width: 100, height: 100, fps: 30, durationInFrames: 150}}
          frame={75}
        >
          <PlaybackProvider value={{playing: false}}>
            <OffthreadVideo src="/clip.mp4" />
          </PlaybackProvider>
        </CompositionHost>,
      ),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).not.toBeNull();
    // Preview never registers extraction handles.
    expect(getPendingDelayRenders()).toHaveLength(0);
  });
});
