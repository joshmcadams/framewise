// The renderer: React component -> headless-Chrome screenshots -> ffmpeg mp4.
//
// Stage 6 adds PARALLEL CHUNKED rendering: the frame range is split into chunks,
// each rendered by its own headless browser concurrently, all writing PNGs into
// one shared frames dir keyed by absolute frame number. A single ffmpeg pass
// then reassembles them in order. Because a frame is a pure function of its
// number, the output is identical regardless of how the work is split.
//
// Usage:  npm run render -- [--comp <id>] [--out <path.mp4>] [--no-wait]
//                           [--concurrency <N>] [--props <json>]
//                           [--crf <n>] [--codec <name>] [--audio-bitrate <k>]
//                           [--public-dir <path>] [--chrome <path>] [--list]
//
// --list           print available composition IDs and exit (no Chrome needed).
// --no-wait        ignore delayRender (Stage 2 behaviour) to see async comps break.
// --concurrency    number of parallel browsers (default 4; 1 = sequential).
// --props          JSON object merged over the composition's defaultProps.
// --crf            x264/x265 quality (default 18; lower = better/larger).
// --codec          video codec (default libx264).
// --audio-bitrate  AAC bitrate when there's audio (default 192k).
// --public-dir     base dir for composition asset URLs (default public).
// --chrome         path to a Chrome/Chromium binary (else auto-detected).

import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, mkdir, readFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir, platform} from 'node:os';
import {join, dirname, delimiter} from 'node:path';
import {DEFAULT_DELAY_RENDER_TIMEOUT, RENDERER_TIMEOUT_MARGIN_MS} from '../src/framewise-lite/delay-render-defaults.mjs';

// Identical for every browser (workers AND the config probe), so that a
// sequential-vs-parallel determinism check can't differ for flag reasons.
const LAUNCH_ARGS = ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'];
// Strictly longer than DEFAULT_DELAY_RENDER_TIMEOUT so the in-app console.error
// (which names the stuck handle's label) fires before Puppeteer's backstop throws
// a generic TimeoutError. Both constants come from delay-render-defaults.mjs —
// single source of truth, no second literal.
const DELAY_RENDER_TIMEOUT = DEFAULT_DELAY_RENDER_TIMEOUT + RENDERER_TIMEOUT_MARGIN_MS;

// --- arg parsing ---------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const compId = flag('comp', '');
const out = flag('out', 'out/video.mp4');
const noWait = args.includes('--no-wait');
const requestedConcurrency = Math.max(1, parseInt(flag('concurrency', '4'), 10) || 4);

// Encode settings (defaults reproduce the previous hardcoded behaviour, plus an
// explicit CRF). Identical across all workers — only the final ffmpeg pass uses
// them, so they can't affect per-frame determinism.
const crf = flag('crf', '18');
const codec = flag('codec', 'libx264');
const audioBitrate = flag('audio-bitrate', '192k');

// Where composition asset URLs (e.g. "/bg.wav") resolve on disk. One place, so
// the renderer and any future staticFile() helper agree.
const publicDir = flag('public-dir', 'public');
const assetPath = (src) => join(publicDir, src.replace(/^\//, ''));

// Optional CLI props, merged over the composition's defaultProps in the browser.
// Validate up front so a typo fails immediately, not after a full render.
const propsArg = flag('props', '');
let inputProps = null;
if (propsArg) {
  try {
    inputProps = JSON.parse(propsArg);
  } catch (e) {
    throw new Error(`--props must be valid JSON: ${e.message}`);
  }
  if (typeof inputProps !== 'object' || inputProps === null || Array.isArray(inputProps)) {
    throw new Error(`--props must be a JSON object, e.g. '{"title":"Hi"}'`);
  }
}

// --list: print registered composition IDs without requiring Chrome or ffmpeg.
// Reads src/render/registry.ts statically, so it works even if nothing is installed.
if (args.includes('--list')) {
  const registryPath = new URL('../src/render/registry.ts', import.meta.url);
  const src = await readFile(registryPath, 'utf8');
  const ids = [...src.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (ids.length === 0) {
    process.stderr.write('Could not parse composition IDs from src/render/registry.ts\n');
    process.exit(1);
  }
  for (const id of ids) console.log(id);
  process.exit(0);
}

// puppeteer-core ships no browser, so we must point it at a system Chrome/
// Chromium. Resolve it cross-platform: explicit --chrome flag, then env vars,
// then well-known per-OS locations. Fail loudly with an actionable message
// rather than letting puppeteer throw a raw spawn ENOENT mid-render.
function resolveChromePath() {
  const explicit =
    flag('chrome', '') ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`Chrome not found at the path you provided: ${explicit}`);
    }
    return explicit;
  }

  // Resolve a bare command name (e.g. "google-chrome") against PATH.
  const onPath = (cmd) => {
    for (const dir of (process.env.PATH || '').split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, cmd);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  const os = platform();
  const candidates =
    os === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : os === 'win32'
        ? [
            process.env.PROGRAMFILES,
            process.env['PROGRAMFILES(X86)'],
            process.env.LOCALAPPDATA,
          ]
            .filter(Boolean)
            .map((base) => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
        : // linux & friends: prefer PATH lookups, then common absolute paths.
          [
            onPath('google-chrome'),
            onPath('google-chrome-stable'),
            onPath('chromium'),
            onPath('chromium-browser'),
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ].filter(Boolean);

  const found = candidates.find((p) => p && existsSync(p));
  if (found) return found;

  throw new Error(
    `Could not find Google Chrome or Chromium on this system (${os}).\n` +
      `Install Chrome/Chromium, or set CHROME_PATH (or PUPPETEER_EXECUTABLE_PATH),\n` +
      `or pass --chrome <path-to-executable>.`,
  );
}

const CHROME = resolveChromePath();

// --- helpers -------------------------------------------------------------
function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

// Fail fast if ffmpeg is missing, before spending minutes rendering frames we'd
// be unable to stitch. (Chrome is already validated by resolveChromePath at
// module load.)
async function assertFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error(
        'ffmpeg was not found on your PATH. Install it (https://ffmpeg.org/download.html) and try again.',
      );
    }
    throw new Error(`ffmpeg preflight failed: ${e.message}`);
  }
}

