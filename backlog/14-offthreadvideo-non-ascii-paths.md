# 14 — `<OffthreadVideo>` breaks on non-ASCII asset paths

**Type:** Bug (correctness) · **Severity:** Medium · **Introduced by:** plan 021 (`5c4b81a`)
**Status:** DONE — fixed by plan 035 (UTF-8 encode before base64 via `extractKey`; round-trip tests through `parseExtractUrl`).

## Problem

The component encodes the source path with `btoa` (`OffthreadVideo.tsx:56`):

```js
const key = btoa(src).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
```

but the extraction server decodes it as **UTF-8**
(`scripts/offthread-server.mjs:33`):

```js
src = Buffer.from(match[1], 'base64url').toString('utf8');
```

`btoa` is Latin-1, and `staticFile()` does no percent-encoding, so the raw path
reaches `btoa` unchanged. Both failure modes are reachable:

| src | result |
|-----|--------|
| `/vidéo.mp4` | round-trips to `/vid�o.mp4` → ffmpeg ENOENT |
| `/日本.mp4`  | `btoa` throws `InvalidCharacterError` → composition crashes mid-render |

## Fix

UTF-8 encode before base64:

```js
const key = btoa(String.fromCharCode(...new TextEncoder().encode(src)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
```

(or drop base64 for `encodeURIComponent` on a single path segment, which the
`[^/]+` route pattern already accommodates).

## Acceptance

- A test in `OffthreadVideo.test.tsx` renders with `src="/vidéo.mp4"` and asserts
  the generated URL decodes back to the exact original string through
  `parseExtractUrl`.
- The same for a CJK filename, which currently throws.
