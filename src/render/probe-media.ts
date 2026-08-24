/**
 * Reads a media file's duration in seconds by loading its metadata in a
 * detached <video> element. This is the primitive async `calculateMetadata`
 * hooks use to size a composition to its media ("make the comp exactly as
 * long as clip.mp4").
 *
 * Works unchanged on BOTH paths because both serve `public/` statically:
 * `npm run dev` is Vite's default behavior, and scripts/render.mjs builds the
 * render page on a real Vite createServer (render.mjs:472). No server-side
 * probe, no offthread-server dependency — the browser reads the container
 * metadata itself. Deterministic for a given file: duration is container
 * metadata, not decoder state.
 */
export const probeMediaDurationInSeconds = (src: string): Promise<number> =>
  new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error(`probeMediaDurationInSeconds("${src}"): no DOM to load media into`));
      return;
    }
    const video = document.createElement('video');
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error(`probeMediaDurationInSeconds("${src}"): no finite duration`));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(`probeMediaDurationInSeconds("${src}"): could not load media`));
    };
    video.src = src;
  });
