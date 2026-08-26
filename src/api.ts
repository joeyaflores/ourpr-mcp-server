// The ourpr API, as this server talks to it.
//
// AUTHENTICATION IS AN ENVIRONMENT VARIABLE, NOT A TOOL PARAMETER, and that is
// a deliberate difference from revenuecat-charts-mcp, which takes `api_key` on
// every call. RevenueCat issues one key per project and a person may hold
// several, so asking per call is right there. An ourpr token belongs to ONE
// runner and never changes between calls, so a parameter would put a live
// credential into every tool call the agent makes — into its context, its
// transcript, and any log of either. The env var keeps it out of all three.
//
// NOTHING HERE MAY WRITE TO STDOUT. On a stdio server stdout IS the protocol
// stream, and one stray `console.log` corrupts it. Diagnostics go to stderr.

const TOKEN = process.env.OURPR_TOKEN ?? "";
const BASE = (process.env.OURPR_API_URL ?? "https://ourpr.app/api").replace(/\/$/, "");

/** Thrown with copy an agent can act on rather than a status code. */
export class ApiError extends Error {}

function guidance(status: number, detail: string): string {
  if (status === 401) {
    return (
      "ourpr rejected the token. It may be revoked, expired (a token lasts 90 " +
      "days), or OURPR_TOKEN may be unset. Make a new one in ourpr under " +
      "Settings, Access tokens."
    );
  }
  if (status === 403) return "That token can read only. This action needs a write scope.";
  if (status === 404) return "ourpr has no such run. Check the id against ourpr_list_runs.";
  if (status === 422) return `ourpr refused the request: ${detail}`;
  if (status >= 500) return "ourpr had an error. Try again in a moment.";
  return detail || `ourpr answered ${status}.`;
}

export async function get<T>(path: string): Promise<T> {
  if (!TOKEN) {
    throw new ApiError(
      "OURPR_TOKEN is not set. Create a token in ourpr under Settings, " +
        "Access tokens, then put it in this server's environment.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new ApiError(
      `Could not reach ourpr at ${BASE}. Check OURPR_API_URL and the network. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? "";
    } catch {
      // A non-JSON error body. The status still carries the meaning.
    }
    throw new ApiError(guidance(response.status, detail));
  }
  return (await response.json()) as T;
}

// ─── Units ──────────────────────────────────────────────────────────────────
//
// The API speaks metres and stores pace as a string, "7:43". An agent reads
// miles and reasons about pace as text. Convert once, here, so no tool does it
// twice and no two tools do it differently.

export const METERS_PER_MILE = 1609.344;

export const miles = (meters?: number | null): number | null =>
  meters == null ? null : Math.round((meters / METERS_PER_MILE) * 100) / 100;

export const feet = (meters?: number | null): number | null =>
  meters == null ? null : Math.round(meters * 3.28084);

/** "1h 27m" or "48m". Seconds are noise at this scale. */
export function duration(seconds?: number | null): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** A day key, YYYY-MM-DD, out of whatever the API stored. */
export const day = (iso?: string | null): string => (iso ?? "").slice(0, 10);

/**
 * A calendar date to the Unix second the API wants.
 *
 * TOOLS TAKE DATES AND THE API TAKES TIMESTAMPS. An agent is asked "what did I
 * run in July", not "what did I run between 1751328000 and 1754006400", and
 * making it do that arithmetic is a step where it can quietly be wrong.
 * `end` pushes to the end of the day so a single-day window holds that day.
 */
export function stamp(date: string, edge: "start" | "end"): number {
  const time = edge === "start" ? "T00:00:00Z" : "T23:59:59Z";
  const ms = Date.parse(`${date}${time}`);
  if (Number.isNaN(ms)) {
    throw new ApiError(`"${date}" is not a date. Use YYYY-MM-DD.`);
  }
  return Math.floor(ms / 1000);
}
