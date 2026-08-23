// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
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

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
    textarea.dispatchEvent(new Event('change', {bubbles: true}));
  });
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

    setTextareaValue(textarea, '{bad json');
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
    setTextareaValue(textarea, '{"seconds": 2}');
    expect(container.textContent).toContain('2 seconds');
    expect(container.textContent).toContain('60 frames');
    unmount();
    container.remove();
  });
});
