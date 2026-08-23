// The renderer: React component -> headless-Chrome screenshots -> ffmpeg mp4.
//
// Stage 6 adds PARALLEL CHUNKED rendering: the frame range is split into chunks,
// each rendered by its own headless browser concurrently, all writing PNGs into
// one shared frames dir keyed by absolute frame number. A single ffmpeg pass
// then reassembles them in order. Because a frame is a pure function of its
// number, the output is identical regardless of how the work is split.
//
// Usage:  npm run render -- [--comp <id>] [--out <path>] [--no-wait]
//                           [--concurrency <N>] [--props <json>]
//                           [--crf <n>] [--codec <name>] [--audio-bitrate <k>]
//                           [--public-dir <path>] [--chrome <path>] [--list]
//                           [--format mp4|webm|gif|png-seq] [--still <frame>]
//                           [--distributed]  (Lambda-style: chunk-encode + concat)
//
// --list           print available composition IDs and exit (no Chrome needed).
// --no-wait        ignore delayRender (Stage 2 behaviour) to see async comps break.
// --concurrency    number of parallel browsers (default 4; 1 = sequential).
// --props          JSON object merged over the composition's defaultProps.
// --crf            x264/x265/VP9 quality (default 18; lower = better/larger).
// --codec          video codec (overrides the format default).
// --audio-bitrate  audio bitrate (default 192k; aac for mp4, libopus for webm).
// --public-dir     base dir for composition asset URLs (default public).
// --chrome         path to a Chrome/Chromium binary (else auto-detected).
// --no-sandbox     disable Chrome's sandbox (only for root/containers where it cannot start).
// --format         output format: mp4 (default), webm, gif, or png-seq (skips ffmpeg).
// --still          render a single frame as a PNG; mutually exclusive with --format/--concurrency.

import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, mkdir, readFile, readdir, copyFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir, platform} from 'node:os';
import {join, delimiter} from 'node:path';
import {
  DEFAULT_DELAY_RENDER_TIMEOUT,
  RENDERER_TIMEOUT_MARGIN_MS,
} from '../src/framewise-lite/delay-render-defaults.mjs';
import {
  readFlag,
  assetPath as assetPathIn,
  aggregateAudioSegments,
  planChunks,
  parseRegistryIds,
  hasEncoderToken,
  planEncode,
  planOutput,
  planChunkVideoEncode,
  buildConcatList,
} from './render-lib.mjs';
import {framewiseExtract} from './offthread-server.mjs';

// Sandbox policy: keep Chrome's OS sandbox ON by default. It only has to be
// disabled where it cannot start — running as root (common in containers/CI).
// Explicit --no-sandbox opts out; running as root falls back with a warning.
// Args stay identical for every browser (workers AND the config probe), so a
// sequential-vs-parallel determinism check can't differ for flag reasons.
const disableSandbox =
  process.argv.includes('--no-sandbox') ||
  (typeof process.getuid === 'function' && process.getuid() === 0);
if (disableSandbox) {
  console.warn('⚠ launching Chrome with --no-sandbox (explicit flag or running as root)');
}
const LAUNCH_ARGS = [
  ...(disableSandbox ? ['--no-sandbox'] : []),
  '--hide-scrollbars',
  '--force-color-profile=srgb',
];
// Strictly longer than DEFAULT_DELAY_RENDER_TIMEOUT so the in-app console.error
// (which names the stuck handle's label) fires before Puppeteer's backstop throws
// a generic TimeoutError. Both constants come from delay-render-defaults.mjs —
// single source of truth, no second literal.
const DELAY_RENDER_TIMEOUT = DEFAULT_DELAY_RENDER_TIMEOUT + RENDERER_TIMEOUT_MARGIN_MS;

// --- arg parsing ---------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback) => readFlag(args, name, fallback);
const compId = flag('comp', '');
const noWait = args.includes('--no-wait');

