// On-demand frame extraction for <OffthreadVideo>.
//
// The component renders an <img> pointing at /__framewise_extract/…; this Vite
// plugin answers those requests by running ffmpeg once per (source, frame) and
// caching the PNG under the render's temp dir. Frames are extracted with the
// same half-frame nudge chapter 10 verified for live seeking, so both paths
// agree on which video frame a composition frame maps to.
//
// Pure helpers (parseExtractUrl, buildFfmpegArgs) are exported for unit tests;
// the middleware accepts an injected runner so tests never touch real ffmpeg.

import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {assetPath} from './render-lib.mjs';

const MOUNT = '/__framewise_extract';

/**
 * Parses '/<base64url(src)>/<frame>.png?fps=<n>' (the mount prefix is already
 * stripped by connect). Returns {src, frame, fps, cacheKey}.
 */
export function parseExtractUrl(url) {
  const [pathname, query = ''] = url.split('?');
  const match = /^\/([^/]+)\/(\d{1,6})\.png$/.exec(pathname);
  if (!match) {
    throw new Error(`Malformed extract URL: ${url}`);
  }

  // Buffer.from(…, 'base64url') never throws — invalid characters are skipped
  // silently — so there is nothing to catch here. A garbage key decodes to
  // garbage, which the root-relative check below rejects with a clear error.
  const src = Buffer.from(match[1], 'base64url').toString('utf8');
  if (!src.startsWith('/')) {
    throw new Error(`Decoded source must be a root-relative path like /clip.mp4, got "${src}"`);
  }

  const fps = Number(new URLSearchParams(query).get('fps'));
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Missing or invalid ?fps= on extract request: ${url}`);
  }

  const cacheKey = createHash('sha1').update(`${src}@${fps}`).digest('hex');
  return {src, frame: Number(match[2]), fps, cacheKey};
}

/**
 * Extract one frame. `-ss` before `-i` seeks by time (fast); ffmpeg then
 * presents the first frame whose PTS is at or after the timestamp, so seeking
 * to exactly `frame / fps` yields that frame.
 *
 * NOTE the contrast with <Video>'s live seek: there, currentTime = N/fps sits
 * on a presentation boundary (ambiguous — hence its half-frame nudge), while
 * here the boundary IS the selector, so we pass the exact start time instead.
 */
export function buildFfmpegArgs(seconds, input, output) {
  return ['-y', '-ss', String(seconds), '-i', input, '-frames:v', '1', '-q:v', '2', output];
}

function defaultRun(args) {
  return new Promise((resolve, reject) => {
    // resolveChromePath's sibling concern: ffmpeg is preflighted by render.mjs,
    // so a spawn failure here is a real error worth surfacing verbatim.
    const child = spawn('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      }
    });
  });
}

/** The Vite plugin. cacheDir lives under the render's temp frames dir. */
export function framewiseExtract({publicDir, cacheDir, run = defaultRun}) {
  const inflight = new Map();

  async function ensureExtracted({src, frame, fps, cacheKey}) {
    const input = assetPath(publicDir, src);
    const outDir = join(cacheDir, cacheKey);
    const outFile = join(outDir, `frame-${String(frame).padStart(5, '0')}.png`);

    // Disk cache hit from a previous request or render.
    try {
      await stat(outFile);
      return outFile;
    } catch {
      // not extracted yet
    }

    const existing = inflight.get(outFile);
    if (existing) {
      await existing;
      return outFile;
    }

    const job = (async () => {
      await mkdir(outDir, {recursive: true});
      // Seek to the frame's own start time: ffmpeg picks the first frame at
      // or after it (see buildFfmpegArgs).
      const seconds = frame / fps;
      await run(buildFfmpegArgs(seconds, input, outFile));
    })().finally(() => inflight.delete(outFile));

    inflight.set(outFile, job);
    await job;
    return outFile;
  }

  return {
    name: 'framewise-extract',
    configureServer(server) {
      server.middlewares.use(MOUNT, (req, res) => {
        // Returned so awaiting callers (tests) observe completion; connect
        // itself ignores the promise.
        return parseAndServe(req.url)
          .then((bytes) => {
            res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'no-store'});
            res.end(bytes);
          })
          .catch((e) => {
            res.writeHead(500, {'Content-Type': 'text/plain'});
            res.end(`framewise-extract: ${e.message}`);
          });

        async function parseAndServe(url) {
          try {
            const parsed = parseExtractUrl(url ?? '');
            const file = await ensureExtracted(parsed);
            return readFile(file);
          } catch (e) {
            throw new Error(`${e.message} (source: ${safeDecode(req?.url)})`, {cause: e});
          }
        }
      });
    },
  };
}

function safeDecode(url) {
  try {
    return parseExtractUrl(url ?? '').src;
  } catch {
    return url ?? '(none)';
  }
}
