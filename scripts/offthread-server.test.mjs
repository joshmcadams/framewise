import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFfmpegArgs, framewiseExtract, parseExtractUrl} from './offthread-server.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

describe('parseExtractUrl', () => {
  it('parses a well-formed request', () => {
    const parsed = parseExtractUrl(`/${b64('/clip.mp4')}/75.png?fps=30`);
    expect(parsed.src).toBe('/clip.mp4');
    expect(parsed.frame).toBe(75);
    expect(parsed.fps).toBe(30);
    expect(parsed.cacheKey).toMatch(/^[0-9a-f]{40}$/);
  });

  it('produces a stable cache key per source+fps', () => {
    const a = parseExtractUrl(`/${b64('/clip.mp4')}/1.png?fps=30`);
    const b = parseExtractUrl(`/${b64('/clip.mp4')}/2.png?fps=30`);
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it('decodes UTF-8 sources exactly (server side of the non-ASCII contract)', () => {
    for (const src of ['/vidéo.mp4', '/日本語クリップ.mp4']) {
      expect(parseExtractUrl(`/${b64(src)}/75.png?fps=30`).src).toBe(src);
    }
  });

  it('rejects malformed paths, bad keys, and bad fps', () => {
    expect(() => parseExtractUrl('/nope.png?fps=30')).toThrow(/Malformed/);
    expect(() => parseExtractUrl('///75.png?fps=30')).toThrow();
    // A key that decodes to something not starting with '/'
    const badKey = b64('not-root-relative');
    expect(() => parseExtractUrl(`/${badKey}/75.png?fps=30`)).toThrow(/root-relative/);
    expect(() => parseExtractUrl(`/${b64('/clip.mp4')}/75.png`)).toThrow(/fps/);
    expect(() => parseExtractUrl(`/${b64('/clip.mp4')}/75.png?fps=0`)).toThrow(/fps/);
    expect(() => parseExtractUrl(`/${b64('/clip.mp4')}/abc.png?fps=30`)).toThrow(/Malformed/);
  });
});

describe('buildFfmpegArgs', () => {
  it('seeks before the input with the half-frame-nudged time', () => {
    expect(buildFfmpegArgs(2.5166667, '/tmp/in.mp4', '/tmp/out.png')).toEqual([
      '-y',
      '-ss',
      String(2.5166667),
      '-i',
      '/tmp/in.mp4',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '/tmp/out.png',
    ]);
  });
});

// Minimal req/res stubs for the connect-style middleware.
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function makeApp({run, cacheDir, publicDir = 'public'}) {
  let handler;
  const plugin = framewiseExtract({
    publicDir,
    cacheDir,
    run,
  });
  plugin.configureServer({
    middlewares: {
      use(mount, fn) {
        if (mount === '/__framewise_extract') {
          handler = fn;
        }
      },
    },
  });

  return async (url) => {
    const res = makeRes();
    await handler({url}, res, () => {});
    return res;
  };
}

describe('framewiseExtract middleware', () => {
  let dir;

  afterEach(async () => {
    if (dir) {
      await rm(dir, {recursive: true, force: true});
      dir = undefined;
    }
  });

  it('extracts on miss and serves the cached file on hit', async () => {
    dir = await mkdtemp(join(tmpdir(), 'offthread-test-'));
    let runs = 0;
    const app = await makeApp({
      cacheDir: join(dir, 'cache'),
      run: async (args) => {
        runs++;
        // Pretend ffmpeg wrote the output: last arg is the output path.
        await writeFile(args[args.length - 1], 'PNGDATA');
      },
    });

    const url = `/${b64('/clip.mp4')}/75.png?fps=30`;
    const first = await app(url);
    expect(first.statusCode).toBe(200);
    expect(first.body.toString()).toBe('PNGDATA');
    expect(runs).toBe(1);

    // Second identical request: served from cache, no second extraction.
    const second = await app(url);
    expect(second.statusCode).toBe(200);
    expect(second.body.toString()).toBe('PNGDATA');
    expect(runs).toBe(1);
  });

  it('dedupes concurrent duplicate requests into one extraction', async () => {
    dir = await mkdtemp(join(tmpdir(), 'offthread-test-'));
    let runs = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const app = await makeApp({
      cacheDir: join(dir, 'cache'),
      run: async (args) => {
        runs++;
        await gate;
        await writeFile(args[args.length - 1], 'SLOW');
      },
    });

    const url = `/${b64('/clip.mp4')}/10.png?fps=30`;
    // Fire both without awaiting; let the first register its in-flight job
    // (which then blocks on the gate) before releasing it.
    const a = app(url);
    const b = app(url);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    expect(runs).toBe(1); // both waited on the single in-flight job
  });

  it('answers 500 with the reason when extraction fails', async () => {
    dir = await mkdtemp(join(tmpdir(), 'offthread-test-'));
    const app = await makeApp({
      cacheDir: join(dir, 'cache'),
      run: async () => {
        throw new Error('boom: no such file');
      },
    });

    const res = await app(`/${b64('/missing.mp4')}/5.png?fps=30`);
    expect(res.statusCode).toBe(500);
    expect(res.body.toString()).toContain('boom');
  });

  it('answers 500 for malformed requests without invoking ffmpeg', async () => {
    dir = await mkdtemp(join(tmpdir(), 'offthread-test-'));
    let runs = 0;
    const app = await makeApp({
      cacheDir: join(dir, 'cache'),
      run: async () => {
        runs++;
      },
    });

    const res = await app('/garbage');
    expect(res.statusCode).toBe(500);
    expect(res.body.toString()).toContain('Malformed');
    expect(runs).toBe(0);
  });

  it('resolves sources against the public dir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'offthread-test-'));
    const pub = join(dir, 'pub');
    await mkdir(pub, {recursive: true});
    let seenInput;
    const app = await makeApp({
      publicDir: pub,
      cacheDir: join(dir, 'cache'),
      run: async (args) => {
        // args: -y -ss <time> -i <input> -frames:v 1 -q:v 2 <out>
        seenInput = args[4];
        await writeFile(args[args.length - 1], 'x');
      },
    });

    await app(`/${b64('/clip.mp4')}/0.png?fps=30`);
    expect(seenInput).toBe(join(pub, 'clip.mp4'));
  });

  it('seeks to exactly frame/fps (ffmpeg picks the frame at-or-after)', async () => {
    // Regression pin: a half-frame nudge here made every extracted frame land
    // one late, because unlike live seeking, -ss selects by PTS >= target.
    dir = await mkdtemp(join(tmpdir(), 'offthread-test-'));
    let seenSeconds;
    const app = await makeApp({
      cacheDir: join(dir, 'cache'),
      run: async (args) => {
        seenSeconds = Number(args[2]);
        await writeFile(args[args.length - 1], 'x');
      },
    });

    await app(`/${b64('/clip.mp4')}/75.png?fps=30`);
    expect(seenSeconds).toBe(75 / 30);
  });
});