// --format: validate against the four values
const formatRaw = flag('format', undefined);
const format = formatRaw ?? 'mp4';
const formatExplicit = formatRaw !== undefined;
const VALID_FORMATS = ['mp4', 'webm', 'gif', 'png-seq'];
if (!VALID_FORMATS.includes(format)) {
  throw new Error(`Unknown format: ${format}. Valid formats: ${VALID_FORMATS.join(', ')}.`);
}

// --still: integer frame number
const stillRaw = flag('still', undefined);
const stillFrame = stillRaw !== undefined ? parseInt(stillRaw, 10) : null;
const stillExplicit = stillRaw !== undefined;
if (stillExplicit && (Number.isNaN(stillFrame) || stillFrame < 0)) {
  throw new Error(`--still must be a non-negative integer frame number, got: ${stillRaw}`);
}

// --still is mutually exclusive with explicit --format and --concurrency
if (stillExplicit && formatExplicit) {
  throw new Error('--still is mutually exclusive with --format.');
}
const concurrencyRaw = flag('concurrency', undefined);
const concurrencyExplicit = concurrencyRaw !== undefined;
if (stillExplicit && concurrencyExplicit) {
  throw new Error('--still is mutually exclusive with --concurrency.');
}
const requestedConcurrency = Math.max(1, parseInt(concurrencyRaw ?? '4', 10) || 4);

const distributed = args.includes('--distributed');
if (distributed && stillExplicit) {
  throw new Error('--distributed is mutually exclusive with --still.');
}
if (distributed && format === 'png-seq') {
  throw new Error('--distributed has no effect with --format png-seq (no stitching).');
}
if (distributed && requestedConcurrency < 2) {
  throw new Error('--distributed requires --concurrency 2 or higher.');
}

// Encode settings. gif has neither a CRF knob nor a codec choice (palette
// filter encode), so passing them there is a mistake worth flagging.
const crfRaw = flag('crf', undefined);
const crf = crfRaw ?? '18';
const codec = flag('codec', undefined);
const audioBitrate = flag('audio-bitrate', '192k');
if (format === 'gif' && (crfRaw !== undefined || codec !== undefined)) {
  console.warn('⚠ --crf/--codec have no effect with --format gif (palette encode); ignoring');
}

// Output path: format-aware default, extension sanity warning, and the
// mkdir target (png-seq's --out is a directory). Pure + unit-tested in
// render-lib.mjs.
const outputPlan = planOutput({
  format,
  stillFrame: stillExplicit ? stillFrame : null,
  out: flag('out', undefined),
});
if (outputPlan.warning) console.warn(`⚠ ${outputPlan.warning}`);
const out = outputPlan.out;

// Where composition asset URLs (e.g. "/bg.wav") resolve on disk. One place, so
// the renderer and any future staticFile() helper agree.
const publicDir = flag('public-dir', 'public');
const assetPath = (src) => assetPathIn(publicDir, src);

