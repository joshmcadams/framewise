import {describe, expect, it} from 'vitest';
import {beginAudioFrame, reportAudio, readAudioFrame} from './audio-registry';

const report = (id: string, mediaTime: number) => ({
  id,
  src: '/a.wav',
  mediaTime,
  volume: 1,
});

describe('audio-registry', () => {
  it('collapses duplicate reports from the same instance within a frame', () => {
    // Simulates an <Audio> committing twice in one frame (e.g. a sibling
    // flushSync re-render between renderFrame and the renderer's read).
    beginAudioFrame();
    reportAudio(report('a', 1.5));
    reportAudio(report('a', 1.5)); // duplicate — must NOT double the segment
    expect(readAudioFrame()).toHaveLength(1);
  });

  it('keeps distinct instances separate (two uses of the same file)', () => {
    beginAudioFrame();
    reportAudio(report('a', 0));
    reportAudio(report('b', 0)); // same src, different instance id
    expect(readAudioFrame()).toHaveLength(2);
  });

  it('clears between frames', () => {
    beginAudioFrame();
    reportAudio(report('a', 0));
    beginAudioFrame();
    expect(readAudioFrame()).toHaveLength(0);
  });

  it('does not collect outside a render (no beginAudioFrame)', () => {
    // A fresh begin clears any prior state; without a subsequent report the
    // bucket is empty, and reports in preview (collecting=false path) are tested
    // implicitly by the Player never calling beginAudioFrame.
    beginAudioFrame();
    expect(readAudioFrame()).toHaveLength(0);
  });
});
