// The renderer: React component -> headless-Chrome screenshots -> ffmpeg mp4.
//
// Stage 6 adds PARALLEL CHUNKED rendering: the frame range is split into chunks,
// each rendered by its own headless browser concurrently, all writing PNGs into
// one shared frames dir keyed by absolute frame number. A single ffmpeg pass
// then reassembles them in order. Because a frame is a pure function of its
// number, the output is identical regardless of how the work is split.
//
// Usage:  npm run render -- [--comp <id>] [--out <path.mp4>] [--no-wait]
//                           [--concurrency <N>]
//
// --no-wait      ignore delayRender (Stage 2 behaviour) to see async comps break.
// --concurrency  number of parallel browsers (default 4; 1 = sequential).

import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, mkdir, readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Identical for every browser (workers AND the config probe), so that a
// sequential-vs-parallel determinism check can't differ for flag reasons.
const LAUNCH_ARGS = ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'];
const DELAY_RENDER_TIMEOUT = 30_000;

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
  await server.listen();
  const port = server.httpServer.address().port;
  const url = `http://localhost:${port}/render.html${compId ? `?comp=${encodeURIComponent(compId)}` : ''}`;
  console.log(`▶ serving render page: ${url}`);

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

  if (segments.length === 0) {
    await run('ffmpeg', ['-y', ...videoInput, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  } else {
    const inputArgs = [];
    const filters = [];
    segments.forEach((seg, k) => {
      inputArgs.push('-i', join('public', seg.src.replace(/^\//, '')));
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
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
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
