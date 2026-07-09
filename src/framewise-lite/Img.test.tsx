// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ReactNode} from 'react';
import {StrictMode, act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {getPendingDelayRenders, continueRender} from './delay-render';
import {CompositionHost} from './CompositionHost';
import {Img} from './Img';

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

describe('Img', () => {
  it('registers a pending handle with the src label on mount', async () => {
    await renderAt(0, <Img src="/photo.png" />);
    const pending = getPendingDelayRenders();
    expect(pending).toHaveLength(1);
    expect(pending[0].label).toContain('/photo.png');
  });

  it('clears the pending handle on image load', async () => {
    await renderAt(0, <Img src="/photo.png" />);
    expect(getPendingDelayRenders()).toHaveLength(1);

    const img = container.querySelector('img')!;
    await act(() => img.dispatchEvent(new Event('load')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('clears the pending handle on image error', async () => {
    await renderAt(0, <Img src="/photo.png" />);
    expect(getPendingDelayRenders()).toHaveLength(1);

    const img = container.querySelector('img')!;
    await act(() => img.dispatchEvent(new Event('error')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('clears the pending handle on unmount', async () => {
    await renderAt(0, <Img src="/photo.png" />);
    expect(getPendingDelayRenders()).toHaveLength(1);

    await act(() => root.unmount());
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('does not orphan a handle under StrictMode double-mount', async () => {
    act(() =>
      root.render(
        <StrictMode>
          <CompositionHost
            config={{width: 100, height: 100, fps: 30, durationInFrames: 150}}
            frame={0}
          >
            <Img src="/photo.png" />
          </CompositionHost>
        </StrictMode>,
      ),
    );

    expect(getPendingDelayRenders()).toHaveLength(1);

    const img = container.querySelector('img')!;
    await act(() => img.dispatchEvent(new Event('load')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });
});
