import {describe, expect, it} from 'vitest';
import {staticFile} from './staticFile';

describe('staticFile', () => {
  it('adds a leading slash when the path does not have one', () => {
    expect(staticFile('photo.png')).toBe('/photo.png');
    expect(staticFile('audio/bg.wav')).toBe('/audio/bg.wav');
  });

  it('leaves root-relative paths unchanged', () => {
    expect(staticFile('/photo.png')).toBe('/photo.png');
    expect(staticFile('/audio/bg.wav')).toBe('/audio/bg.wav');
  });
});
