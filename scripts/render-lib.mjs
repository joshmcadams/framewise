// Pure logic for scripts/render.mjs, extracted so it can be unit-tested.
// No side effects, no imports from puppeteer/vite — keep it that way.
import {join, dirname, resolve, sep} from 'node:path';

// Read a `--name value` flag out of an argv-style array. Returns `fallback`
// when the flag is absent. When the flag IS present, a missing or
// flag-looking value (e.g. `--crf --codec libx264`, or `--crf` as the last
// token) is an error rather than a silent fallback or mis-parse — those are
// invocation mistakes, not "flag not passed".
export const readFlag = (args, name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} requires a value (e.g. --${name} <value>)`);
  }
  return value;
};

// Where composition asset URLs (e.g. "/bg.wav") resolve on disk. One place, so
// the renderer and any future staticFile() helper agree. Containment: the
// resolved target must stay inside publicDir — a crafted "../…" src must not
// reach files outside it (these paths feed ffmpeg inputs).
export const assetPath = (publicDir, src) => {
  const relative = src.replace(/^\//, '');
  const base = resolve(publicDir);
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(
      `Asset path "${src}" resolves outside the public dir (${publicDir}) — path traversal is not allowed.`,
    );
  }
  return join(publicDir, relative);
};

// Parse composition ids out of a src/render/registry.ts-shaped source string.
// Scoped to `id:` as the first member of an object literal (each registry
// entry opens with `{\n    id: '...'`) rather than any `id:` anywhere in the
// file, to cut down on false positives (e.g. a `defaultProps: { id: ... }`).
// That narrower shape still can't fully distinguish a top-level entry from a
// nested object that itself opens with an `id:` field, so we additionally
// cross-check against the number of `component:` fields — every real entry
// has exactly one — and warn (but still return the ids) on a mismatch.
export const parseRegistryIds = (registrySource) => {
  const ids = [...registrySource.matchAll(/\{\s*id:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  // `\w+\s*,` (a bare identifier immediately followed by a comma) matches an
  // object-literal member like `component: HelloWorld,` but not the type
  // declaration's `component: ComponentType<any>;` (generic + semicolon).
  const componentCount = [...registrySource.matchAll(/\bcomponent:\s*\w+\s*,/g)].length;
  if (ids.length !== componentCount) {
    console.warn(
      `parseRegistryIds: found ${ids.length} id(s) but ${componentCount} component: field(s) — ` +
        `the registry shape may have changed, or a nested id: field (e.g. inside defaultProps) was picked up.`,
    );
  }
  return ids;
};

// Check whether `codec` appears as a whitespace-delimited token in `ffmpeg
// -encoders` output, so a substring like "libx26" doesn't false-positive
// against "libx264".
export const hasEncoderToken = (encodersOutput, codec) =>
  encodersOutput.split(/\s+/).includes(codec);

// Turn per-frame audio reports into contiguous segments. Keyed by the <Audio>'s
// stable instance id (so the same file used twice yields two segments), split
// only on gaps in the active frames. Volume is NOT a split condition: a volume
// callback returning per-frame values would otherwise splice the audio once
// per frame (integer-ms adelay quantization + amix overlap-summing = audible
// discontinuities). Instead each segment carries `volumes`, one value per
// frame, and planEncode expresses automation as a single in-ffmpeg gain
// envelope.
export function aggregateAudioSegments(audioByFrame) {
  const byId = new Map();
  for (const {frame, reports} of audioByFrame) {
    for (const r of reports) {
      if (!byId.has(r.id)) byId.set(r.id, []);
      byId.get(r.id).push({frame, ...r});
    }
  }

  const segments = [];
  for (const points of byId.values()) {
    points.sort((a, b) => a.frame - b.frame);
    let run = null;
    for (const p of points) {
      if (run && p.frame === run.endFrame + 1) {
        run.endFrame = p.frame;
        run.volumes.push(p.volume);
      } else {
        if (run) segments.push(run);
        run = {
          src: p.src,
          startFrame: p.frame,
          endFrame: p.frame,
          trimStart: p.mediaTime,
          volumes: [p.volume],
        };
      }
    }
    if (run) segments.push(run);
  }

  return segments.sort((a, b) => a.startFrame - b.startFrame);
}

// Build the volume filter token for a segment's per-frame gains. Constant runs
// get the plain scalar form; varying runs get a piecewise-constant expression
// evaluated per audio frame (`eval=frame`), in TELESCOPED step form:
//
//   gain(t) = v0 + Σ (v_k − v_{k−1})·gte(t, k/fps)
//
// Frame k of the segment occupies local time [k/fps, (k+1)/fps). Both edges of
// a step are inclusive (`gte`), but the deltas cancel exactly there, so each t
// has exactly one owning value — including timestamps that land precisely on a
// boundary. The form is flat on purpose: ffmpeg's expression parser rejects
// nested if() past ~90 levels (measured), which a per-frame fade outgrows;
// equal neighbours contribute no term at all.
// Returns e.g.
//   "volume=0.5"                                            (constant)
//   "volume=volume='0.90000000-0.10000000*gte(t,0.033333)':eval=frame"
export function volumeFilterToken(volumes, fps) {
  const distinct = new Set(volumes);
  if (distinct.size === 1) return `volume=${volumes[0]}`;
  let expr = volumes[0].toFixed(8);
  for (let k = 1; k < volumes.length; k++) {
    const d = volumes[k] - volumes[k - 1];
    if (Math.abs(d) < 1e-12) continue;
    expr += `${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(8)}*gte(t,${(k / fps).toFixed(6)})`;
  }
  return `volume=volume='${expr}':eval=frame`;
}

// Build ffmpeg args for a format. Returns null for formats that don't invoke
// ffmpeg (png-seq). Pure: no fs, no spawning, no side effects.
export function planEncode({
  format,
  codec = undefined,
  crf = '18',
  audioBitrate = '192k',
  fps,
  framesPattern,
  segments = [],
  assetPaths = [],
  out,
}) {
  if (format === 'png-seq') return null;

  const videoInput = ['-framerate', String(fps), '-start_number', '0', '-i', framesPattern];

  if (format === 'gif') {
    const filterGraph = `fps=${fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    return {
      args: ['-y', ...videoInput, '-filter_complex', filterGraph, out],
      dropsAudio: segments.length > 0,
    };
  }

  if (format === 'mp4' || format === 'webm') {
    const defaults = {
      mp4: {vc: 'libx264', ac: 'aac'},
      webm: {vc: 'libvpx-vp9', ac: 'libopus'},
    };
    const vc = codec ?? defaults[format].vc;
    const ac = defaults[format].ac;

    // mp4: +faststart moves the moov atom to the front so the file can start
    // playing before it has fully downloaded (progressive playback).
    const encodeArgs =
      format === 'webm'
        ? ['-c:v', vc, '-crf', String(crf), '-b:v', '0', '-pix_fmt', 'yuv420p']
        : ['-c:v', vc, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

    if (segments.length === 0) {
      return {args: ['-y', ...videoInput, ...encodeArgs, out], dropsAudio: false};
    }

    const inputArgs = [];
    const filters = [];
    segments.forEach((seg, k) => {
      inputArgs.push('-i', assetPaths[k]);
      const idx = k + 1;
      const dur = (seg.endFrame - seg.startFrame + 1) / fps;
      const delayMs = Math.round((seg.startFrame / fps) * 1000);
      filters.push(
        `[${idx}:a]atrim=start=${seg.trimStart.toFixed(6)}:duration=${dur.toFixed(6)},` +
          `asetpts=PTS-STARTPTS,${volumeFilterToken(seg.volumes, fps)},adelay=${delayMs}:all=1[s${k}]`,
      );
    });

    const outLabel =
      segments.length === 1
        ? '[s0]'
        : (filters.push(
            `${segments.map((_, k) => `[s${k}]`).join('')}amix=inputs=${segments.length}:normalize=0[aout]`,
          ),
          '[aout]');

    return {
      args: [
        '-y',
        ...videoInput,
        ...inputArgs,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '0:v',
        '-map',
        outLabel,
        ...encodeArgs,
        '-c:a',
        ac,
        '-b:a',
        audioBitrate,
        out,
      ],
      dropsAudio: false,
    };
  }

  throw new Error(`Unknown format: ${format}. Valid formats: mp4, webm, gif, png-seq.`);
}

// Resolve the output path for a render. Pure: the caller passes the parsed
// flags, this returns where to write, what directory must exist first, and an
// optional warning to print. `stillFrame` is null unless --still was passed.
//
// The mkdirTarget distinction is the subtle part: for png-seq, `out` IS the
// directory the PNGs land in and must itself exist; for every other mode
// `out` is a file and only its parent must exist.
export function planOutput({format, stillFrame = null, out = undefined}) {
  const still = stillFrame !== null;
  const extensions = {mp4: '.mp4', webm: '.webm', gif: '.gif'};

  let resolvedOut;
  let warning = null;
  if (out !== undefined) {
    resolvedOut = out;
    // --still writes a PNG regardless of `format` (which stays at its default —
    // --still and --format are mutually exclusive), so the format-extension
    // check only applies to real encode runs.
    if (still) {
      if (!out.endsWith('.png')) {
        warning = `--out extension is not .png: writing PNG content to ${out}`;
      }
    } else if (extensions[format] && !out.endsWith(extensions[format])) {
      warning = `--out extension does not match --format ${format}: writing ${format} content to ${out}`;
    }
  } else if (still) {
    resolvedOut = `out/still-${stillFrame}.png`;
  } else if (format === 'png-seq') {
    resolvedOut = 'out/frames';
  } else {
    resolvedOut = `out/video.${format}`;
  }

  const outIsDirectory = !still && format === 'png-seq';
  return {
    out: resolvedOut,
    mkdirTarget: outIsDirectory ? resolvedOut : dirname(resolvedOut),
    warning,
  };
}

// Split the frame range into contiguous chunks, one browser each.
export function planChunks(durationInFrames, requestedConcurrency) {
  const concurrency = Math.min(requestedConcurrency, durationInFrames);
  const perChunk = Math.ceil(durationInFrames / concurrency);
  const chunks = [];
  for (let s = 0; s < durationInFrames; s += perChunk) {
    chunks.push([s, Math.min(s + perChunk, durationInFrames)]);
  }
  return chunks;
}

// Distributed (Lambda-style) helpers — pure, testable.

// Chunk container per output format: chunks must be stream-copy-compatible
// with the final container (an H.264 chunk cannot live in a .webm — ffmpeg
// refuses at concat time, after every frame was already rendered). gif and
// png-seq never reach the distributed branch; the helper still guards.
const CHUNK_CONTAINERS = {mp4: '.mp4', webm: '.webm'};

export function chunkContainerFor(format) {
  const ext = CHUNK_CONTAINERS[format];
  if (!ext) {
    throw new Error(`--distributed does not support --format ${format}. Valid: mp4, webm.`);
  }
  return ext;
}

// Build ffmpeg args that encode one chunk's worth of frames (video-only) into
// a temporary file in the SAME container as the final output. The codec
// defaults mirror planEncode's per-format table so chunk and single-stitch
// encodes agree. The frames live in the shared framesDir under absolute names
// (frame-00000.png …), so -start_number tells ffmpeg where the chunk begins
// and -frames:v caps it.
export function planChunkVideoEncode({
  fps,
  crf = '18',
  codec,
  format = 'mp4',
  startFrame,
  frameCount,
  framesPattern,
  out,
}) {
  const vc = codec ?? {mp4: 'libx264', webm: 'libvpx-vp9'}[format];
  if (!vc) {
    throw new Error(`Unknown chunk format: ${format}. Valid formats: mp4, webm.`);
  }
  // libvpx-vp9 needs -b:v 0 for true constant-quality CRF mode — same args
  // planEncode uses for webm.
  const qualityArgs =
    format === 'webm' ? ['-crf', String(crf), '-b:v', '0'] : ['-crf', String(crf)];
  return [
    '-y',
    '-framerate',
    String(fps),
    '-start_number',
    String(startFrame),
    '-i',
    framesPattern,
    '-frames:v',
    String(frameCount),
    '-c:v',
    vc,
    ...qualityArgs,
    '-pix_fmt',
    'yuv420p',
    out,
  ];
}

// Build the concat demuxer list file content for a set of chunk video paths.
// Each line is `file 'absolute/path'` as required by `ffmpeg -f concat`.
export function buildConcatList(chunkPaths) {
  return chunkPaths.map((p) => `file '${p}'`).join('\n') + '\n';
}
