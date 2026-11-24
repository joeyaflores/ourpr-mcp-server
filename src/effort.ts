// Friel's efficiency factor and aerobic decoupling, from measured figures only.
// Twin of `ourpr-mcp-server/src/effort.ts`; effort.test.ts holds the pair.
// The Python twin is backend/app/services/effort.py; tests/test_effort.py reads these constants.
// No graded pace: that is a model, and the tools state what was measured.

const YARDS_PER_MILE = 1760;
const METERS_PER_MILE = 1609.344;

/** Slower than this over one grid sample and the runner is standing.
 *  Mirror of MOVING_CAP_S_PER_M in activity_streams.py. */
const MOVING_CAP_S_PER_M = 1.0;

/** A channel thinner than this over a window gives no average. The API drops
 *  a whole channel under the same share. */
const MIN_COVERAGE = 0.5;

/** Halves further apart in pace than this read pacing, not drift: on a
 *  negative split the second half's efficiency rises with the speed. */
export const EVEN_PACE_PCT = 3;

/** Heart rate is still climbing through a warm up; protocols leave out the
 *  first 10 to 15 minutes before they split a run. */
export const WARM_UP_S = 600;

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

export interface EffortSplit {
  first: EffortWindow;
  second: EffortWindow;
  /** Positive: the second half took more heart rate for each yard. */
  decoupling_pct: number | null;
  /** Positive: the second half ran slower. */
  pace_change_pct: number;
  /** The halves held one pace, so the drift reads effort, not pacing. */
  even: boolean;
}

export interface EffortHalves extends EffortSplit {
  /** The same split after the first WARM_UP_S of moving time. */
  after_warm_up: EffortSplit | null;
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

/** Each step's moving time. A step over the cap is a stop: it counts as the
 *  typical step around it, the median of the steps under the cap, so a stop
 *  costs what the same ground costs on the move. */
export function movingSteps(steps: number[], cap: number): number[] {
  const under = steps.filter((step) => step <= cap).sort((a, b) => a - b);
  const mid = Math.floor(under.length / 2);
  const typical =
    under.length === 0 ? cap : under.length % 2 ? under[mid] : (under[mid - 1] + under[mid]) / 2;
  return steps.map((step) => (step <= cap ? step : typical));
}

/** Pace from moving time, as on every path in the app. */
export function effortBetween(stream: EffortStream, from: number, to: number): EffortWindow | null {
  const times = stream.time_s;
  if (!times || times.length < 2) return null;
  const [lo, hi] = bounds(times.length, from, to);
  const cap = MOVING_CAP_S_PER_M * (stream.grid_m || 10);
  const steps: number[] = [];
  for (let i = lo + 1; i <= hi; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (a != null && b != null) steps.push(b - a);
  }
  const moving = movingSteps(steps, cap).reduce((sum, step) => sum + step, 0);
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

/** The run from `from` to its end, cut in two by distance. */
function splitFrom(stream: EffortStream, from: number): EffortSplit | null {
  const mid = (from + 1) / 2;
  const first = effortBetween(stream, from, mid);
  const second = effortBetween(stream, mid, 1);
  if (!first || !second) return null;
  const a = first.efficiency_factor;
  const b = second.efficiency_factor;
  const paceA = first.moving_s / first.miles;
  const paceB = second.moving_s / second.miles;
  const paceChange = round(((paceB - paceA) / paceA) * 100, 1);
  return {
    first,
    second,
    decoupling_pct: a && b ? round(((a - b) / a) * 100, 1) : null,
    pace_change_pct: paceChange,
    even: Math.abs(paceChange) <= EVEN_PACE_PCT,
  };
}

/** Where the moving time first reaches `seconds`, as a fraction of the run. */
function fractionAfterMoving(stream: EffortStream, seconds: number): number | null {
  const times = stream.time_s;
  if (!times || times.length < 2) return null;
  const cap = MOVING_CAP_S_PER_M * (stream.grid_m || 10);
  const at: number[] = [];
  const steps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (a != null && b != null) {
      at.push(i);
      steps.push(b - a);
    }
  }
  let moving = 0;
  const counted = movingSteps(steps, cap);
  for (let k = 0; k < counted.length; k++) {
    moving += counted[k];
    if (moving >= seconds) return at[k] / (times.length - 1);
  }
  return null;
}

/** Each half by distance and the drift between them (Pa:HR), then the same
 *  after the warm up, where the run is long enough to leave one out. */
export function effortHalves(stream: EffortStream): EffortHalves | null {
  const whole = splitFrom(stream, 0);
  if (!whole) return null;
  const from = fractionAfterMoving(stream, WARM_UP_S);
  return {
    ...whole,
    after_warm_up: from != null && from < 0.5 ? splitFrom(stream, from) : null,
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