// Turn per-frame audio reports into contiguous segments. Keyed by the <Audio>'s
// stable instance id (so the same file used twice yields two segments), and
// split whenever the active frames have a gap.
function aggregateAudioSegments(audioByFrame) {
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

// Read the static composition metadata from a throwaway page.
async function probeConfig(url) {
  const browser = await puppeteer.launch({executablePath: CHROME, headless: true, args: LAUNCH_ARGS});
  try {
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'load'});
    await page.waitForFunction(() => Boolean(window.framewiseLite?.config));
    return await page.evaluate(() => window.framewiseLite.config);
  } finally {
    await browser.close();
  }
}

// Render one contiguous chunk [startFrame, endFrame) in its own browser. Returns
// the chunk's audio reports. Owns its browser so a failure can't leak it.
async function renderChunk(url, startFrame, endFrame, {width, height, fps, framesDir, label}) {
  const browser = await puppeteer.launch({executablePath: CHROME, headless: true, args: LAUNCH_ARGS});
  try {
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'load'});
    await page.waitForFunction(() => Boolean(window.framewiseLite?.config));
    await page.setViewport({width, height, deviceScaleFactor: 1});
    const rootHandle = await page.$('#render-root');
    await page.evaluate(() => document.fonts.ready);

    const audioByFrame = [];
    for (let f = startFrame; f < endFrame; f++) {
      await page.evaluate((frame) => window.framewiseLite.renderFrame(frame), f);

      if (!noWait) {
        await page
          .waitForFunction(() => window.framewiseLite.getPending().length === 0, {timeout: DELAY_RENDER_TIMEOUT})
          .catch(async () => {
            const stuck = await page.evaluate(() => window.framewiseLite.getPending());
            throw new Error(`delayRender timeout at frame ${f}; pending: ${JSON.stringify(stuck)}`);
          });
      }

      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      const pendingAtCapture = await page.evaluate(() => window.framewiseLite.getPending().map((p) => p.label));
      const reports = await page.evaluate(() => window.framewiseLite.getAudioFrame());
      if (reports.length) audioByFrame.push({frame: f, reports});

      await rootHandle.screenshot({path: join(framesDir, `frame-${String(f).padStart(5, '0')}.png`)});

      if (pendingAtCapture.length) {
        console.log(`  · [${label}] frame ${f} pending at capture: [${pendingAtCapture.join(', ')}]`);
      }

      // Progress: log on the first frame, every 10th, and the last.
      const done = f - startFrame + 1;
      const total = endFrame - startFrame;
      if (done === 1 || done % 10 === 0 || done === total) {
        const pct = Math.round((done / total) * 100);
        console.log(`  [${label}] ${done}/${total} frames (${pct}%)`);
      }
    }
    return audioByFrame;
  } finally {
    await browser.close();
  }
}

// --- render --------------------------------------------------------------
const server = await createServer({server: {port: 0}, logLevel: 'warn'});
const framesDir = await mkdtemp(join(tmpdir(), 'framewise-lite-'));
const started = Date.now();

