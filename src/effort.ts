// Friel's efficiency factor and aerobic decoupling, from measured figures only.
// Twin of `ourpr-mcp-server/src/effort.ts`; effort.test.ts holds the pair.
// No graded pace: that is a model, and the tools state what was measured.

const YARDS_PER_MILE = 1760;
const METERS_PER_MILE = 1609.344;

/** Slower than this over one grid sample and the runner is standing.
 *  Mirror of MOVING_CAP_S_PER_M in activity_streams.py. */
const MOVING_CAP_S_PER_M = 1.0;

/** A channel thinner than this over a window gives no average. The API drops
 *  a whole channel under the same share. */
const MIN_COVERAGE = 0.5;

export interface EffortStream {
  grid_m: number;
  time_s?: (number | null)[] | null;
  hr_bpm?: (number | null)[] | null;
}

export interface EffortWindow {
  miles: number;
  moving_s: number;
  pace_per_mile: string;
  avg_hr: number | null;
  efficiency_factor: number | null;
  beats_per_mile: number | null;
}

export interface EffortHalves {
  first: EffortWindow;
  second: EffortWindow;
  /** Positive: the second half took more heart rate for each yard. */
  decoupling_pct: number | null;
}

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/** "7:34" or "1:02:03" to seconds. */
export function paceSeconds(pace: string | null | undefined): number | null {
  if (!pace || !/^\d+(:\d{2}){1,2}$/.test(pace)) return null;
  const seconds = pace.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 ? seconds : null;
}

export function paceClock(secondsPerMile: number): string {
  const whole = Math.round(secondsPerMile);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Yards a minute over average heart rate (Joe Friel, TrainingPeaks). */
export function efficiencyFactor(
  secondsPerMile: number | null,
  avgHr: number | null | undefined,
): number | null {
  if (!secondsPerMile || !avgHr || secondsPerMile <= 0 || avgHr <= 0) return null;
  const yardsPerMinute = (YARDS_PER_MILE * 60) / secondsPerMile;
  return round(yardsPerMinute / avgHr, 2);
}

/** The heartbeats one mile took: heart rate times minutes a mile. A unit a
 *  runner can say, where the efficiency factor is a ratio. Lower is better. */
export function beatsPerMile(
  secondsPerMile: number | null,
  avgHr: number | null | undefined,
): number | null {
  if (!secondsPerMile || !avgHr || secondsPerMile <= 0 || avgHr <= 0) return null;
  return Math.round((avgHr * secondsPerMile) / 60);
}

/** The window's bounds as sample indices. Mirror of _slice_by_fraction. */
function bounds(length: number, from: number, to: number): [number, number] {
  const last = length - 1;
  const lo = Math.max(0, Math.min(last, Math.round(from * last)));
  const hi = Math.max(0, Math.min(last, Math.round(to * last)));
  return [lo, hi];
}

/** Distance-weighted, as the grid is: stopped time adds no sample. */
function meanHr(values: (number | null)[] | null | undefined, lo: number, hi: number) {
  if (!values?.length) return null;
  let total = 0;
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    const v = values[i];
    if (v != null) {
      total += v;
      count++;
    }
  }
  return count && count / (hi - lo + 1) >= MIN_COVERAGE ? total / count : null;
}

/** Pace from moving time, as on every path in the app. */
export function effortBetween(stream: EffortStream, from: number, to: number): EffortWindow | null {
  const times = stream.time_s;
  if (!times || times.length < 2) return null;
  const [lo, hi] = bounds(times.length, from, to);
  const cap = MOVING_CAP_S_PER_M * (stream.grid_m || 10);
  let moving = 0;
  for (let i = lo + 1; i <= hi; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (a != null && b != null) moving += Math.min(b - a, cap);
  }
  const miles = ((hi - lo) * stream.grid_m) / METERS_PER_MILE;
  if (moving <= 0 || miles <= 0) return null;
  const secondsPerMile = moving / miles;
  const hr = meanHr(stream.hr_bpm, lo, hi);
  return {
    miles: round(miles, 2),
    moving_s: Math.round(moving),
    pace_per_mile: paceClock(secondsPerMile),
    avg_hr: hr == null ? null : Math.round(hr),
    efficiency_factor: efficiencyFactor(secondsPerMile, hr),
    beats_per_mile: beatsPerMile(secondsPerMile, hr),
  };
}

/** Each half by distance, and the drift between them (Pa:HR). */
export function effortHalves(stream: EffortStream): EffortHalves | null {
  const first = effortBetween(stream, 0, 0.5);
  const second = effortBetween(stream, 0.5, 1);
  if (!first || !second) return null;
  const a = first.efficiency_factor;
  const b = second.efficiency_factor;
  return {
    first,
    second,
    decoupling_pct: a && b ? round(((a - b) / a) * 100, 1) : null,
  };
}

/** Average heart rate for each split, found on the grid by fraction of the
 *  splits' own distance. Null where a split distance or the channel is missing. */
export function splitHeartRates(
  stream: EffortStream,
  splitMeters: (number | null | undefined)[],
): (number | null)[] {
  const values = stream.hr_bpm;
  const total = splitMeters.reduce<number>((sum, m) => sum + (m ?? 0), 0);
  if (!values?.length || total <= 0 || splitMeters.some((m) => !m)) {
    return splitMeters.map(() => null);
  }
  let walked = 0;
  return splitMeters.map((m) => {
    const from = walked / total;
    walked += m ?? 0;
    const [lo, hi] = bounds(values.length, from, walked / total);
    const hr = meanHr(values, lo, hi);
    return hr == null ? null : Math.round(hr);
  });
}
