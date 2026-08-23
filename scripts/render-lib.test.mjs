import {describe, expect, it, vi} from 'vitest';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {
  aggregateAudioSegments,
  assetPath,
  buildConcatList,
  hasEncoderToken,
  parseRegistryIds,
  planChunkVideoEncode,
  chunkContainerFor,
  planChunks,
  planEncode,
  planOutput,
  readFlag,
  volumeFilterToken,
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
    expect(chunks).toEqual([
      [0, 38],
      [38, 76],
      [76, 114],
      [114, 150],
    ]);
    assertInvariants(chunks, 150);
  });

  it('splits 10 frames across 4 workers', () => {
    const chunks = planChunks(10, 4);
    expect(chunks).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
      [9, 10],
    ]);
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
    expect(chunks).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
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
      {src: 'bg.wav', startFrame: 0, endFrame: 2, trimStart: 0, volumes: [1, 1, 1]},
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
      {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 0, volumes: [1, 1]},
      {src: 'bg.wav', startFrame: 3, endFrame: 3, trimStart: 2, volumes: [1]},
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
        {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 0, volumes: [1, 1]},
        {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 5, volumes: [0.5, 0.5]},
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
      {src: 'bg.wav', startFrame: 0, endFrame: 2, trimStart: 0, volumes: [1, 1, 1]},
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

  // Regression (backlog #13): volume changes used to split the run, so a
  // per-frame fade became one ffmpeg input + adelay per frame — splice
  // artifacts from integer-ms quantization, and unbounded input count.
  it('merges a volume-varying run into ONE segment carrying per-frame volumes', () => {
    const audioByFrame = [
      {frame: 0, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0, volume: 0.8}]},
      {frame: 1, reports: [{id: 'a', src: 'bg.wav', mediaTime: 0.03, volume: 0.9}]},
    ];
    expect(aggregateAudioSegments(audioByFrame)).toEqual([
      {src: 'bg.wav', startFrame: 0, endFrame: 1, trimStart: 0, volumes: [0.8, 0.9]},
    ]);
  });

  it('a whole 30-frame fade stays one segment; a gap still splits it', () => {
    const frames = [];
    for (let f = 0; f < 30; f++) {
      frames.push({
        frame: f,
        reports: [{id: 'a', src: 'bg.wav', mediaTime: f * 0.03, volume: 1 - f / 30}],
      });
    }
    frames.push({frame: 40, reports: [{id: 'a', src: 'bg.wav', mediaTime: 12, volume: 0.5}]});
    const segments = aggregateAudioSegments(frames);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      src: 'bg.wav',
      startFrame: 0,
      endFrame: 29,
      trimStart: 0,
      volumes: frames.slice(0, 30).map((f) => f.reports[0].volume),
    });
    expect(segments[1].startFrame).toBe(40);
  });
});