try {
  await assertFfmpeg();

  await server.listen();
  const port = server.httpServer.address().port;
  const query = new URLSearchParams();
  if (compId) query.set('comp', compId);
  if (inputProps) query.set('props', JSON.stringify(inputProps));
  const qs = query.toString();
  const url = `http://localhost:${port}/render.html${qs ? `?${qs}` : ''}`;
  console.log(`▶ serving render page: ${url}`);
  if (inputProps) console.log(`▶ input props: ${JSON.stringify(inputProps)}`);

  const config = await probeConfig(url);
  const {width, height, fps, durationInFrames} = config;
  console.log(`▶ composition: ${width}x${height} @ ${fps}fps · ${durationInFrames} frames`);
  console.log(noWait ? '⚠ --no-wait: ignoring delayRender (Stage 2 behaviour)' : '▶ waiting for delayRender handles each frame');

  // Split the frame range into contiguous chunks, one browser each.
  const concurrency = Math.min(requestedConcurrency, durationInFrames);
  const perChunk = Math.ceil(durationInFrames / concurrency);
  const chunks = [];
  for (let s = 0; s < durationInFrames; s += perChunk) {
    chunks.push([s, Math.min(s + perChunk, durationInFrames)]);
  }
  console.log(`▶ rendering across ${chunks.length} worker(s): ${chunks.map(([s, e]) => `[${s},${e})`).join(' ')}`);

  const renderStart = Date.now();
  const results = await Promise.allSettled(
    chunks.map(([s, e], i) => renderChunk(url, s, e, {width, height, fps, framesDir, label: `w${i}`})),
  );
  const renderSecs = ((Date.now() - renderStart) / 1000).toFixed(1);

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    throw new Error(`${failures.length} chunk(s) failed:\n` + failures.map((f) => '  ' + f.reason.message).join('\n'));
  }
  console.log(`▶ rendered ${durationInFrames} frames in ${renderSecs}s (concurrency ${chunks.length})`);

  // Determinism + integrity: every frame present, and a stable hash of the set.
  const files = (await readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
  if (files.length !== durationInFrames) {
    throw new Error(`expected ${durationInFrames} frames but found ${files.length} — chunk range bug?`);
  }
  const hash = createHash('sha256');
  for (const f of files) hash.update(await readFile(join(framesDir, f)));
  console.log(`▶ frames: ${files.length} · sha256 ${hash.digest('hex').slice(0, 16)}`);

  // Merge each chunk's audio reports and aggregate into segments.
  const audioByFrame = results.flatMap((r) => r.value);
  const segments = aggregateAudioSegments(audioByFrame);
  if (segments.length) {
    console.log(`▶ audio: ${segments.length} segment(s)`);
    for (const s of segments) {
      console.log(
        `  · ${s.src}  frames ${s.startFrame}–${s.endFrame}  @${(s.startFrame / fps).toFixed(2)}s  trim ${s.trimStart.toFixed(2)}s  vol ${s.volume}`,
      );
    }
  }

  // Stitch PNGs -> mp4; mix any audio segments in via filter_complex.
  await mkdir(dirname(out), {recursive: true});
  const videoInput = ['-framerate', String(fps), '-start_number', '0', '-i', join(framesDir, 'frame-%05d.png')];
  // Shared encode settings so the two ffmpeg branches stay in sync.
  const videoEncodeArgs = ['-c:v', codec, '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  console.log(`▶ encode: ${codec} crf ${crf}${segments.length ? ` · audio aac ${audioBitrate}` : ''}`);

  if (segments.length === 0) {
    await run('ffmpeg', ['-y', ...videoInput, ...videoEncodeArgs, out]);
  } else {
    const inputArgs = [];
    const filters = [];
    segments.forEach((seg, k) => {
      inputArgs.push('-i', assetPath(seg.src));
      const idx = k + 1;
      const dur = (seg.endFrame - seg.startFrame + 1) / fps;
      const delayMs = Math.round((seg.startFrame / fps) * 1000);
      filters.push(
        `[${idx}:a]atrim=start=${seg.trimStart.toFixed(6)}:duration=${dur.toFixed(6)},` +
          `asetpts=PTS-STARTPTS,volume=${seg.volume},adelay=${delayMs}:all=1[s${k}]`,
      );
    });

    const outLabel =
      segments.length === 1
        ? '[s0]'
        : (filters.push(`${segments.map((_, k) => `[s${k}]`).join('')}amix=inputs=${segments.length}:normalize=0[aout]`), '[aout]');

    await run('ffmpeg', [
      '-y', ...videoInput, ...inputArgs,
      '-filter_complex', filters.join(';'),
      '-map', '0:v', '-map', outLabel,
      ...videoEncodeArgs,
      '-c:a', 'aac', '-b:a', audioBitrate,
      out,
    ]);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`✔ wrote ${out} in ${secs}s total`);
} finally {
  // Workers own and close their own browsers; here we only tear down shared
  // resources, and only after Promise.allSettled above has resolved.
  await server.close();
  await rm(framesDir, {recursive: true, force: true});
}
