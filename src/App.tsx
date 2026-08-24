import {useEffect, useState} from 'react';
import type {ComponentType} from 'react';
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
  // Posters show DECLARED statics, not resolved metadata: opening the gallery
  // must not fire N media probes (one per async calculateMetadata). Opening a
  // composition resolves its real metadata in CompositionView.
  const previewWidth = 280;
  const previewHeight = Math.round((comp.height / comp.width) * previewWidth);
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
        {comp.width}×{comp.height} · {comp.durationInFrames} frames
      </div>
      <div style={{padding: '6px 10px', fontSize: 12, color: '#666'}}>Click to open →</div>
    </button>
  );
}

// Resolve now-or-later: either a usable config+props, or null while none has
// resolved yet. ASYNC since calculateMetadata may await (media probes):
// resolution runs in an EFFECT keyed on the props text — never during render —
// with a cancellation flag so a superseded resolve can't clobber a newer one.
// A half-typed JSON box degrades to the LAST GOOD config (parse error only),
// and a rejecting hook keeps the last good config too.
type Resolved = Awaited<ReturnType<typeof resolveCompositionConfig>>;

// Everything that belongs to ONE composition's editing session. Mounted under
// key={comp.id}, so switching compositions remounts this subtree and state
// resets from defaultProps — React's recommended "reset state when a prop
// changes" pattern, which is why there is no sync-to-state effect here.
function CompositionView({comp}: {comp: (typeof compositions)[number]}) {
  const [propsText, setPropsText] = useState(() => JSON.stringify(comp.defaultProps, null, 2));
  // null until the first resolve lands; the Player renders statics meanwhile.
  const [resolved, setResolved] = useState<Resolved | null>(null);
  // Why the last resolve failed (a rejecting calculateMetadata). Parse errors
  // are NOT state — they're derived from propsText during render below.
  const [resolveError, setResolveError] = useState<string | null>(null);
  // The props text whose resolution has landed. `resolving` derives from it:
  // any text that hasn't settled yet (including the very first) shows the hint.
  const [settledText, setSettledText] = useState<string | null>(null);

  const parsed = parsePropsInput(propsText);
  const editError = parsed.ok ? resolveError : parsed.error;
  const resolving = parsed.ok && settledText !== propsText;

  useEffect(() => {
    // Parse here AND during render (pure + cheap): depending on the parsed
    // object would loop the effect — it's a fresh instance every render.
    const effectParsed = parsePropsInput(propsText);
    if (!effectParsed.ok) return; // parse error banner shows; last good config stays
    let cancelled = false;
    resolveCompositionConfig(comp, effectParsed.props)
      .then(({config, props}) => {
        if (cancelled) return;
        setResolved({config, props});
        setResolveError(null);
        setSettledText(propsText);
      })
      .catch((e: unknown) => {
        if (cancelled) return; // a newer resolve owns the UI now
        setResolveError(e instanceof Error ? e.message : String(e)); // keep last good
        setSettledText(propsText); // stop the resolving hint; banner takes over
      });
    return () => {
      cancelled = true;
    };
  }, [comp, propsText]);

  // Statics guarantee the Player always has something to render — including
  // the window before the first (possibly probing) resolve lands.
  const config = resolved?.config ?? {
    width: comp.width,
    height: comp.height,
    fps: comp.fps,
    durationInFrames: comp.durationInFrames,
  };
  const effectiveProps = resolved?.props ?? comp.defaultProps;

  const handlePropsChange = (text: string) => {
    setPropsText(text); // the effect above owns parsing + resolution
  };

  return (
    <>
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
            border: `1px solid ${editError ? '#f88' : '#ccc'}`,
            borderRadius: 4,
            resize: 'vertical',
          }}
        />
        {editError ? (
          <div style={{color: '#c00', fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap'}}>
            {editError}
          </div>
        ) : (
          <div style={{color: '#888', fontSize: 12, marginTop: 4}}>
            {config.width}×{config.height} @ {config.fps}fps · {config.durationInFrames} frames
            {resolving ? ' · resolving…' : ''}
          </div>
        )}
      </div>

      {/* key={comp.id} also resets the Player clock and clears any delayRender
          handles left over from a previous editing session. */}
      <Player
        key={comp.id}
        component={comp.component as ComponentType<Record<string, unknown>>}
        inputProps={effectiveProps}
        width={config.width}
        height={config.height}
        fps={config.fps}
        durationInFrames={config.durationInFrames}
        loop
      />
    </>
  );
}

export default function App() {
  const [view, setView] = useState<'single' | 'gallery'>('single');
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

          <CompositionView key={comp.id} comp={comp} />
        </>
      )}
    </div>
  );
}
