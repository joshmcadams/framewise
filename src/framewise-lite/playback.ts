import {createContext, useContext} from 'react';

// Playback state for preview-only media sync. The Player provides it; the render
// entry does NOT — so in headless rendering the context is null and <Audio>
// leaves the underlying <audio> element completely alone (no play/pause/seek).
// Audio in a render is reconstructed from the collected reports + ffmpeg, never
// from the live element.

export type Playback = {
  playing: boolean;
};

const PlaybackContext = createContext<Playback | null>(null);

export const PlaybackProvider = PlaybackContext.Provider;

/** Returns the Player's playback state, or null when rendering (no Player). */
export const usePlayback = (): Playback | null => useContext(PlaybackContext);
