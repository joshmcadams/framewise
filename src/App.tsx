/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect */
import {useEffect, useState} from 'react';
import {Player} from './framewise-lite';
import {parsePropsInput} from './render/parse-props-input';
import {compositions, resolveCompositionConfig} from './render/registry';

/**
 * The host app — the equivalent of embedding `@framewise/player` in your own
 * site. It now reads the same composition registry the renderer uses, so the
 * preview and the export share one source of truth. Pick a composition from the
 * dropdown and tweak its props live.
 */
export default function App() {
  const [selectedId, setSelectedId] = useState(compositions[0].id);
  const comp = compositions.find((c) => c.id === selectedId) ?? compositions[0];
  const [propsText, setPropsText] = useState(() => JSON.stringify(comp.defaultProps, null, 2));
  const [inputProps, setInputProps] = useState<Record<string, unknown>>(comp.defaultProps);
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastGood, setLastGood] = useState<{
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

  // Resolve config through the same path the renderer uses.
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

  // Keep last good for fallback when the current input is invalid.
  useEffect(() => {
    if (config && !configError) {
      setLastGood({id: comp.id, config, props: effectiveProps});
    }
  }, [comp.id, config, configError, effectiveProps]);

  if (!config) {
    if (lastGood && lastGood.id === comp.id) {
      config = lastGood.config;
      effectiveProps = lastGood.props;
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
    </div>
  );
}
