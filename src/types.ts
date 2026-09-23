// Deliberately partial: only the fields a tool reads.

// A measure that does not apply is null, not zero.
export interface Activity {
  id: string | number;
  name: string | null;
  date: string;
  activity_type: string;
  distance_meters?: number | null;
  // Stored as "7:43", not as a number.
  pace_per_mile?: string | null;
  duration_seconds?: number | null;
  elevation_gain_meters?: number | null;
  avg_heartrate?: number | null;
  max_heartrate?: number | null;
  avg_cadence?: number | null;
  calories?: number | null;
  // An object whose keys vary; read it with deviceLabel.
  device?: {
    raw?: string | null;
    make?: string | null;
    model?: string | null;
    app?: string | null;
  } | null;
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

// A 10 m grid; sample i sits at i * grid_m.
export interface StreamResponse {
  activity_id: string;
  grid_m: number;
  // Sent by the API; a channel below 50% coverage is absent and cannot give it.
  points: number;
  total_m: number;
  // The key is elev_cm, not elevation_cm.
  elev_cm?: (number | null)[] | null;
  time_s?: (number | null)[] | null;
  hr_bpm?: (number | null)[] | null;
  power_w?: (number | null)[] | null;
  cadence_spm?: (number | null)[] | null;
  source?: string | null;
}

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

// scanned says how much was read; an empty answer is not "none exist".
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

/** One plan as the API returns it after a write. */
export interface PlannedRun {
  id: string;
  planned_date: string;
  name: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  tag: string | null;
  is_long: boolean;
  source: "app" | "token";
}

export interface TerrainResponse {
  matches: TerrainMatch[];
  scanned: number;
}
