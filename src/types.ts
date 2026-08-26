// What the ourpr API returns, narrowed to the fields these tools read.
//
// DELIBERATELY PARTIAL. `DetailedActivity` on the backend carries far more
// than this, and copying it whole would put every field into an agent's
// context whether or not a tool uses it. These interfaces name what is read
// and nothing else, which is the same whitelist discipline the backend's own
// response model keeps.

/** One activity. Every measure is optional because a measure that does not
 *  apply is NULL and is not zero — a strength session covers no ground, and a
 *  treadmill run has no route. The backend's `activity_taxonomy` is the
 *  authority on which measures a type carries. */
export interface Activity {
  id: string | number;
  name: string | null;
  date: string;
  activity_type: string;
  distance_meters?: number | null;
  /** Stored as "7:43", not as a number. */
  pace_per_mile?: string | null;
  duration_seconds?: number | null;
  elevation_gain_meters?: number | null;
  avg_heartrate?: number | null;
  max_heartrate?: number | null;
  avg_cadence?: number | null;
  calories?: number | null;
  device?: string | null;
  splits?: Split[] | null;
  garmin?: Record<string, unknown> | null;
  summary_polyline?: string | null;
}

export interface Split {
  split_number: number;
  pace_per_mile?: string | null;
  distance_meters?: number | null;
  moving_time_seconds?: number | null;
  elevation_difference_meters?: number | null;
}

export interface ActivitiesResponse {
  activities: Activity[];
  total_count: number;
  is_complete: boolean;
}

/** Migration 056: a run resampled onto a fixed 10 m grid. Distance is implied
 *  by index — sample i sits at i * grid_m — so there is no distance array. */
export interface StreamResponse {
  activity_id: string;
  grid_m: number;
  /** How many samples each channel holds. The API sends it; do not derive it
   *  from a channel, because a channel below 50% coverage is not written at
   *  all and would report zero. */
  points: number;
  total_m: number;
  /** `elev_cm` and NOT `elevation_cm`. Written from the payload rather than
   *  from memory, after the first guess made elevation silently vanish from
   *  every profile — the failure that succeeds and accomplishes nothing. */
  elev_cm?: (number | null)[] | null;
  time_s?: (number | null)[] | null;
  hr_bpm?: (number | null)[] | null;
  power_w?: (number | null)[] | null;
  cadence_spm?: (number | null)[] | null;
  /** Where the samples came from, e.g. "garmin_fit". */
  source?: string | null;
}

/** A lap as the API sends it. Read off the payload, not from memory — the
 *  first guess named four fields that do not exist and the table rendered a
 *  column of em dashes, which reads as "the watch recorded nothing". */
export interface Lap {
  index: number;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  moving_seconds?: number | null;
  elapsed_seconds?: number | null;
}

export interface RepGroup {
  count: number;
  rep_meters: number;
  times_s?: number[] | null;
  recovery_meters?: number | null;
}

export interface RepWorkout {
  activity_id: string | number;
  date: string;
  name?: string | null;
  groups?: RepGroup[] | null;
}

/** Both sweeps report how much they LOOKED AT, not only what they found. An
 *  empty answer means "none in the 60 I read", never "you have none" — the
 *  no-silent-caps rule, carried through to the agent. */
export interface RepWorkoutsResponse {
  workouts: RepWorkout[];
  scanned: number;
}

export interface TerrainMatch {
  activity_id: string;
  name: string;
  date: string;
  from_mi: number;
  to_mi: number;
  gain_ft: number;
  grade_pct: number;
}

export interface TerrainResponse {
  matches: TerrainMatch[];
  scanned: number;
}
