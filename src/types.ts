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

/** One plan as the API returns it. */
export interface PlannedRun {
  id: string;
  planned_date: string;
  activity_type?: string | null;
  name: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  note?: string | null;
  course_slug?: string | null;
  tag: string | null;
  is_long: boolean;
  source: "app" | "token";
  // Set once a logged run fulfils the plan; the id ourpr_get_run takes.
  completed_activity_id?: string | null;
}

export interface WeekMiles {
  week_key: string;
  miles: number;
  runs: number;
}

/** One Block: the race-anchored weeks before a race, or before the goal race. */
export interface RaceArc {
  race_name: string;
  race_date: string;
  distance_category: string;
  // A result for a race run; the goal time, or "", for the goal.
  finish_time: string;
  // Week 1's Monday.
  arc_start: string;
  arc_weeks: number;
  is_goal: boolean;
  total_miles: number;
  total_runs: number;
  tune_ups: { race_name: string; race_date: string; distance_category: string; finish_time: string }[];
  key_workouts: { name: string; date: string; distance_miles: number; workout_type: string }[];
  weekly_mileage: WeekMiles[];
}

export interface RaceArcsResponse {
  arcs: RaceArc[];
  total_races: number;
}

export interface RaceRow {
  activity_id: string;
  name: string;
  date: string;
  distance_miles: number;
  distance_category: string;
  duration_seconds: number;
  pace_per_mile?: string | null;
  // The Block this race closed; null for a tune-up raced inside another.
  block_slug?: string | null;
}

export interface RaceHistoryResponse {
  races: RaceRow[];
  total: number;
}

export interface TerrainResponse {
  matches: TerrainMatch[];
  scanned: number;
}
