import {describe, expect, it, vi} from 'vitest';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {
  aggregateAudioSegments,
  assetPath,
  hasEncoderToken,
  parseRegistryIds,
  planChunks,
  readFlag,
} from './render-lib.mjs';

describe('planChunks', () => {
  const assertInvariants = (chunks, durationInFrames) => {
    expect(chunks[0][0]).toBe(0);
    expect(chunks[chunks.length - 1][1]).toBe(durationInFrames);
    let sum = 0;
    for (let i = 0; i < chunks.length; i++) {
      const [s, e] = chunks[i];
      expect(e).toBeGreaterThan(s);
      sum += e - s;
      if (i > 0) expect(s).toBe(chunks[i - 1][1]); // contiguous, disjoint
    }
    expect(sum).toBe(durationInFrames);
  };

  it('splits 150 frames across 4 workers into even 38-frame chunks', () => {
    const chunks = planChunks(150, 4);
    expect(chunks).toEqual([[0, 38], [38, 76], [76, 114], [114, 150]]);
    assertInvariants(chunks, 150);
  });

  it('splits 10 frames across 4 workers', () => {
    const chunks = planChunks(10, 4);
    expect(chunks).toEqual([[0, 3], [3, 6], [6, 9], [9, 10]]);
    assertInvariants(chunks, 10);
  });

  it('produces a single chunk for a single frame', () => {
    const chunks = planChunks(1, 4);
    expect(chunks).toEqual([[0, 1]]);
    assertInvariants(chunks, 1);
  });

  it('produces a single chunk when concurrency is 1', () => {
    const chunks = planChunks(90, 1);
    expect(chunks).toEqual([[0, 90]]);
    assertInvariants(chunks, 90);
  });

  it('caps concurrency at durationInFrames (one frame per chunk)', () => {
    const chunks = planChunks(3, 8);
    expect(chunks).toEqual([[0, 1], [1, 2], [2, 3]]);
    assertInvariants(chunks, 3);
  });
});

describe('aggregateAudioSegments', () => {
  it('returns [] for empty input', () => {
    expect(aggregateAudioSegments([])).toEqual([]);
  });

  it('merges contiguous frames for one id into a single segment', () => {
    const audioByFrame = [
      {frame: 0, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0, volume: 1}]},
      {frame: 1, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.03, volume: 1}]},
      {frame: 2, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.06, volume: 1}]},
    ];
    expect(aggregateAudioSegments(audioByFrame)).toEqual([
      {src: 'bg.wav', startFrame: 0, endFrame: 2, trimStart: 0, volume: 1},
    ]);
  });

  it('splits into two segments when there is a gap in frames', () => {
    const audioByFrame = [
      {frame: 0, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0, volume: 1}]},
      {frame: 1, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.03, volume: 1}]},
      // gap at frame 2
      {frame: 3, reports: [{id: 'a', src: 'bg.wav', mediaTime: 2, volume: 1}]},
    ];
    expect(aggregateAudioSegments(audioByFrame)).toEqual([
      {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 0, volume: 1},
      {src: 'bg.wav', startFrame: 3, endFrame: 3, trimStart: 2, volume: 1},
    ]);
  });

  it('keeps two <Audio> instances of the same src as separate segments', () => {
    const audioByFrame = [
      {
        frame: 0,
        reports: [
          {id: 'a', src: 'bg.wav', mediaTime: 0, volume: 1},
          {id: 'b', src: 'bg.wav', mediaTime: 5, volume: 0.5},
        ],
      },
      {
        frame: 1,
        reports: [
          {id: 'a', src: 'bg.wav', mediaTime: 0.03, volume: 1},
          {id: 'b', src: 'bg.wav', mediaTime: 5.03, volume: 0.5},
        ],
      },
    ];
    const segments = aggregateAudioSegments(audioByFrame);
    expect(segments).toHaveLength(2);
    expect(segments).toEqual(
      expect.arrayContaining([
        {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 0, volume: 1},
        {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 5, volume: 0.5},
      ]),
    );
  });

  it('sorts correctly even when reports arrive with frames out of order', () => {
    const audioByFrame = [
      {frame: 2, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.06, volume: 1}]},
      {frame: 0, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0, volume: 1}]},
      {frame: 1, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.03, volume: 1}]},
    ];
    expect(aggregateAudioSegments(audioByFrame)).toEqual([
      {src: 'bg.wav', startFrame: 0, endFrame: 2, trimStart: 0, volume: 1},
    ]);
  });

  it('sorts output segments by startFrame across ids', () => {
    const audioByFrame = [
      {frame: 5, reports: [{id: 'later', src: 'b.wav', mediaTime: 0, volume: 1}]},
      {frame: 0, reports: [{id: 'earlier', src: 'a.wav', mediaTime: 0, volume: 1}]},
    ];
    const segments = aggregateAudioSegments(audioByFrame);
    expect(segments.map((s) => s.startFrame)).toEqual([0, 5]);
  });

  it('takes volume from the first report of each run', () => {
    // Same id, same run, but each per-frame report happens to carry its own
    // volume value — the segment should record the first one, not the last.
    const audioByFrame = [
      {frame: 0, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0, volume: 0.8}]},
      {frame: 1, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.03, volume: 0.9}]},
    ];
    expect(aggregateAudioSegments(audioByFrame)[0].volume).toBe(0.8);
  });
});

