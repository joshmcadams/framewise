// Pure logic for scripts/render.mjs, extracted so it can be unit-tested.
// No side effects, no imports from puppeteer/vite — keep it that way.
import {join} from 'node:path';

// Read a `--name value` flag out of an argv-style array. Returns `fallback`
// when the flag is absent, or when it's present but has no following token.
export const readFlag = (args, name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Where composition asset URLs (e.g. "/bg.wav") resolve on disk. One place, so
// the renderer and any future staticFile() helper agree.
export const assetPath = (publicDir, src) => join(publicDir, src.replace(/^\//, ''));

// Parse composition ids out of a src/render/registry.ts-shaped source string.
export const parseRegistryIds = (registrySource) =>
  [...registrySource.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

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