// Optional CLI props, merged over the composition's defaultProps in the browser.
// Validate up front so a typo fails immediately, not after a full render.
const propsArg = flag('props', '');
let inputProps = null;
if (propsArg) {
  try {
    inputProps = JSON.parse(propsArg);
  } catch (e) {
    throw new Error(`--props must be valid JSON: ${e.message}`, {cause: e});
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
  const ids = parseRegistryIds(src);
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
    flag('chrome', '') || process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
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
        ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
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
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

// Like run(), but resolves with stdout instead of discarding it.
function runCapture(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

// Fail fast if ffmpeg is missing, or the requested codec isn't one of its
// encoders, before spending minutes rendering frames we'd be unable to stitch
// (or would stitch with the wrong codec). (Chrome is already validated by
// resolveChromePath at module load.)
async function assertFfmpeg(codec) {
  try {
    await run('ffmpeg', ['-version']);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error(
        'ffmpeg was not found on your PATH. Install it (https://ffmpeg.org/download.html) and try again.',
        {cause: e},
      );
    }
    throw new Error(`ffmpeg preflight failed: ${e.message}`, {cause: e});
  }

  const encoders = await runCapture('ffmpeg', ['-hide_banner', '-encoders']);
  if (!hasEncoderToken(encoders, codec)) {
    throw new Error(
      `--codec ${codec}: not found in \`ffmpeg -encoders\` output. Check the spelling, or run \`ffmpeg -encoders\` to see what your build supports.`,
    );
  }
}

// Browsers currently open (tracked so a signal handler can kill them — see
// `cleanup()` below). puppeteer.launch() installs its own SIGINT/SIGTERM/
// SIGHUP handler by default that kills the child Chrome and then calls
// `process.exit()` *synchronously*, in the same signal-emit tick, without
// awaiting anything. Node runs same-signal listeners in registration order,
// so once any browser is launched, that handler runs right after ours and
// terminates the process before our async cleanup() (server.close()/rm())
// gets a turn to do anything — the temp frames dir leaks anyway, just later
// in the run than before. We disable puppeteer's own handling below on
// every launch() call and take over both responsibilities (killing the
// browser AND tearing down shared resources) in one place: `cleanup()`.
const liveBrowsers = new Set();

// Open a worker: launch a browser, load the render page, wait for the app.
// Returns {browser, page} — registered in liveBrowsers so cleanup owns it.
// Viewport/fonts are applied separately (applyViewport) because the FIRST
// worker is opened before the composition's dimensions are probed.
async function openWorker(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: LAUNCH_ARGS,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch (e) {
    if (!disableSandbox) {
      throw new Error(
        `Chrome failed to launch: ${e.message}\n` +
          `If you are in a container or otherwise cannot use Chrome's sandbox, retry with --no-sandbox.`,
        {cause: e},
      );
    }
    throw e;
  }
  liveBrowsers.add(browser);
  try {
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'load'});
    // Ready means metadata resolved OR definitively failed (fast, named error).
    await page.waitForFunction(() =>
      Boolean(
        window.framewiseLite && (window.framewiseLite.config || window.framewiseLite.configError),
      ),
    );
    return {browser, page};
  } catch (e) {
    liveBrowsers.delete(browser);
    try {
      await browser.close();
    } catch {
      // best-effort — the original error matters more
    }
    throw e;
  }
}

// Size the page to the composition box and wait for fonts, exactly as the
// pre-perf-trio code did between page load and the frame loop.
async function applyViewport(page, {width, height}) {
  await page.setViewport({width, height, deviceScaleFactor: 1});
  await page.evaluate(() => document.fonts.ready);
}

