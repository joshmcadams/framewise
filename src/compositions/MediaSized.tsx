import {AbsoluteFill, staticFile, Video, useCurrentFrame} from '../framewise-lite';

/**
 * The async-`calculateMetadata` demo: the composition is exactly as long as
 * the media it embeds. The hook (declared on this comp's registry entry)
 * probes `clip.mp4`'s container metadata and derives `durationInFrames` from
 * it — the use case a sync-only hook cannot express at all.
 *
 * The STATIC durationInFrames (30) is deliberately wrong — the file runs
 * 5.000 s. A render that comes out ~150 frames therefore proves the probe ran;
 * if metadata resolution ever silently fell back to statics, the output length
 * would give it away immediately.
 */
export const MediaSized = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Video src={staticFile('clip.mp4')} style={{position: 'absolute', inset: 0}} />
      <AbsoluteFill
        style={{justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none'}}
      >
        <div
          style={{
            marginBottom: 36,
            padding: '12px 28px',
            background: 'rgba(0,0,0,0.55)',
            color: 'white',
            borderRadius: 999,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 30,
            fontWeight: 600,
          }}
        >
          sized by probe · comp frame {frame}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