describe('volumeFilterToken', () => {
  it('emits the scalar form for constant volumes', () => {
    expect(volumeFilterToken([0.5, 0.5], 30)).toBe('volume=0.5');
    expect(volumeFilterToken([1], 30)).toBe('volume=1');
  });

  it('emits an eval=frame piecewise expression for varying volumes', () => {
    // Frames at fps 30: frame k occupies [k/30, (k+1)/30). Values 0.9 then 0.8.
    expect(volumeFilterToken([0.9, 0.8], 30)).toBe(
      "volume=volume='0.90000000-0.10000000*gte(t,0.033333)':eval=frame",
    );
  });

  it('telescopes one gte() step per value change; constant runs add nothing', () => {
    // [1, 0.5, 0] @60: boundaries at 1/60 and 2/60, deltas −0.5 each.
    expect(volumeFilterToken([1, 0.5, 0], 60)).toBe(
      "volume=volume='1.00000000-0.50000000*gte(t,0.016667)-0.50000000*gte(t,0.033333)':eval=frame",
    );
    // A long constant tail contributes no terms (deltas are zero).
    const token = volumeFilterToken([1, ...Array(200).fill(0.5), 0], 30);
    expect(token.match(/gte\(/g)).toHaveLength(2);
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

  // Containment: traversal attempts are rejected outright (plan 026). These
  // paths previously escaped publicDir via join() normalization.
  it('rejects a src that traverses outside the public dir', () => {
    expect(() => assetPath('public', '../etc/passwd')).toThrow(/outside the public dir/);
    expect(() => assetPath('public', 'a/../../outside.wav')).toThrow(/outside the public dir/);
    expect(() => assetPath('/tmp/pub', '/../../../../etc/passwd')).toThrow(
      /outside the public dir/,
    );
  });

  it('still accepts nested paths inside the public dir', () => {
    expect(assetPath('public', 'sub/dir/bg.wav')).toBe(join('public', 'sub/dir/bg.wav'));
    expect(assetPath('public', './bg.wav')).toBe(join('public', 'bg.wav'));
  });
});

describe('parseRegistryIds', () => {
  it('extracts the real composition ids in order from src/render/registry.ts', async () => {
    const registrySource = await readFile(
      new URL('../src/render/registry.ts', import.meta.url),
      'utf8',
    );
    expect(parseRegistryIds(registrySource)).toEqual([
      'HelloWorld',
      'AsyncImage',
      'WithAudio',
      'WithVideo',
      'WithSeries',
      'WithOffthread',
      'Countdown',
    ]);
  });

  it('returns [] when there is no id: field', () => {
    expect(parseRegistryIds('export const compositions = [];')).toEqual([]);
  });

  it('does not warn when the id count matches the component count (real registry)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registrySource = await readFile(
      new URL('../src/render/registry.ts', import.meta.url),
      'utf8',
    );
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

describe('planEncode', () => {
  const base = {
    crf: '18',
    audioBitrate: '192k',
    fps: 30,
    framesPattern: '/tmp/foo/frame-%05d.png',
    segments: [],
    assetPaths: [],
    out: 'out/video.mp4',
  };

  describe('mp4', () => {
    it("no audio: args match today's exactly", () => {
      const plan = planEncode({...base, format: 'mp4'});
      expect(plan).toEqual({
        args: [
          '-y',
          '-framerate',
          '30',
          '-start_number',
          '0',
          '-i',
          '/tmp/foo/frame-%05d.png',
          '-c:v',
          'libx264',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          'out/video.mp4',
        ],
        dropsAudio: false,
      });
    });

    it('includes -movflags +faststart (progressive playback), with and without audio', () => {
      const noAudio = planEncode({...base, format: 'mp4'});
      const withAudio = planEncode({
        ...base,
        format: 'mp4',
        segments: [{src: 'a.wav', startFrame: 0, endFrame: 10, trimStart: 0, volumes: [1]}],
        assetPaths: ['/tmp/a.wav'],
      });
      for (const plan of [noAudio, withAudio]) {
        const i = plan.args.indexOf('-movflags');
        expect(i).not.toBe(-1);
        expect(plan.args[i + 1]).toBe('+faststart');
      }
    });

    it('no audio: dropsAudio is false', () => {
      const plan = planEncode({...base, format: 'mp4'});
      expect(plan.dropsAudio).toBe(false);
    });

    it('with 2 segments: includes amix in filter complex', () => {
      const segments = [
        {src: 'a.wav', startFrame: 0, endFrame: 149, trimStart: 0, volumes: [1]},
        {src: 'b.wav', startFrame: 30, endFrame: 89, trimStart: 5, volumes: [0.5]},
      ];
      const plan = planEncode({
        ...base,
        format: 'mp4',
        segments,
        assetPaths: ['/tmp/a.wav', '/tmp/b.wav'],
      });
      expect(plan.dropsAudio).toBe(false);
      const fcIdx = plan.args.indexOf('-filter_complex');
      expect(fcIdx).not.toBe(-1);
      const filterGraph = plan.args[fcIdx + 1];
      expect(filterGraph).toContain('amix=inputs=2:normalize=0');
      expect(filterGraph).toContain('atrim');
      expect(filterGraph).toContain('adelay');
    });

    it('with 1 segment: no amix, uses [s0] label', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 149, trimStart: 0, volumes: [1]}];
      const plan = planEncode({
        ...base,
        format: 'mp4',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      const fcIdx = plan.args.indexOf('-filter_complex');
      const filterGraph = plan.args[fcIdx + 1];
      expect(filterGraph).not.toContain('amix');
      // Out label should be [s0], not [aout]
      const mapIdx = plan.args.indexOf('-map', plan.args.indexOf('-map') + 1);
      expect(plan.args[mapIdx + 1]).toBe('[s0]');
    });

    it('includes -c:a aac when audio is present', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 10, trimStart: 0, volumes: [1]}];
      const plan = planEncode({
        ...base,
        format: 'mp4',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      const aCodecIdx = plan.args.indexOf('-c:a');
      expect(aCodecIdx).not.toBe(-1);
      expect(plan.args[aCodecIdx + 1]).toBe('aac');
    });

    it('delay in filter matches (startFrame / fps) * 1000 rounded', () => {
      const segments = [
        {src: 'a.wav', startFrame: 60, endFrame: 120, trimStart: 1.5, volumes: [0.8]},
      ];
      const plan = planEncode({
        ...base,
        format: 'mp4',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      const fcIdx = plan.args.indexOf('-filter_complex');
      const filterGraph = plan.args[fcIdx + 1];
      // startFrame=60, fps=30 → delay = (60/30)*1000 = 2000ms
      expect(filterGraph).toContain('adelay=2000:all=1');
      expect(filterGraph).toContain('volume=0.8');
      expect(filterGraph).toContain('atrim=start=1.500000');
    });

    // Regression (backlog #13): a per-frame fade used to become one input +
    // adelay per frame; it must stay one input whose gain is an in-ffmpeg
    // envelope.
    it('constant segment keeps the scalar volume token (no eval)', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 29, trimStart: 0, volumes: [1]}];
      const plan = planEncode({...base, format: 'mp4', segments, assetPaths: ['/tmp/a.wav']});
      const filterGraph = plan.args[plan.args.indexOf('-filter_complex') + 1];
      expect(filterGraph).toContain('volume=1');
      expect(filterGraph).not.toContain('eval=frame');
    });

    it('automated segment emits ONE input with an eval=frame gain envelope', () => {
      const volumes = Array.from({length: 30}, (_, k) => 1 - k / 30);
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 29, trimStart: 0, volumes}];
      const plan = planEncode({
        ...base,
        fps: 30,
        format: 'mp4',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      // One video input + ONE audio input — not one per frame.
      const inputCount = plan.args.filter((a) => a === '-i').length;
      expect(inputCount).toBe(2);
      const filterGraph = plan.args[plan.args.indexOf('-filter_complex') + 1];
      expect(filterGraph).toContain("volume=volume='");
      expect(filterGraph).toContain('*gte(t,0.033333)');
      expect(filterGraph).toContain(':eval=frame');
      expect(filterGraph).not.toContain('amix');
    });
  });

  describe('webm', () => {
    it('defaults to libvpx-vp9 and libopus with -b:v 0', () => {
      const plan = planEncode({...base, format: 'webm'});
      expect(plan.args).toContain('-c:v');
      expect(plan.args).toContain('libvpx-vp9');
      expect(plan.args).toContain('-b:v');
      expect(plan.args).toContain('0');
      expect(plan.args).toContain('-pix_fmt');
      expect(plan.args).toContain('yuv420p');
      // +faststart is an mp4 container concept; webm must not get it.
      expect(plan.args).not.toContain('-movflags');
      expect(plan.dropsAudio).toBe(false);
    });

    it('with audio: uses libopus not aac', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 10, trimStart: 0, volumes: [1]}];
      const plan = planEncode({
        ...base,
        format: 'webm',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      const aCodecIdx = plan.args.indexOf('-c:a');
      expect(plan.args[aCodecIdx + 1]).toBe('libopus');
    });

    it('explicit codec overrides libvpx-vp9 but keeps libopus for audio', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 10, trimStart: 0, volumes: [1]}];
      const plan = planEncode({
        ...base,
        format: 'webm',
        codec: 'libx264',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      const vCodecIdx = plan.args.indexOf('-c:v');
      expect(plan.args[vCodecIdx + 1]).toBe('libx264');
      const aCodecIdx = plan.args.indexOf('-c:a');
      expect(plan.args[aCodecIdx + 1]).toBe('libopus');
    });

    it('explicit codec override with no audio', () => {
      const plan = planEncode({
        ...base,
        format: 'webm',
        codec: 'libx264',
      });
      const vCodecIdx = plan.args.indexOf('-c:v');
      expect(plan.args[vCodecIdx + 1]).toBe('libx264');
      expect(plan.args).toContain('-b:v');
      expect(plan.args).not.toContain('-c:a');
    });

    it('no audio: dropsAudio is false', () => {
      const plan = planEncode({...base, format: 'webm'});
      expect(plan.dropsAudio).toBe(false);
    });
  });

  describe('gif', () => {
    it('uses palettegen/paletteuse filter complex', () => {
      const plan = planEncode({
        ...base,
        format: 'gif',
        out: 'out/video.gif',
      });
      const fcIdx = plan.args.indexOf('-filter_complex');
      const filterGraph = plan.args[fcIdx + 1];
      expect(filterGraph).toBe('fps=30,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse');
    });

    it('has no -c:v, no -pix_fmt, no -crf', () => {
      const plan = planEncode({
        ...base,
        format: 'gif',
        out: 'out/video.gif',
      });
      expect(plan.args).not.toContain('-c:v');
      expect(plan.args).not.toContain('-pix_fmt');
      expect(plan.args).not.toContain('-crf');
    });

    it('no audio: dropsAudio is false', () => {
      const plan = planEncode({
        ...base,
        format: 'gif',
        out: 'out/video.gif',
      });
      expect(plan.dropsAudio).toBe(false);
    });

    it('with segments: dropsAudio is true but audio args omitted', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 10, trimStart: 0, volumes: [1]}];
      const plan = planEncode({
        ...base,
        format: 'gif',
        segments,
        assetPaths: ['/tmp/a.wav'],
        out: 'out/video.gif',
      });
      expect(plan.dropsAudio).toBe(true);
      expect(plan.args).not.toContain('-c:a');
      const fcIdx = plan.args.indexOf('-filter_complex');
      const filterGraph = plan.args[fcIdx + 1];
      expect(filterGraph).not.toContain('atrim');
      expect(filterGraph).not.toContain('adelay');
    });

    it('includes video input args', () => {
      const plan = planEncode({
        ...base,
        format: 'gif',
        out: 'out/video.gif',
      });
      expect(plan.args).toContain('-framerate');
      expect(plan.args).toContain('30');
      expect(plan.args).toContain('-start_number');
      expect(plan.args).toContain('0');
    });
  });

  describe('png-seq', () => {
    it('returns null', () => {
      const plan = planEncode({...base, format: 'png-seq'});
      expect(plan).toBeNull();
    });

    it('returns null even with segments', () => {
      const segments = [{src: 'a.wav', startFrame: 0, endFrame: 10, trimStart: 0, volumes: [1]}];
      const plan = planEncode({
        ...base,
        format: 'png-seq',
        segments,
        assetPaths: ['/tmp/a.wav'],
      });
      expect(plan).toBeNull();
    });
  });

  describe('validation', () => {
    it('throws on unknown format', () => {
      expect(() => planEncode({...base, format: 'avi'})).toThrow('Unknown format: avi');
    });

    it('throws on unknown format naming valid options', () => {
      expect(() => planEncode({...base, format: 'mov'})).toThrow(/mp4, webm, gif, png-seq/);
    });
  });

  describe('explicit codec override', () => {
    it('mp4: explicit codec overrides libx264', () => {
      const plan = planEncode({...base, format: 'mp4', codec: 'libx265'});
      const vCodecIdx = plan.args.indexOf('-c:v');
      expect(plan.args[vCodecIdx + 1]).toBe('libx265');
    });
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

describe('planOutput', () => {
  describe('default out paths (no --out)', () => {
    it('mp4 → out/video.mp4, mkdir parent', () => {
      expect(planOutput({format: 'mp4'})).toEqual({
        out: 'out/video.mp4',
        mkdirTarget: 'out',
        warning: null,
      });
    });

    it('webm → out/video.webm', () => {
      expect(planOutput({format: 'webm'}).out).toBe('out/video.webm');
    });

    it('gif → out/video.gif', () => {
      expect(planOutput({format: 'gif'}).out).toBe('out/video.gif');
    });

    it('png-seq → out/frames, and mkdirTarget is the out dir ITSELF', () => {
      // Regression: mkdir(dirname(out)) only created out/, not out/frames/,
      // and every png-seq copyFile then failed with ENOENT.
      expect(planOutput({format: 'png-seq'})).toEqual({
        out: 'out/frames',
        mkdirTarget: 'out/frames',
        warning: null,
      });
    });

    it('still → out/still-<N>.png, mkdir parent', () => {
      expect(planOutput({format: 'mp4', stillFrame: 75})).toEqual({
        out: 'out/still-75.png',
        mkdirTarget: 'out',
        warning: null,
      });
    });

    it('still frame 0 is a still, not a video default', () => {
      expect(planOutput({format: 'mp4', stillFrame: 0}).out).toBe('out/still-0.png');
    });
  });

  describe('explicit --out', () => {
    it('matching extension: no warning', () => {
      expect(planOutput({format: 'webm', out: 'movie.webm'})).toEqual({
        out: 'movie.webm',
        mkdirTarget: '.',
        warning: null,
      });
    });

    it('mismatched extension: warning names both format and path', () => {
      const plan = planOutput({format: 'webm', out: 'movie.mp4'});
      expect(plan.out).toBe('movie.mp4');
      expect(plan.warning).toContain('webm');
      expect(plan.warning).toContain('movie.mp4');
    });

    it('png-seq: explicit --out is the directory, no extension warning', () => {
      expect(planOutput({format: 'png-seq', out: 'renders/seq'})).toEqual({
        out: 'renders/seq',
        mkdirTarget: 'renders/seq',
        warning: null,
      });
    });

    it('still with .png out: no warning (format default mp4 must not leak in)', () => {
      // Regression: --still 5 --out shot.png used to warn "writing mp4
      // content to shot.png" because format stayed at its mp4 default.
      expect(planOutput({format: 'mp4', stillFrame: 5, out: 'shot.png'}).warning).toBeNull();
    });

    it('still with non-.png out: warns about PNG content', () => {
      const plan = planOutput({format: 'mp4', stillFrame: 5, out: 'shot.jpg'});
      expect(plan.warning).toContain('PNG');
      expect(plan.warning).toContain('shot.jpg');
    });

    it('nested explicit out: mkdirTarget is the parent dir', () => {
      expect(planOutput({format: 'mp4', out: 'a/b/c.mp4'}).mkdirTarget).toBe('a/b');
    });
  });
});

describe('planChunkVideoEncode', () => {
  it('builds video-only chunk args with -start_number and -frames:v', () => {
    const args = planChunkVideoEncode({
      fps: 30,
      startFrame: 38,
      frameCount: 38,
      framesPattern: '/tmp/frames/frame-%05d.png',
      out: '/tmp/chunk-1.mp4',
    });
    expect(args).toContain('-framerate');
    expect(args).toContain('30');
    expect(args).toContain('-start_number');
    expect(args[args.indexOf('-start_number') + 1]).toBe('38');
    expect(args).toContain('-frames:v');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('38');
    expect(args[args.length - 1]).toBe('/tmp/chunk-1.mp4');
    expect(args).toContain('-pix_fmt');
  });

  it('uses libx264 by default and respects explicit codec/crf', () => {
    expect(
      planChunkVideoEncode({
        fps: 30,
        startFrame: 0,
        frameCount: 10,
        framesPattern: 'p',
        out: 'o.mp4',
      }),
    ).toContain('libx264');
    const custom = planChunkVideoEncode({
      fps: 30,
      startFrame: 0,
      frameCount: 10,
      framesPattern: 'p',
      out: 'o.mp4',
      codec: 'libx265',
      crf: '23',
    });
    expect(custom).toContain('libx265');
    expect(custom[custom.indexOf('-crf') + 1]).toBe('23');
  });

  // Regression (backlog #11): --distributed --format webm used to hardcode
  // libx264/.mp4 chunks, so the concat into .webm failed after every frame
  // had been rendered. Chunks must match the final container.
  it('webm chunks use libvpx-vp9 with -b:v 0 for constant-quality CRF', () => {
    const args = planChunkVideoEncode({
      format: 'webm',
      fps: 30,
      startFrame: 0,
      frameCount: 10,
      framesPattern: 'p',
      out: 'chunk-0.webm',
    });
    expect(args).toContain('libvpx-vp9');
    expect(args[args.indexOf('-crf') + 1]).toBe('18');
    expect(args[args.indexOf('-b:v') + 1]).toBe('0');
    expect(args[args.length - 1]).toBe('chunk-0.webm');
  });

  it('explicit codec overrides the per-format default', () => {
    const args = planChunkVideoEncode({
      format: 'webm',
      codec: 'libvpx',
      fps: 30,
      startFrame: 0,
      frameCount: 10,
      framesPattern: 'p',
      out: 'chunk-0.webm',
    });
    expect(args).toContain('libvpx');
    expect(args).not.toContain('libvpx-vp9');
  });

  it('rejects formats the distributed path cannot stitch', () => {
    expect(() =>
      planChunkVideoEncode({
        format: 'gif',
        fps: 30,
        startFrame: 0,
        frameCount: 10,
        framesPattern: 'p',
        out: 'c.gif',
      }),
    ).toThrow(/Unknown chunk format: gif/);
  });
});

describe('chunkContainerFor', () => {
  it('maps each distributable format to its matching container', () => {
    expect(chunkContainerFor('mp4')).toBe('.mp4');
    expect(chunkContainerFor('webm')).toBe('.webm');
  });

  it('throws for formats without a chunk-encode path', () => {
    expect(() => chunkContainerFor('gif')).toThrow(/does not support --format gif/);
    expect(() => chunkContainerFor('png-seq')).toThrow(/does not support --format png-seq/);
  });
});

describe('buildConcatList', () => {
  it('joins chunk paths as concat demuxer file list', () => {
    expect(buildConcatList(['/tmp/a.mp4', '/tmp/b.mp4'])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n",
    );
    expect(buildConcatList([])).toBe('\n');
  });
});
