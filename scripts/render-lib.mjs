// Pure logic for scripts/render.mjs, extracted so it can be unit-tested.
// No side effects, no imports from puppeteer/vite — keep it that way.
import {join} from 'node:path';

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
// the renderer and any future staticFile() helper agree.
export const assetPath = (publicDir, src) => join(publicDir, src.replace(/^\//, ''));

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
export const hasEncoderToken = (encodersOutput, codec) => encodersOutput.split(/\s+/).includes(codec);

// Turn per-frame audio reports into contiguous segments. Keyed by the <Audio>'s
// stable instance id (so the same file used twice yields two segments), and
// split whenever the active frames have a gap.
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
      } else {
        if (run) segments.push(run);
        run = {
          src: p.src,
          startFrame: p.frame,
          endFrame: p.frame,
          trimStart: p.mediaTime,
          volume: p.volume,
        };
      }
    }
    if (run) segments.push(run);
  }

  return segments.sort((a, b) => a.startFrame - b.startFrame);
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
