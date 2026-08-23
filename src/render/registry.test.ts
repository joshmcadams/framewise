import {describe, expect, it, vi} from 'vitest';
import {compositions, getComposition, resolveCompositionConfig, type Composition} from './registry';

const staticComp = compositions.find((c) => c.id === 'HelloWorld')!;
const countdown = compositions.find((c) => c.id === 'Countdown')!;

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
  it('returns the declared fields unchanged (byte-identical path)', () => {
    const {config, props} = resolveCompositionConfig(staticComp);
    expect(config).toEqual({
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 150,
    });
    expect(props).toEqual({...staticComp.defaultProps});
  });

  it('merges inputProps over defaultProps (shallow)', () => {
    const {props} = resolveCompositionConfig(asComp({defaultProps: {a: 1, nested: {x: 1}}}), {
      nested: {y: 2},
      b: 2,
    });
    expect(props).toEqual({a: 1, nested: {y: 2}, b: 2});
  });
});

describe('resolveCompositionConfig — calculateMetadata', () => {
  it('applies returned overrides over the static fields', () => {
    const comp = asComp({
      calculateMetadata: () => ({durationInFrames: 90, fps: 60}),
    });
    const {config} = resolveCompositionConfig(comp);
    expect(config.durationInFrames).toBe(90);
    expect(config.fps).toBe(60);
    expect(config.width).toBe(1280); // untouched
  });

  it('passes merged props to the hook', () => {
    const hook = vi.fn(() => ({}));
    const comp = asComp({
      defaultProps: {size: 'big'},
      calculateMetadata: hook,
    });
    resolveCompositionConfig(comp, {label: 'hi'});
    expect(hook).toHaveBeenCalledWith({props: {size: 'big', label: 'hi'}, composition: comp});
  });

  it('derives the Countdown duration from props.seconds', () => {
    expect(resolveCompositionConfig(countdown).config.durationInFrames).toBe(150); // default 5 s
    expect(resolveCompositionConfig(countdown, {seconds: 3}).config.durationInFrames).toBe(90);
    expect(resolveCompositionConfig(countdown, {seconds: 1}).config.durationInFrames).toBe(30);
  });

  it('rejects out-of-range Countdown seconds with a clear message', () => {
    for (const bad of [0, -5, 61, 2.5]) {
      expect(() => resolveCompositionConfig(countdown, {seconds: bad})).toThrow(
        /whole number from 1 to 60/,
      );
    }
  });

  it('throws on invalid calculated values', () => {
    for (const [field, value] of [
      ['width', 0],
      ['height', -100],
      ['fps', 29.97],
      ['durationInFrames', 'many' as unknown as number],
    ] as const) {
      const comp = asComp({calculateMetadata: () => ({[field]: value})});
      expect(() => resolveCompositionConfig(comp)).toThrow(String(field));
    }
  });

  it('warns on and ignores unknown returned fields', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const comp = asComp({calculateMetadata: () => ({codec: 'prores'}) as never});
      const {config} = resolveCompositionConfig(comp);
      expect(config.fps).toBe(comp.fps); // nothing applied
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown field "codec"'));
    } finally {
      warn.mockRestore();
    }
  });
});
