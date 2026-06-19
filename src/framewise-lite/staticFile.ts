/**
 * Returns a root-relative URL for a file in the public/ directory.
 *
 * Vite serves public/ assets at the root in dev and preview; the renderer maps
 * the resulting '/<path>' back to disk via assetPath() in render.mjs. Using
 * this helper instead of bare string literals keeps the convention explicit.
 *
 * @example
 * <Img src={staticFile('photo.png')} />     // → '/photo.png'
 * <Audio src={staticFile('/bg.wav')} />      // → '/bg.wav' (already root-relative)
 */
export function staticFile(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
