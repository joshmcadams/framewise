import {describe, expect, it} from 'vitest';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {aggregateAudioSegments, assetPath, parseRegistryIds, planChunks, readFlag} from './render-lib.mjs';

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

  // Characterization (current behavior, not necessarily desired): a following
  // flag-looking token is returned as the value verbatim — the parser has no
  // notion of "looks like another flag". Plan 003 may change this.
  it('characterization: a following --other token is returned as the value', () => {
    expect(readFlag(['--no-wait', '--comp', 'HelloWorld'], 'no-wait', 'fallback')).toBe('--comp');
  });

  // Characterization: a value-flag with nothing after it (e.g. it's the last
  // argv token) falls back, silently swallowing the flag. Plan 003 may change
  // this.
  it('characterization: a trailing value-flag with no following token returns the fallback', () => {
    expect(readFlag(['--comp'], 'comp', 'fallback')).toBe('fallback');
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

  // Characterization: the regex matches any `id: '...'` textually, including
  // one nested inside defaultProps — it has no notion of registry structure.
  // Plan 003 may tighten this.
  it('characterization: an id: field inside defaultProps is incorrectly picked up too', () => {
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
  });
});
