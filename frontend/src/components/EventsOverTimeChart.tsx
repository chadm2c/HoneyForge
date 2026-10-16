import { formatUtcMinute } from "../lib/datetime";
import type { HourBucket, WindowDisclosure } from "../lib/stats";

// Fixed drawing surface; the SVG scales to its container via `className`.
const WIDTH = 480;
const HEIGHT = 120;
const PAD_X = 4;
// The plot starts below a reserved annotation band so the max label can never
// be drawn on top of a full-height bar (which tops out at `y = PLOT_TOP`).
const PLOT_TOP = 16;
const LABEL_Y = 10;
const BASELINE_Y = 90;
const PLOT_HEIGHT = BASELINE_Y - PLOT_TOP;
const AXIS_Y = BASELINE_Y + 13;

/**
 * The overview's events-per-hour histogram: one bar per bucket, oldest on the
 * left, drawn as raw inline SVG because this slice takes no charting
 * dependency.
 *
 * The axis is labelled with the buckets' real start and end instants, never
 * clock-aligned "HH:00" ticks: `HourBucket` boundaries are anchored to the
 * reporting window, so `buckets[0]` does not begin on the hour and an hour
 * label would assert an alignment the data does not have.
 */
export default function EventsOverTimeChart({
  buckets,
  disclosure,
}: {
  buckets: HourBucket[];
  disclosure: WindowDisclosure;
}) {
  // `reduce` from 0 keeps an empty input finite; `Math.max()` of an empty array
  // would be `-Infinity` and every height would be `NaN`.
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  const slot = (WIDTH - 2 * PAD_X) / Math.max(1, buckets.length);
  const barWidth = Math.max(1, slot - 2);
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-32 w-full"
      role="img"
      aria-label={`Events per hour over the last 24h. ${disclosure.text}`}
    >
      {buckets.map((bucket, i) => {
        // Guarded so `max === 0` can never reach `count / max` and yield NaN;
        // a non-zero count is floored to 1px so a quiet hour still shows a bar.
        const height =
          max === 0 || bucket.count === 0
            ? 0
            : Math.max(1, Math.round((bucket.count / max) * PLOT_HEIGHT));
        return (
          <rect
            key={bucket.startIso}
            x={PAD_X + i * slot}
            y={BASELINE_Y - height}
            width={barWidth}
            height={height}
            className="fill-cyan-500"
          >
            <title>{`${formatUtcMinute(bucket.startIso)} UTC — ${bucket.count} events`}</title>
          </rect>
        );
      })}

      {/* The baseline is always drawn, so an all-zero window reads as flat. */}
      <line x1={PAD_X} y1={BASELINE_Y} x2={WIDTH - PAD_X} y2={BASELINE_Y} className="stroke-slate-700" />

      {/* §9: the y-axis carries the max value. Only when the window is
          non-empty — with `max === 0` the "No events" label below already
          states the meaning, and two labels would stack at the same point. */}
      {max > 0 && (
        <text
          x={PAD_X}
          y={LABEL_Y}
          textAnchor="start"
          fontSize={9}
          className="fill-slate-500"
        >
          {max}
        </text>
      )}

      {max === 0 && (
        <text
          x={WIDTH / 2}
          y={(PLOT_TOP + BASELINE_Y) / 2}
          textAnchor="middle"
          fontSize={11}
          className="fill-slate-500"
        >
          No events
        </text>
      )}

      {first && (
        <text x={PAD_X} y={AXIS_Y} textAnchor="start" fontSize={9} className="fill-slate-500">
          {`${formatUtcMinute(first.startIso)} UTC`}
        </text>
      )}
      {last && (
        <text
          x={WIDTH - PAD_X}
          y={AXIS_Y}
          textAnchor="end"
          fontSize={9}
          className="fill-slate-500"
        >
          {`${formatUtcMinute(last.endIso)} UTC`}
        </text>
      )}
    </svg>
  );
}
