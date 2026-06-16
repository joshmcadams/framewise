import {useState} from 'react';
import {Player} from './framewise-lite';
import {compositions} from './render/registry';

/**
 * The host app — the equivalent of embedding `@framewise/player` in your own
 * site. It now reads the same composition registry the renderer uses, so the
 * preview and the export share one source of truth. Pick a composition from the
 * dropdown; each is played by a `<Player>`.
 */
export default function App() {
  const [selectedId, setSelectedId] = useState(compositions[0].id);
  const comp = compositions.find((c) => c.id === selectedId) ?? compositions[0];

  return (
    <div
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <h2 style={{marginBottom: 4}}>framewise-lite</h2>
      <p style={{marginTop: 0, color: '#666'}}>
        A minimal Framewise core: frame-as-state, <code>interpolate</code>,{' '}
        <code>spring</code>, <code>&lt;Sequence&gt;</code>,{' '}
        <code>delayRender</code>, and a player clock. Space = play/pause, ← / →
        = step a frame.
      </p>

      <label style={{display: 'block', margin: '12px 0', color: '#444'}}>
        Composition:{' '}
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{fontSize: 14, padding: '4px 8px'}}
        >
          {compositions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </select>
      </label>

      {/* key={comp.id} remounts the Player on switch: resets the clock and
          clears any delayRender handles from the previous composition. */}
      <Player
        key={comp.id}
        component={comp.component}
        inputProps={comp.defaultProps}
        width={comp.width}
        height={comp.height}
        fps={comp.fps}
        durationInFrames={comp.durationInFrames}
        loop
      />
    </div>
  );
}