// Render one contiguous chunk [startFrame, endFrame) on an already-open page.
// Returns the chunk's audio reports. The caller owns closing the browser.
async function renderFrames(page, startFrame, endFrame, {framesDir, label}) {
  const rootHandle = await page.$('#render-root');

  const audioByFrame = [];
  for (let f = startFrame; f < endFrame; f++) {
    // ONE round trip per frame: render, block until delayRender drains (or
    // timeout with the stuck handles named), wait for paint, then read both
    // the at-capture pending labels and this frame's audio reports.
    const {pendingAtCapture, reports} = await page.evaluate(
      async ({frame, wait, timeoutMs}) => {
        const fw = window.framewiseLite;
        fw.renderFrame(frame);
        if (wait) {
          await fw.waitForPendingEmpty(timeoutMs).catch((e) => {
            throw new Error(`delayRender timeout at frame ${frame}; pending: ${e.message}`);
          });
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          pendingAtCapture: fw.getPending().map((p) => p.label),
          reports: fw.getAudioFrame(),
        };
      },
      {frame: f, wait: !noWait, timeoutMs: DELAY_RENDER_TIMEOUT},
    );

    if (reports.length) audioByFrame.push({frame: f, reports});

    await rootHandle.screenshot({
      path: join(framesDir, `frame-${String(f).padStart(5, '0')}.png`),
    });

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
}

// Full worker lifecycle: open (or adopt an already-open browser), size it,
// render its chunk, close. `adopted` lets the FIRST worker reuse the probe's
// browser so no separate browser is ever launched just to read metadata.
async function renderChunk(url, startFrame, endFrame, opts) {
  const worker = opts?.adopted ?? (await openWorker(url));
  try {
    if (!opts?.adopted) {
      await applyViewport(worker.page, opts.viewport);
    }
    return await renderFrames(worker.page, startFrame, endFrame, opts);
  } finally {
    liveBrowsers.delete(worker.browser);
    await worker.browser.close();
  }
}

// Read composition metadata through an existing page (no dedicated probe
// browser). Kept as a function of a page so callers decide ownership.
async function readConfigFromPage(page) {
  const error = await page.evaluate(() => window.framewiseLite?.configError);
  if (error) {
    throw new Error(error);
  }
  return page.evaluate(() => window.framewiseLite.config);
}

// --- render --------------------------------------------------------------
// Vite's createServer() unconditionally registers its own `process.once('SIGTERM', ...)`
// handler (gated only by `middlewareMode`, which we don't set) that awaits
// `server.close()` then calls `process.exit()` — the same race shape as
// puppeteer's signal handlers above. It's registered here, before our own
// handler loop below, and its chain is shorter (no browser-kill, no
// rm(framesDir)), so on SIGTERM it reliably wins and exits the process
// before our cleanup() ever reaches rm(framesDir). Diff the process's
// SIGTERM listeners before/after createServer() and remove whatever it just
// added, so our handler (registered right after) ends up the sole SIGTERM
// authority — mirroring how `handleSIGTERM: false` makes us the sole
// authority for puppeteer above. (Vite registers nothing for SIGINT or
// SIGHUP, so those two are unaffected by this.)
const sigtermListenersBeforeVite = new Set(process.listeners('SIGTERM'));
// The frames dir must exist before the server starts: <OffthreadVideo>'s
// extraction endpoint caches its PNGs under it (cleanup below already removes
// the whole dir, so nothing new can leak).
const framesDir = await mkdtemp(join(tmpdir(), 'framewise-lite-'));
const server = await createServer({
  server: {port: 0},
  logLevel: 'warn',
  plugins: [framewiseExtract({publicDir, cacheDir: join(framesDir, 'offthread')})],
});
for (const listener of process.listeners('SIGTERM')) {
  if (!sigtermListenersBeforeVite.has(listener)) {
    process.removeListener('SIGTERM', listener);
  }
}
const started = Date.now();

// Fault-isolated, idempotent teardown. Under normal completion, workers have
// already closed their own browsers (renderChunk's own finally,
// which also removes them from liveBrowsers) by the time this runs — but if
// a signal cuts the run short mid-render, a browser can still be in
// liveBrowsers here, so we take responsibility for it: force-kill rather
// than a graceful browser.close(), since we've disabled puppeteer's own
// signal handling (see liveBrowsers above) and want a bounded, fast exit
// rather than waiting on a CDP round-trip to a browser that may be wedged
// or mid-render. Every step is individually guarded so one failing (e.g.
// server.close()) can't prevent the others (e.g. removing the temp frames
// dir) from running, on the normal finally path AND when a signal cuts the
// run short.
let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const browser of liveBrowsers) {
    try {
      browser.process()?.kill('SIGKILL');
    } catch (e) {
      console.error(`cleanup: killing browser process failed: ${e.message}`);
    }
  }
  try {
    await server.close();
  } catch (e) {
    console.error(`cleanup: server.close failed: ${e.message}`);
  }
  try {
    await rm(framesDir, {recursive: true, force: true});
  } catch (e) {
    console.error(`cleanup: rm frames dir failed: ${e.message}`);
  }
}
// Node's default signal handling terminates without running our `finally`,
// leaking the temp frames dir (and leaving the Vite server's socket open
// until process exit). Registered here — after the --list block has already
// exited — because `server`/`framesDir` must exist first. Includes SIGHUP:
// we disabled puppeteer's own handleSIGHUP above (same race as SIGINT/
// SIGTERM), so we must be the one to own it too, or a dropped
// terminal/SSH session mid-render would leak the temp dir AND orphan Chrome
// (Node's default SIGHUP action is an immediate terminate — it runs neither
// this handler nor puppeteer's disabled one).
for (const [sig, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]) {
  process.on(sig, () => {
    void cleanup().finally(() => process.exit(code));
  });
}

