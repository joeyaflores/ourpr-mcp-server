import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ApiError, day, duration, feet, get, miles, pathId, stamp } from "./api.js";
import { cell, fenced } from "./safe.js";
import type {
  ActivitiesResponse,
  Activity,
  Lap,
  RepWorkoutsResponse,
  StreamResponse,
  TerrainResponse,
} from "./types.js";

// Read only: every route behind these tools is a GET.

// device keys vary: the human pair first, then a single name, then the raw slug.
function deviceLabel(d: Activity["device"]): string | null {
  if (!d) return null;
  const named = [d.make, d.model].filter(Boolean).join(" ").trim();
  return cell(named || d.app || d.raw, 40) || null;
}

const server = new McpServer({ name: "ourpr-mcp-server", version: "0.1.0" });

// Bounds one answer; when it bites, the answer says so.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const ok = (text: string, structured: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: structured,
});

// An error reaches the agent as an error result with copy it can act on.
const fail = (err: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: err instanceof ApiError ? err.message : `Unexpected: ${String(err)}`,
    },
  ],
  isError: true,
});

function summarise(a: Activity) {
  return {
    id: String(a.id),
    date: day(a.date),
    name: cell(a.name),
    type: cell(a.activity_type, 24),
    miles: miles(a.distance_meters),
    pace_per_mile: a.pace_per_mile ?? null,
    moving_time: duration(a.duration_seconds),
    elevation_ft: feet(a.elevation_gain_meters),
    avg_hr: a.avg_heartrate ?? null,
  };
}

// A markdown table costs fewer tokens than the same rows as objects.
function table(rows: ReturnType<typeof summarise>[]): string {
  const head =
    "| date | name | type | mi | pace | time | ft | hr |\n" +
    "|---|---|---|---|---|---|---|---|";
  const body = rows
    .map((r) =>
      `| ${r.date} | ${r.name} | ${r.type} | ${r.miles ?? "—"} | ` +
      `${r.pace_per_mile ?? "—"} | ${r.moving_time ?? "—"} | ` +
      `${r.elevation_ft ?? "—"} | ${r.avg_hr ?? "—"} |`,
    )
    .join("\n");
  return `${head}\n${body}`;
}

// ─── The window ─────────────────────────────────────────────────────────────

