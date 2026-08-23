/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect */
import {useEffect, useRef, useState} from 'react';
import {Player} from './framewise-lite';
import {parsePropsInput} from './render/parse-props-input';
import {compositions, resolveCompositionConfig} from './render/registry';

/**
 * The host app — the equivalent of embedding `@framewise/player` in your own
 * site. It now reads the same composition registry the renderer uses, so the
 * preview and the export share one source of truth. Pick a composition from the
 * dropdown and tweak its props live.
 */
function Poster({id, onSelect}: {id: string; onSelect: (id: string) => void}) {
  const comp = compositions.find((c) => c.id === id)!;
  const {config} = resolveCompositionConfig(comp);
  const previewWidth = 280;
  const previewHeight = Math.round((config.height / config.width) * previewWidth);
  return (
    <button
      onClick={() => onSelect(id)}
      style={{
        width: previewWidth,
        textAlign: 'left',
        border: '1px solid #ddd',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <div
        style={{padding: '8px 10px', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #eee'}}
      >
        {comp.id}
      </div>
      <div
        style={{
          width: previewWidth,
          height: previewHeight,
          background: `hsl(${(compositions.findIndex((c) => c.id === id) * 47) % 360} 60% 92%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#555',
          fontSize: 12,
        }}
      >
        {config.width}×{config.height} · {config.durationInFrames} frames
      </div>
      <div style={{padding: '6px 10px', fontSize: 12, color: '#666'}}>Click to open →</div>
    </button>
  );
}

export default function App() {
  const [view, setView] = useState<'single' | 'gallery'>('single');
  const [selectedId, setSelectedId] = useState(compositions[0].id);
  const comp = compositions.find((c) => c.id === selectedId) ?? compositions[0];
  const [propsText, setPropsText] = useState(() => JSON.stringify(comp.defaultProps, null, 2));
  const [inputProps, setInputProps] = useState<Record<string, unknown>>(comp.defaultProps);
  const [parseError, setParseError] = useState<string | null>(null);
  const lastGoodRef = useRef<{
    id: string;
    config: ReturnType<typeof resolveCompositionConfig>['config'];
    props: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    setPropsText(JSON.stringify(comp.defaultProps, null, 2));
    setInputProps(comp.defaultProps);
    setParseError(null);
  }, [comp]);

  const handlePropsChange = (text: string) => {
    setPropsText(text);
    const result = parsePropsInput(text);
    if (!result.ok) {
      setParseError(result.error);
      return;
    }
    setParseError(null);
    setInputProps(result.props);
  };

  // Resolve config through the same path the renderer uses. On failure (bad
  // JSON or a throwing calculateMetadata) keep the last good config so the
  // Player stays mounted and the error banner explains what to fix.
  let config: ReturnType<typeof resolveCompositionConfig>['config'] | null = null;
  let effectiveProps: Record<string, unknown> = inputProps;
  let configError: string | null = parseError;

  if (!configError) {
    try {
      const resolved = resolveCompositionConfig(comp, inputProps);
      config = resolved.config;
      effectiveProps = resolved.props;
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!config) {
    if (lastGoodRef.current && lastGoodRef.current.id === comp.id) {
      config = lastGoodRef.current.config;
      effectiveProps = lastGoodRef.current.props;
    } else {
      // Fallback to statics so the Player always has something to render.
      config = {
        width: comp.width,
        height: comp.height,
        fps: comp.fps,
        durationInFrames: comp.durationInFrames,
      };
    }
  }

  if (config && !configError) {
    lastGoodRef.current = {id: comp.id, config, props: effectiveProps};
  }

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
        A minimal Framewise core: frame-as-state, <code>interpolate</code>, <code>spring</code>,{' '}
        <code>&lt;Sequence&gt;</code>, <code>delayRender</code>, and a player clock. Space =
        play/pause, ← / → = step a frame.
      </p>

      <div style={{display: 'flex', gap: 8, margin: '12px 0'}}>
        <button
          onClick={() => setView('single')}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            borderRadius: 6,
            border: `1px solid ${view === 'single' ? '#111' : '#ccc'}`,
            background: view === 'single' ? '#111' : '#fff',
            color: view === 'single' ? '#fff' : '#333',
            cursor: 'pointer',
          }}
        >
          Single
        </button>
        <button
          onClick={() => setView('gallery')}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            borderRadius: 6,
            border: `1px solid ${view === 'gallery' ? '#111' : '#ccc'}`,
            background: view === 'gallery' ? '#111' : '#fff',
            color: view === 'gallery' ? '#fff' : '#333',
            cursor: 'pointer',
          }}
        >
          Gallery
        </button>
      </div>

      {view === 'gallery' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 280px)',
            gap: 16,
            marginTop: 16,
          }}
        >
          {compositions.map((c) => (
            <Poster
              key={c.id}
              id={c.id}
              onSelect={(id) => {
                setSelectedId(id);
                setView('single');
              }}
            />
          ))}
        </div>
      ) : (
        <>
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

          <div style={{margin: '12px 0'}}>
            <label style={{display: 'block', marginBottom: 4, color: '#444', fontSize: 14}}>
              Props (JSON, merged over defaults):
            </label>
            <textarea
              value={propsText}
              onChange={(e) => handlePropsChange(e.target.value)}
              rows={4}
              spellCheck={false}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: 13,
                padding: 8,
                border: `1px solid ${configError ? '#f88' : '#ccc'}`,
                borderRadius: 4,
                resize: 'vertical',
              }}
            />
            {configError ? (
              <div style={{color: '#c00', fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap'}}>
                {configError}
              </div>
            ) : (
              <div style={{color: '#888', fontSize: 12, marginTop: 4}}>
                {config.width}×{config.height} @ {config.fps}fps · {config.durationInFrames} frames
              </div>
            )}
          </div>

          {/* key={comp.id} remounts the Player on switch: resets the clock and
              clears any delayRender handles from the previous composition. */}
          <Player
            key={comp.id}
            component={comp.component}
            inputProps={effectiveProps}
            width={config.width}
            height={config.height}
            fps={config.fps}
            durationInFrames={config.durationInFrames}
            loop
          />
        </>
      )}
    </div>
  );
}
