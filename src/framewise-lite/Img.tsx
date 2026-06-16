import {useLayoutEffect, useRef} from 'react';
import type {ImgHTMLAttributes} from 'react';
import {continueRender, delayRender} from './delay-render';

/**
 * A drop-in `<img>` that participates in delayRender: it blocks the render
 * until the image has actually loaded, so a renderer never screenshots a frame
 * with a half-loaded or missing image. This is the canonical delayRender use.
 *
 * Why useLayoutEffect (not useEffect, not a useState initializer):
 *  - The renderer checks for pending handles right after a synchronous
 *    flushSync render. flushSync runs LAYOUT effects synchronously but defers
 *    passive (useEffect) effects — a useEffect handle would register too late,
 *    after the capture.
 *  - A useState(() => delayRender()) initializer double-fires under StrictMode
 *    and orphans a handle. The cleanup-in-effect pattern below nets out to one
 *    cleared handle across StrictMode's mount/unmount/mount.
 */
export const Img = ({src, ...rest}: ImgHTMLAttributes<HTMLImageElement>) => {
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const img = ref.current;
    // Already decoded (e.g. cached)? No need to delay at all.
    if (img && img.complete && img.naturalWidth > 0) {
      return;
    }

    const handle = delayRender(`<Img> ${src}`);
    // Imperative listeners avoid the closure race a React onLoad handler has
    // (onLoad could fire before a setState-stored handle commits).
    const done = () => continueRender(handle);
    img?.addEventListener('load', done);
    img?.addEventListener('error', done);

    return () => {
      img?.removeEventListener('load', done);
      img?.removeEventListener('error', done);
      continueRender(handle); // clear on unmount / src change / StrictMode
    };
  }, [src]);

  return <img ref={ref} src={src} {...rest} />;
};
