import {describe, expect, it, vi} from 'vitest';

// jsdom never loads media metadata, so a REAL probe would hang forever here.
// Mock the primitive; the real-file path is proven by rendering MediaSized
// end-to-end (plan 040 acceptance).
vi.mock('./probe-media', () => ({
  probeMediaDurationInSeconds: vi.fn(async (src: string) => {
    if (!src.endsWith('clip.mp4')) {
      throw new Error(`probeMediaDurationInSeconds("${src}"): could not load media`);
    }
    return 5.0; // public/clip.mp4's actual duration
  }),
}));

import {
  compositions,
  getComposition,
  resolveCompositionConfig,
  orTimeout,
  CALCULATE_METADATA_TIMEOUT_MS,
  type Composition,
} from './registry';

const staticComp = compositions.find((c) => c.id === 'HelloWorld')!;
const countdown = compositions.find((c) => c.id === 'Countdown')!;
const mediaSized = compositions.find((c) => c.id === 'MediaSized')!;

const asComp = (partial: Partial<Composition>): Composition => ({
  ...staticComp,
  defaultProps: {},
  calculateMetadata: undefined,
  ...partial,
});

describe('getComposition', () => {
  it('finds by id and falls back to the first', () => {
    expect(getComposition('Countdown').id).toBe('Countdown');
    expect(getComposition(undefined).id).toBe(compositions[0].id);
    expect(() => getComposition('Nope')).toThrow(/No composition with id/);
  });
});

describe('resolveCompositionConfig — static entries', () => {
  it('returns the declared fields unchanged (byte-identical path)', async () => {
    const {config, props} = await resolveCompositionConfig(staticComp);
    expect(config).toEqual({
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 150,
    });
    expect(props).toEqual({...staticComp.defaultProps});
  });

  it('merges inputProps over defaultProps (shallow)', async () => {
    const {props} = await resolveCompositionConfig(asComp({defaultProps: {a: 1, nested: {x: 1}}}), {
      nested: {y: 2},
      b: 2,
    });
    expect(props).toEqual({a: 1, nested: {y: 2}, b: 2});
  });
});

describe('resolveCompositionConfig — calculateMetadata', () => {
  it('applies returned overrides over the static fields', async () => {
    const comp = asComp({
      calculateMetadata: () => ({durationInFrames: 90, fps: 60}),
    });
    const {config} = await resolveCompositionConfig(comp);
    expect(config.durationInFrames).toBe(90);
    expect(config.fps).toBe(60);
    expect(config.width).toBe(1280); // untouched
  });

  it('awaits an ASYNC hook (plan 040 — the whole point)', async () => {
    const comp = asComp({
      calculateMetadata: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return {durationInFrames: 45};
      },
    });
    const {config} = await resolveCompositionConfig(comp);
    expect(config.durationInFrames).toBe(45);
  });

  it('propagates a REJECTING async hook with its message', async () => {
    const comp = asComp({
      calculateMetadata: async () => {
        throw new Error('clip.mp4: no such media');
      },
    });
    await expect(resolveCompositionConfig(comp)).rejects.toThrow('clip.mp4: no such media');
  });

  it('passes merged props to the hook', async () => {
    const hook = vi.fn(() => ({}));
    const comp = asComp({
      defaultProps: {size: 'big'},
      calculateMetadata: hook,
    });
    await resolveCompositionConfig(comp, {label: 'hi'});
    expect(hook).toHaveBeenCalledWith({props: {size: 'big', label: 'hi'}, composition: comp});
  });

  it('derives the Countdown duration from props.seconds', async () => {
    expect((await resolveCompositionConfig(countdown)).config.durationInFrames).toBe(150); // 5 s
    expect((await resolveCompositionConfig(countdown, {seconds: 3})).config.durationInFrames).toBe(
      90,
    );
    expect((await resolveCompositionConfig(countdown, {seconds: 1})).config.durationInFrames).toBe(
      30,
    );
  });

  it('rejects out-of-range Countdown seconds with a clear message', async () => {
    for (const bad of [0, -5, 61, 2.5]) {
      await expect(resolveCompositionConfig(countdown, {seconds: bad})).rejects.toThrow(
        /whole number from 1 to 60/,
      );
    }
  });

  it('throws on invalid calculated values', async () => {
    for (const [field, value] of [
      ['width', 0],
      ['height', -100],
      ['fps', 29.97],
      ['durationInFrames', 'many' as unknown as number],
    ] as const) {
      const comp = asComp({calculateMetadata: () => ({[field]: value})});
      await expect(resolveCompositionConfig(comp)).rejects.toThrow(String(field));
    }
  });

  it('warns on and ignores unknown returned fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const comp = asComp({calculateMetadata: () => ({codec: 'prores'}) as never});
      const {config} = await resolveCompositionConfig(comp);
      expect(config.fps).toBe(comp.fps); // nothing applied
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown field "codec"'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('resolveCompositionConfig — MediaSized (async metadata demo)', () => {
  it('sizes durationInFrames from the probed clip, not the (wrong) static', async () => {
    // Static is deliberately 30; the probe reports the file's true length.
    expect(mediaSized.durationInFrames).toBe(30);
    const {config} = await resolveCompositionConfig(mediaSized);
    expect(config.durationInFrames).toBe(150); // ceil(5.000s * 30fps)
  });

  it('rejects when the media cannot be probed', async () => {
    await expect(resolveCompositionConfig(mediaSized, {src: 'missing.mp4'})).rejects.toThrow(
      /could not load media/,
    );
  });
});

describe('orTimeout — the named deadline for hung hooks', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(orTimeout(Promise.resolve('x'), 1000, 'hook')).resolves.toBe('x');
  });

  it('rejects with a NAMED error when the promise never settles', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const guarded = orTimeout(never, CALCULATE_METADATA_TIMEOUT_MS, 'MyComp: calculateMetadata');
      const assertion = expect(guarded).rejects.toThrow(
        'MyComp: calculateMetadata: did not settle within 30000ms',
      );
      await vi.advanceTimersByTimeAsync(CALCULATE_METADATA_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates the original rejection untouched (named deadline only bounds hangs)', async () => {
    const boom = Promise.reject(new Error('original reason'));
    await expect(orTimeout(boom, 1000, 'hook')).rejects.toThrow('original reason');
  });
});
