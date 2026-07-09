import {AbsoluteFill, staticFile, Video, useCurrentFrame} from '../framewise-lite';

/**
 * Embeds the test clip full-frame and overlays a React banner on top. The clip
 * shows its own frame number; the banner shows the composition's frame number.
 * Because the clip is 30fps starting at composition frame 0 — same as the comp —
 * the two numbers must match in every rendered frame. That equality is the
 * frame-accuracy proof: render comp frame 75, read "75" off the embedded video.
 */
export const WithVideo = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Video src={staticFile('clip.mp4')} style={{position: 'absolute', inset: 0}} />

      {/* React overlay composited on top of the decoded video frames. */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            marginTop: 36,
            padding: '12px 28px',
            background: 'rgba(0,0,0,0.55)',
            color: 'white',
            borderRadius: 999,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 30,
            fontWeight: 600,
          }}
        >
          embedded &lt;Video&gt; · comp frame {frame}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
