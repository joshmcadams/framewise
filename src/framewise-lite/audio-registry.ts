// Per-frame audio collection sink.
//
// Audio is NOT screenshotted. During a render, each mounted <Audio> reports its
// state for the CURRENT frame here; the renderer reads the list after each
// frame and later aggregates the per-frame reports into segments it can hand to
// ffmpeg. Pairing each report with the renderer's absolute frame number is what
// makes <Sequence> timing, trims, and unmount "just work" — an <Audio> inside a
// <Sequence from={60}> simply doesn't report until frame 60.
//
// The sink only collects while `collecting` is true, which is armed exclusively
// by the render entry (beginAudioFrame). In the Player preview it stays false,
// so reportAudio() is a harmless no-op there.

export type AudioReport = {
  /** Stable per-<Audio>-instance id (React useId), so two uses of the same file
   *  aggregate into two segments instead of being merged. */
  id: string;
  src: string;
  /** Seconds into the audio file at this frame = (localFrame + startFrom)/fps. */
  mediaTime: number;
  volume: number;
};

let collecting = false;
// Keyed by <Audio> instance id (not an array) so that if a component commits
// more than once within a single frame — e.g. an <Audio> composition that also
// does a delayRender-gated flushSync(setState) between renderFrame() and the
// renderer's read — the repeated (identical) report collapses instead of
// producing a duplicate, overlapping segment. Last write wins.
let currentFrame = new Map<string, AudioReport>();

/** Called by the render entry before each frame's render pass. */
export function beginAudioFrame(): void {
  collecting = true;
  currentFrame = new Map();
}

/** Called by each mounted <Audio> during the render pass. */
export function reportAudio(report: AudioReport): void {
  if (!collecting) {
    return;
  }
  currentFrame.set(report.id, report);
}

/** Read by the renderer after the frame's render pass has flushed. */
export function readAudioFrame(): AudioReport[] {
  return [...currentFrame.values()];
}