describe('readFlag', () => {
  it('returns the value of a present flag', () => {
    expect(readFlag(['--comp', 'HelloWorld'], 'comp', '')).toBe('HelloWorld');
  });

  it('returns the fallback when the flag is absent', () => {
    expect(readFlag(['--out', 'x.mp4'], 'comp', 'fallback')).toBe('fallback');
  });

  // Was previously a silent mis-parse (the following flag's name was returned
  // as the value). Plan 003 makes this an actionable error instead.
  it('throws naming the flag when the next token looks like another flag', () => {
    expect(() => readFlag(['--crf', '--codec', 'libx264'], 'crf', '18')).toThrow(
      '--crf requires a value',
    );
  });

  // Was previously a silent fallback (the flag was swallowed with no
  // diagnostic). Plan 003 makes this an actionable error instead.
  it('throws when a trailing value-flag has no following token', () => {
    expect(() => readFlag(['--props'], 'props', '')).toThrow('--props requires a value');
  });

  it('still returns the fallback for an unrelated absent flag even when other flags in argv are malformed', () => {
    // --crf here has no value, but we're reading --out, which is present and
    // fine — only the flag actually being read is checked.
    expect(readFlag(['--out', 'x.mp4', '--crf'], 'out', 'fallback')).toBe('x.mp4');
  });
});

describe('assetPath', () => {
  it('joins a leading-slash src under the public dir', () => {
    expect(assetPath('public', '/bg.wav')).toBe(join('public', 'bg.wav'));
  });

  it('joins a bare (no leading slash) src the same way', () => {
    expect(assetPath('public', 'bg.wav')).toBe(join('public', 'bg.wav'));
  });

  // Characterization: `../` is currently NOT rejected or sanitized, so a
  // crafted src can resolve outside publicDir. Renderer hardening (plan
  // 003/later) may revisit this.
  it('characterization: a src containing ../ is not rejected and can escape publicDir', () => {
    // join() normalizes the traversal instead of assetPath rejecting it, so
    // the result lands outside "public" entirely.
    expect(assetPath('public', '../etc/passwd')).toBe(join('etc', 'passwd'));
  });
});

describe('parseRegistryIds', () => {
  it('extracts the four real composition ids in order from src/render/registry.ts', async () => {
    const registrySource = await readFile(new URL('../src/render/registry.ts', import.meta.url), 'utf8');
    expect(parseRegistryIds(registrySource)).toEqual(['HelloWorld', 'AsyncImage', 'WithAudio', 'WithVideo']);
  });

  it('returns [] when there is no id: field', () => {
    expect(parseRegistryIds('export const compositions = [];')).toEqual([]);
  });

  it('does not warn when the id count matches the component count (real registry)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registrySource = await readFile(new URL('../src/render/registry.ts', import.meta.url), 'utf8');
    parseRegistryIds(registrySource);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // The `{ id: ... }` shape narrows out plain `id:` fields that aren't the
  // first member of an object literal, but a nested object that itself opens
  // with `id:` (e.g. `defaultProps: { id: ... }`) still matches — the
  // function can't fully distinguish structure from text. It compensates by
  // warning (to stderr) on a component:/id: count mismatch, while still
  // returning the (over-inclusive) id list so --list keeps working.
  it('still picks up a nested id: field but warns about the id/component count mismatch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const synthetic = `
      export const compositions = [
        {
          id: 'Real',
          defaultProps: {
            id: 'not-a-composition-id',
          },
        },
      ];
    `;
    expect(parseRegistryIds(synthetic)).toEqual(['Real', 'not-a-composition-id']);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('component:');
    warnSpy.mockRestore();
  });
});

describe('hasEncoderToken', () => {
  const encoders = `
 Encoders:
  V..... = Video
  A..... = Audio
 ------
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V..... libx265              libx265 H.265 / HEVC
`;

  it('matches an exact whitespace-delimited token', () => {
    expect(hasEncoderToken(encoders, 'libx264')).toBe(true);
  });

  it('does not match a substring of a token', () => {
    expect(hasEncoderToken(encoders, 'libx26')).toBe(false);
  });

  it('does not match a codec absent from the output', () => {
    expect(hasEncoderToken(encoders, 'libx999')).toBe(false);
  });
});