try {
  // Skip ffmpeg preflight entirely for still and png-seq (no ffmpeg needed).
  // For mp4/webm, verify the effective codec. For gif, verify ffmpeg exists
  // but don't check a specific codec (gif uses the palette filter).
  if (!stillExplicit && format !== 'png-seq') {
    const effectiveCodec = codec ?? {mp4: 'libx264', webm: 'libvpx-vp9', gif: null}[format];
    if (effectiveCodec) {
      await assertFfmpeg(effectiveCodec);
    } else {
      // gif: only verify ffmpeg is on PATH
      await run('ffmpeg', ['-version']);
    }
  }

  await server.listen();
  const port = server.httpServer.address().port;
  const query = new URLSearchParams();
  if (compId) query.set('comp', compId);
  if (inputProps) query.set('props', JSON.stringify(inputProps));
  const qs = query.toString();
  const url = `http://localhost:${port}/render.html${qs ? `?${qs}` : ''}`;
  console.log(`▶ serving render page: ${url}`);
  if (inputProps) console.log(`▶ input props: ${JSON.stringify(inputProps)}`);

  // Probe through a browser we'll KEEP: this first worker reads the metadata,
  // then renders chunk 0 on the same page — no throwaway probe launch.
  const primary = await openWorker(url);
  const config = await readConfigFromPage(primary.page);
  const {width, height, fps, durationInFrames} = config;
  console.log(`▶ composition: ${width}x${height} @ ${fps}fps · ${durationInFrames} frames`);

  // Validate still frame against the composition range.
  if (stillExplicit && stillFrame >= durationInFrames) {
    throw new Error(
      `--still ${stillFrame}: out of range (composition has ${durationInFrames} frames, valid range is 0–${durationInFrames - 1}).`,
    );
  }

  console.log(
    noWait
      ? '⚠ --no-wait: ignoring delayRender (Stage 2 behaviour)'
      : '▶ waiting for delayRender handles each frame',
  );

  // Split the frame range into contiguous chunks, one browser each.
  // For --still, we render exactly one frame.
  const chunks = stillExplicit
    ? [[stillFrame, stillFrame + 1]]
    : planChunks(durationInFrames, requestedConcurrency);
  console.log(
    `▶ rendering across ${chunks.length} worker(s): ${chunks.map(([s, e]) => `[${s},${e})`).join(' ')}`,
  );

  const renderStart = Date.now();
  const results = await Promise.allSettled(
    chunks.map(([s, e], i) =>
      i === 0
        ? // First worker reuses the probe's already-open page.
          (async () => {
            await applyViewport(primary.page, config);
            try {
              return await renderFrames(primary.page, s, e, {
                width,
                height,
                fps,
                framesDir,
                label: 'w0',
              });
            } finally {
              liveBrowsers.delete(primary.browser);
              await primary.browser.close();
            }
          })()
        : renderChunk(url, s, e, {
            width,
            height,
            fps,
            framesDir,
            label: `w${i}`,
            viewport: config,
          }),
    ),
  );
  const renderSecs = ((Date.now() - renderStart) / 1000).toFixed(1);

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    throw new Error(
      `${failures.length} chunk(s) failed:\n` +
        failures.map((f) => '  ' + f.reason.message).join('\n'),
    );
  }
  console.log(
    `▶ rendered ${durationInFrames} frames in ${renderSecs}s (concurrency ${chunks.length})`,
  );

  // Determinism + integrity: verify frame count and hash the set.
  const expectedFrames = stillExplicit ? 1 : durationInFrames;
  const files = (await readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
  if (files.length !== expectedFrames) {
    throw new Error(
      `expected ${expectedFrames} frames but found ${files.length} — chunk range bug?`,
    );
  }
  const hash = createHash('sha256');
  for (const f of files) hash.update(await readFile(join(framesDir, f)));
  console.log(`▶ frames: ${files.length} · sha256 ${hash.digest('hex').slice(0, 16)}`);

  // --- output --------------------------------------------------------------
  await mkdir(outputPlan.mkdirTarget, {recursive: true});

  if (stillExplicit) {
    // Copy the single rendered PNG to the output path.
    const srcFile = join(framesDir, files[0]);
    await copyFile(srcFile, out);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✔ wrote ${out} in ${secs}s total`);
  } else if (format === 'png-seq') {
    // Copy all PNGs to the output directory.
    for (const f of files) {
      await copyFile(join(framesDir, f), join(out, f));
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✔ wrote ${files.length} PNGs to ${out} in ${secs}s total`);
  } else {
    // Audio: aggregate only for encode formats.
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

    // Distributed (Lambda-style): each chunk encodes its frames to a video,
    // then a final concat stitches them. Educational simulation on one machine.
    const canDistribute = distributed && segments.length === 0 && format !== 'gif';
    if (distributed && !canDistribute) {
      if (segments.length > 0) {
        console.warn(
          '⚠ --distributed with audio: chunk-encode is video-only in this simulation — falling back to single-stitch for this render',
        );
      } else if (format === 'gif') {
        console.warn('⚠ --distributed with gif: falling back to single-stitch');
      }
    }

    if (canDistribute) {
      console.log(`▶ distributed: encoding ${chunks.length} chunk videos, then concatenating`);
      const chunkPaths = [];
      const framesPattern = join(framesDir, 'frame-%05d.png');
      for (let i = 0; i < chunks.length; i++) {
        const [s, e] = chunks[i];
        const chunkOut = join(framesDir, `chunk-${i}.mp4`);
        chunkPaths.push(chunkOut);
        const chunkArgs = planChunkVideoEncode({
          fps,
          crf,
          codec,
          startFrame: s,
          frameCount: e - s,
          framesPattern,
          out: chunkOut,
        });
        console.log(`  · chunk ${i} [${s},${e}) → ${chunkOut}`);
        await run('ffmpeg', chunkArgs);
      }
      const listFile = join(framesDir, 'concat.txt');
      await writeFile(listFile, buildConcatList(chunkPaths));
      const concatArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out];
      console.log(`▶ concat: ${chunkPaths.length} chunks → ${out} (stream copy)`);
      await run('ffmpeg', concatArgs);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`✔ wrote ${out} in ${secs}s total (distributed)`);
    } else {
      const plan = planEncode({
        format,
        codec,
        crf,
        audioBitrate,
        fps,
        framesPattern: join(framesDir, 'frame-%05d.png'),
        segments,
        assetPaths: segments.map((seg) => assetPath(seg.src)),
        out,
      });

      if (plan === null) {
        // Should not reach here (png-seq is handled above), but guard.
        throw new Error('planEncode returned null for a non-png-seq format');
      }

      if (plan.dropsAudio) {
        console.warn('⚠ --format gif drops audio: skipping audio mux');
      }

      console.log(
        `▶ encode: ${format}${
          segments.length && !plan.dropsAudio
            ? ` · audio ${{mp4: 'aac', webm: 'libopus'}[format]} ${audioBitrate}`
            : ''
        }`,
      );
      await run('ffmpeg', plan.args);

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`✔ wrote ${out} in ${secs}s total`);
    }
  }
} finally {
  // Workers own and close their own browsers; here we only tear down shared
  // resources, and only after Promise.allSettled above has resolved.
  await cleanup();
}
