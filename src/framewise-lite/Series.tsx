import {Children, createContext, isValidElement, useContext} from 'react';
import type {CSSProperties, ReactElement, ReactNode} from 'react';
import {Sequence} from './Sequence';

/**
 * `<Series>` plays its children back-to-back like clips on a timeline:
 *
 *   <Series>
 *     <Series.Sequence durationInFrames={30}><TitleCard /></Series.Sequence>
 *     <Series.Sequence durationInFrames={45}><SecondCard /></Series.Sequence>
 *   </Series>
 *
 * It is pure bookkeeping over `<Sequence>`: walk the children, sum their
 * durations (plus any `spacing` gaps), and wrap each one in a real
 * `<Sequence from={offset} durationInFrames={duration}>`. Every hard part —
 * frame shifting, clipping, nesting — is inherited from `Sequence`.
 */
const SeriesContext = createContext<boolean>(false);

const assertDuration = (value: number | undefined, source: string): number => {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${source} requires "durationInFrames" to be a positive whole number of frames, but got ${value}. ` +
        `Pass it on the child, or set "defaultDurationInFrames" on the parent <Series>.`,
    );
  }

  return value;
};

type SeriesProps = {
  /** Frames inserted between consecutive children. Defaults to 0. */
  spacing?: number;
  /** Forwarded to each inner <Sequence>. */
  layout?: 'absolute-fill' | 'none';
  style?: CSSProperties;
  /** Used for children that omit their own durationInFrames. */
  defaultDurationInFrames?: number;
  children: ReactNode;
};

const SeriesBase = ({
  spacing = 0,
  layout = 'absolute-fill',
  style,
  defaultDurationInFrames,
  children,
}: SeriesProps) => {
  const items = Children.toArray(children);

  // One pass to validate every child and lay out the timeline: each clip's
  // `from` is where the previous clip's window (plus any spacing) ended.
  const clips = items.reduce<{child: ReactElement; from: number; duration: number}[]>(
    (clips, child) => {
      if (!isValidElement(child) || (child.type as unknown) !== Series.Sequence) {
        throw new Error(
          '<Series> only accepts <Series.Sequence> children. Wrap every clip in <Series.Sequence durationInFrames={…}>.',
        );
      }

      const props = child.props as {durationInFrames?: number};
      const duration = assertDuration(
        props.durationInFrames ?? defaultDurationInFrames,
        '<Series.Sequence>',
      );
      const previous = clips[clips.length - 1];
      const from = previous ? previous.from + previous.duration + spacing : 0;
      return [...clips, {child, from, duration}];
    },
    [],
  );

  return (
    <SeriesContext.Provider value={true}>
      {clips.map(({child, from, duration}) => (
        <Sequence
          key={child.key ?? from}
          from={from}
          durationInFrames={duration}
          layout={layout}
          style={style}
        >
          {child}
        </Sequence>
      ))}
    </SeriesContext.Provider>
  );
};

export const Series = Object.assign(SeriesBase, {
  /**
   * Declares one clip of the timeline. The parent `<Series>` reads
   * `durationInFrames` off this element to compute offsets; this component
   * itself only validates placement and renders its children bare.
   */
  Sequence: ({children}: {children?: ReactNode; durationInFrames?: number}) => {
    const inSeries = useContext(SeriesContext);
    if (!inSeries) {
      throw new Error(
        '<Series.Sequence> must be a direct child of <Series> — it has nothing to be sequential against on its own.',
      );
    }

    return <>{children}</>;
  },
});
