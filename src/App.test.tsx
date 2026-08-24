// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// jsdom never loads media metadata; mirror registry.test.ts's mock so
// MediaSized's async calculateMetadata resolves instead of hanging.
vi.mock('./render/probe-media', () => ({
  probeMediaDurationInSeconds: vi.fn(async () => 5.0),
}));

import {act} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // jsdom doesn't implement HTMLMediaElement.play/pause; the MediaSized and
  // gallery suites mount <Video> components whose useMediaSync calls both, and
  // jsdom's "Not implemented" stderr would train everyone to skim past stderr
  // (backlog #22). Re-stubbed per-test: afterEach's restoreAllMocks strips it.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return {container, root, unmount: () => act(() => root.unmount())};
}

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
    textarea.dispatchEvent(new Event('change', {bubbles: true}));
  });
  // Resolution is async since calculateMetadata may probe media (plan 040):
  // flush the resolve effect's promise so assertions see final state.
  await act(async () => {});
}

describe('<App> props editor', () => {
  it('shows the selected composition and its default props', () => {
    const {container, unmount} = mount();
    expect(container.textContent).toContain('HelloWorld');
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toContain('framewise-lite');
    unmount();
    container.remove();
  });

  it('keeps an error banner and the last good config on invalid JSON', async () => {
    const {container, unmount} = mount();
    const select = container.querySelector('select') as HTMLSelectElement;
    // Switch to Countdown (has calculateMetadata).
    await act(async () => {
      select.value = 'Countdown';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('"seconds": 5');

    await setTextareaValue(textarea, '{bad json');
    // Controlled input keeps what was typed.
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('{bad json');
    // Error banner appears (either parse error or config error styling).
    expect(container.textContent).toMatch(/Unexpected token|Expected property name/);
    unmount();
    container.remove();
  });

  it('applies valid edits and reflects dynamic duration', async () => {
    const {container, unmount} = mount();
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'Countdown';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    // Edit to seconds=2 → 60 frames.
    await setTextareaValue(textarea, '{"seconds": 2}');
    expect(container.textContent).toContain('2 seconds');
    expect(container.textContent).toContain('60 frames');
    unmount();
    container.remove();
  });

  it('resolves MediaSized through its async (media-probing) hook', async () => {
    const {container, unmount} = mount();
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'MediaSized';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    // The probe (mocked to the file's real 5 s) overrides the deliberately
    // wrong static duration of 30.
    expect(container.textContent).toContain('150 frames');
    expect(container.textContent).not.toContain('resolving…');
    unmount();
    container.remove();
  });
});

describe('<App> gallery', () => {
  it('toggles to gallery and shows a poster per composition', async () => {
    const {container, unmount} = mount();
    const galleryBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Gallery',
    )!;
    await act(async () => {
      galleryBtn.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });
    // One poster button per composition (plus the two view-toggle buttons).
    const posterButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.includes('HelloWorld') || b.textContent?.includes('Countdown'),
    );
    expect(posterButtons.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('HelloWorld');
    expect(container.textContent).toContain('Countdown');
    unmount();
    container.remove();
  });

  it('clicking a poster switches back to single and selects that composition', async () => {
    const {container, unmount} = mount();
    const galleryBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Gallery',
    )!;
    await act(async () => {
      galleryBtn.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });
    const poster = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('WithVideo'),
    )!;
    await act(async () => {
      poster.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('WithVideo');
    unmount();
    container.remove();
  });
});