server.registerTool(
  "ourpr_list_runs",
  {
    title: "List runs in a date range",
    description:
      "Training history between two dates, newest first: date, name, type, " +
      "miles, pace, time, elevation, average heart rate. Start here for " +
      "totals, streaks, trends, or finding a run. For one run's splits, use " +
      "ourpr_get_run with an id from here.",
    inputSchema: {
      start_date: z
        .string()
        .describe("First day to include, YYYY-MM-DD. Example: 2026-01-01"),
      end_date: z
        .string()
        .describe("Last day to include, YYYY-MM-DD. Example: 2026-06-30"),
      include_non_runs: z
        .boolean()
        .default(false)
        .describe("Include rides, gym and other types. Runs only by default."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .default(DEFAULT_LIMIT)
        .describe("Most rows to return. The answer says what it left out."),
    },
    outputSchema: {
      runs: z.array(z.record(z.string(), z.unknown())),
      returned: z.number(),
      total_in_window: z.number(),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ start_date, end_date, include_non_runs, limit }) => {
    try {
      const data = await get<ActivitiesResponse>(
        `/users/me/activities?after=${stamp(start_date, "start")}` +
          `&before=${stamp(end_date, "end")}` +
          `&include_non_runs=${include_non_runs}`,
      );
      const all = data.activities.map(summarise);
      const shown = all.slice(0, limit);
      const truncated = all.length > shown.length;

      const header =
        `${all.length} ${include_non_runs ? "activities" : "runs"} between ` +
        `${cell(start_date, 10)} and ${cell(end_date, 10)}.` +
        (truncated
          ? ` Showing the ${shown.length} newest — ${all.length - shown.length} ` +
            "older ones are not listed. Narrow the dates or raise `limit` to see them."
          : "");

      return ok(`${header}\n\n` + fenced(shown.length ? table(shown) : "No activities in that window."), {
        runs: shown,
        returned: shown.length,
        total_in_window: all.length,
        truncated,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── One run ────────────────────────────────────────────────────────────────

server.registerTool(
  "ourpr_get_run",
  {
    title: "Get one run in full",
    description:
      "One activity in full: mile splits, heart rate, cadence, calories, " +
      "device. Id comes from ourpr_list_runs. For the profile along the " +
      "route, use ourpr_run_stream.",
    inputSchema: {
      activity_id: z
        .string()
        .describe("Run id from ourpr_list_runs."),
    },
    outputSchema: {
      run: z.record(z.string(), z.unknown()),
      splits: z.array(z.record(z.string(), z.unknown())),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ activity_id }) => {
    try {
      const a = await get<Activity>(`/users/me/activities/${pathId(activity_id)}`);
      const splits = (a.splits ?? []).map((s) => ({
        mile: s.split_number,
        pace: s.pace_per_mile ?? null,
        elevation_change_ft: feet(s.elevation_difference_meters),
      }));
      const run = {
        ...summarise(a),
        max_hr: a.max_heartrate ?? null,
        avg_cadence_spm: a.avg_cadence ?? null,
        calories: a.calories ?? null,
        device: deviceLabel(a.device),
        has_route: Boolean(a.summary_polyline),
      };

      const lines = [
        `**${run.name || "Untitled"}** — ${run.date}`,
        `${run.miles ?? "—"} mi · ${run.pace_per_mile ?? "—"}/mi · ` +
          `${run.moving_time ?? "—"} · ${run.elevation_ft ?? "—"} ft climb`,
        run.avg_hr ? `Heart rate ${run.avg_hr} avg, ${run.max_hr ?? "—"} max` : "",
        splits.length
          ? `\n| mile | pace | ± ft |\n|---|---|---|\n` +
            splits.map((s) => `| ${s.mile} | ${s.pace ?? "—"} | ${s.elevation_change_ft ?? "—"} |`).join("\n")
          : "\nNo mile splits recorded for this run.",
      ].filter(Boolean);

      return ok(fenced(lines.join("\n")), { run, splits });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── The profile ────────────────────────────────────────────────────────────

server.registerTool(
  "ourpr_run_stream",
  {
    title: "Get a run's elevation and sensor profile",
    description:
      "A run's profile on a 10 m grid — elevation, heart rate, power, " +
      "cadence — as min, average, max and coverage per channel, not every " +
      "sample. No profile is a normal answer for an indoor run.",
    inputSchema: {
      activity_id: z.string().describe("Run id from ourpr_list_runs."),
    },
    outputSchema: {
      grid_m: z.number(),
      total_miles: z.number(),
      samples: z.number(),
      channels: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ activity_id }) => {
    try {
      const s = await get<StreamResponse>(
        `/users/me/activities/${pathId(activity_id)}/stream`,
      );

      // A summary, not the samples: a 10 mile run is about 8,000 numbers.
      const stats = (values?: (number | null)[] | null, scale = 1) => {
        const nums = (values ?? []).filter((v): v is number => v != null);
        if (!nums.length) return null;
        const sum = nums.reduce((a, b) => a + b, 0);
        return {
          min: Math.round((Math.min(...nums) * scale) * 10) / 10,
          max: Math.round((Math.max(...nums) * scale) * 10) / 10,
          avg: Math.round(((sum / nums.length) * scale) * 10) / 10,
          coverage: Math.round((nums.length / (values?.length || 1)) * 100),
        };
      };

      const channels = {
        // Stored in centimetres; the app speaks feet.
        elevation_ft: stats(s.elev_cm, 0.0328084),
        heart_rate_bpm: stats(s.hr_bpm),
        power_w: stats(s.power_w),
        cadence_spm: stats(s.cadence_spm),
      };
      const present = Object.entries(channels)
        .filter(([, v]) => v)
        .map(([k, v]) => `- ${k}: min ${v!.min}, avg ${v!.avg}, max ${v!.max} (${v!.coverage}% of samples)`)
        .join("\n");

      const total_miles = miles(s.total_m) ?? 0;
      return ok(
        `Profile over ${total_miles} mi, ${s.points} samples every ${s.grid_m} m` +
          (s.source ? ` (from ${cell(s.source, 24)})` : "") +
          ".\n\n" +
          (present || "No sensor channels were recorded for this run."),
        { grid_m: s.grid_m, total_miles, samples: s.points, channels },
      );
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── Laps ───────────────────────────────────────────────────────────────────

server.registerTool(
  "ourpr_run_laps",
  {
    title: "Get a run's laps",
    description:
      "The laps the watch recorded for one run — the runner's own button " +
      "presses. Laps follow the workout; mile splits follow the mile.",
    inputSchema: {
      activity_id: z.string().describe("Run id from ourpr_list_runs."),
    },
    outputSchema: { laps: z.array(z.record(z.string(), z.unknown())) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ activity_id }) => {
    try {
      const raw = await get<Lap[]>(`/users/me/activities/${pathId(activity_id)}/laps`);
      const laps = raw.map((l, i) => {
        const mi = miles(l.distance_meters);
        // The payload carries no pace; moving seconds, as the app measures it.
        const secs = l.moving_seconds ?? l.duration_seconds ?? null;
        const perMile = mi && secs ? secs / mi : null;
        return {
          // The API counts from zero; a watch counts from one.
          lap: (l.index ?? i) + 1,
          miles: mi,
          time: duration(secs),
          pace: perMile
            ? `${Math.floor(perMile / 60)}:${String(Math.round(perMile % 60)).padStart(2, "0")}`
            : null,
        };
      });
      const text = laps.length
        ? `${laps.length} laps.\n\n| lap | mi | time | pace |\n|---|---|---|---|\n` +
          laps.map((l) => `| ${l.lap} | ${l.miles ?? "—"} | ${l.time ?? "—"} | ${l.pace ?? "—"} |`).join("\n")
        : "No laps recorded for this run.";
      return ok(text, { laps });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── Rep sessions ───────────────────────────────────────────────────────────

server.registerTool(
  "ourpr_rep_workouts",
  {
    title: "Find rep workouts across the history",
    description:
      "Interval sessions found across the history, with reps and distances. " +
      "Detection is conservative, so a session it misses is still in " +
      "ourpr_list_runs.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(10)
        .max(1000)
        .default(200)
        .describe("How many recent activities to read."),
    },
    outputSchema: {
      workouts: z.array(z.record(z.string(), z.unknown())),
      scanned: z.number(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ limit }) => {
    try {
      const data = await get<RepWorkoutsResponse>(
        `/users/me/activities/rep-workouts?limit=${limit}`,
      );
      const workouts = (data.workouts ?? []).map((w) => ({
        activity_id: String(w.activity_id),
        date: day(w.date),
        name: cell(w.name),
        sets: (w.groups ?? []).map((g) => ({
          reps: g.count,
          rep_meters: g.rep_meters,
          times_s: g.times_s ?? null,
        })),
      }));
      // "None found" and "none exist" differ; only the first is true here.
      const text = workouts.length
        ? `${workouts.length} rep sessions in the ${data.scanned} activities read.\n\n` +
          workouts
            .map(
              (w) =>
                `- ${w.date} · ${w.name || "Untitled"} · ` +
                w.sets.map((s) => `${s.reps} x ${s.rep_meters}m`).join(", "),
            )
            .join("\n")
        : `No rep sessions in the ${data.scanned} most recent activities. ` +
          "Raise `limit` to read further back.";
      return ok(fenced(text), { workouts, scanned: data.scanned });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── Detection on one run ───────────────────────────────────────────────────

server.registerTool(
  "ourpr_detect_reps",
  {
    title: "Look for reps in one run",
    description:
      "Whether one particular run was an interval session, and its reps.",
    inputSchema: {
      activity_id: z.string().describe("Run id from ourpr_list_runs."),
    },
    outputSchema: { detection: z.record(z.string(), z.unknown()) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ activity_id }) => {
    try {
      const detection = await get<Record<string, unknown>>(
        `/users/me/activities/${pathId(activity_id)}/workout-detection`,
      );
      // Bounded, so a dump cannot spend the agent's context.
      const json = JSON.stringify(detection);
      return ok(
        json.length > 4000
          ? `${json.slice(0, 4000)}… (truncated; read the structured result)`
          : json,
        { detection },
      );
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── Terrain ────────────────────────────────────────────────────────────────

server.registerTool(
  "ourpr_similar_terrain",
  {
    title: "Find runs over comparable ground",
    description:
      "Stretches of past runs matching a distance and climb — what the " +
      "runner has already done that resembles a race they are training for.",
    inputSchema: {
      miles: z.number().min(0.1).max(200).describe("Target distance in miles."),
      gain_ft: z.number().min(0).max(30000).describe("Target climb in feet."),
      limit: z.number().int().min(1).max(25).default(8).describe("How many to return."),
      tolerance_ft: z
        .number()
        .min(1)
        .max(200)
        .default(15)
        .describe("Climb tolerance, feet."),
    },
    outputSchema: {
      matches: z.array(z.record(z.string(), z.unknown())),
      scanned: z.number(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ miles: mi, gain_ft, limit, tolerance_ft }) => {
    try {
      const data = await get<TerrainResponse>(
        `/users/me/terrain/similar?miles=${mi}&gain_ft=${gain_ft}` +
          `&limit=${limit}&tolerance_ft=${tolerance_ft}`,
      );
      const matches = data.matches ?? [];
      const text = matches.length
        ? `${matches.length} stretches near ${mi} mi with about ${gain_ft} ft ` +
          `of climb, from ${data.scanned} runs read.\n\n` +
          "| date | run | from mi | to mi | climb ft | grade |\n|---|---|---|---|---|---|\n" +
          matches
            .map(
              (m) =>
                `| ${m.date.slice(0, 10)} | ${cell(m.name, 28)} | ${m.from_mi} | ` +
                `${m.to_mi} | ${m.gain_ft} | ${m.grade_pct}% |`,
            )
            .join("\n")
        : `Nothing near ${mi} mi with about ${gain_ft} ft of climb in the ` +
          `${data.scanned} runs read. Widen \`tolerance_ft\`.`;
      return ok(fenced(text), { matches, scanned: data.scanned });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  await server.connect(new StdioServerTransport());
  // Stdout is the protocol stream; diagnostics go to stderr.
  console.error("[ourpr-mcp-server] ready");
}

main().catch((err) => {
  console.error("[ourpr-mcp-server] fatal:", err);
  process.exit(1);
});
