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
// NOTHING THIS SERVER PRINTS MAY CARRY A CONFIGURED VALUE. `OURPR_TOKEN` is
// never printed anywhere, and `OURPR_API_URL` is reduced to scheme and host
// before it reaches an error — see `safeOrigin`. An error message travels into
// the agent's context and its transcript, so printing there is publishing.
//
// NOTHING HERE MAY WRITE TO STDOUT. On a stdio server stdout IS the protocol
// stream, and one stray `console.log` corrupts it. Diagnostics go to stderr.

import { cell } from "./safe.js";

const TOKEN = process.env.OURPR_TOKEN ?? "";
const BASE = (process.env.OURPR_API_URL ?? "https://ourpr.app/api").replace(/\/$/, "");

// A bearer token over plain http travels in the clear. Warn once rather than
// refuse: localhost is how this server runs against a dev backend.
if (BASE.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  console.error(
    "[ourpr-mcp-server] OURPR_API_URL is http, not https - the token is not encrypted in transit",
  );
}

/**
 * The configured host, with everything else removed.
 *
 * NO ENVIRONMENT VALUE IS ECHOED WHOLE. An error goes straight into the
 * agent's context and its transcript, so anything printed there is published.
 * `OURPR_API_URL` is usually just a hostname — and it is a URL, so it CAN
 * carry `user:password@` before the host, which a self-hosted or staging
 * instance behind basic auth plausibly would. Dropping userinfo, path, query
 * and fragment leaves the one part that helps a person debug and none of the
 * part that must not travel.
 *
 * An unparseable value yields a placeholder rather than the raw string,
 * because "unparseable" is exactly the case where the string is unexpected.
 */
function safeOrigin(): string {
  try {
    const url = new URL(BASE);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "the configured host";
  }
}

/**
 * Why a request failed, WITHOUT the message.
 *
 * A Node fetch failure carries the full request URL in `cause`, and a timeout
 * message can too. The code — ECONNREFUSED, ENOTFOUND, TimeoutError — says
 * everything a person needs and carries nothing they did not choose to
 * publish.
 */
function reason(err: unknown): string {
  // WALK THE CAUSE CHAIN. Node wraps a connection failure as
  // `TypeError: fetch failed` with the useful code — ECONNREFUSED, ENOTFOUND —
  // one or two levels down in `cause`. Reading only the top gave "TypeError",
  // which tells a person nothing they can act on.
  let node: unknown = err;
  for (let depth = 0; node && depth < 4; depth++) {
    const code = (node as { code?: string }).code;
    if (typeof code === "string" && code) return code;
    node = (node as { cause?: unknown }).cause;
  }
  // NO CODE — a URL that will not parse ("bad port") reaches here, and its
  // MESSAGE is the only useful thing. Passed on ONLY when it cannot be
  // carrying configured values: an "@" means userinfo, and the raw base or the
  // token must never appear. Fails closed to the error name.
  const deepest = deepestMessage(err);
  const safe =
    deepest &&
    !deepest.includes("@") &&
    !deepest.includes(BASE) &&
    (!TOKEN || !deepest.includes(TOKEN));
  if (safe) return deepest.slice(0, 80);

  const name = err instanceof Error ? err.name : "";
  return name && name !== "Error" ? name : "the request did not complete";
}

function deepestMessage(err: unknown): string {
  let node: unknown = err;
  let found = "";
  for (let depth = 0; node && depth < 4; depth++) {
    const message = (node as { message?: string }).message;
    if (typeof message === "string" && message && message !== "fetch failed") {
      found = message;
    }
    node = (node as { cause?: unknown }).cause;
  }
  return found;
}

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

/**
 * One line per call, on stderr.
 *
 * The 2026 guidance asks a server to log tool invocations, downstream calls,
 * errors and denials, so an operator can see what an agent did on their
 * behalf. THE PATH IS LOGGED AND THE TOKEN NEVER IS — a log that carries the
 * credential is a second copy of it, in a file nobody is guarding.
 */
function audit(path: string, outcome: string, ms: number): void {
  console.error(`[ourpr-mcp-server] ${outcome} ${path.split("?")[0]} ${ms}ms`);
}

export async function get<T>(path: string): Promise<T> {
  const started = Date.now();
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
      // DO NOT FOLLOW REDIRECTS WITH A CREDENTIAL ATTACHED. Node strips the
      // Authorization header across origins, so this is belt rather than
      // braces — but a redirect from ourpr's own host is not something this
      // server should follow silently either, because the answer would then
      // come from somewhere the operator did not configure.
      redirect: "manual",
    });
  } catch (err) {
    throw new ApiError(
      `Could not reach ourpr at ${safeOrigin()} (${reason(err)}). Check ` +
        "OURPR_API_URL and the network.",
    );
  }

  // OUTSIDE THE TRY, deliberately. Thrown inside it, this was caught by the
  // network handler two lines up and re-reported as "could not reach ourpr" —
  // an error that names the wrong cause is worse than the status code it
  // replaced.
  if (response.status >= 300 && response.status < 400) {
    audit(path, `${response.status}-redirect`, Date.now() - started);
    throw new ApiError(
      "ourpr redirected the request, and this server does not follow " +
        "redirects while carrying a credential. Check OURPR_API_URL — it " +
        "should be the API base, ending in /api.",
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      // CLEANED LIKE ANY OTHER REMOTE TEXT. Today `detail` is written by the
      // backend, but a future backend change could derive it from runner
      // text, and this is the one place it enters an error message.
      detail = cell(((await response.json()) as { detail?: string }).detail, 200);
    } catch {
      // A non-JSON error body. The status still carries the meaning.
    }
    audit(path, `${response.status}`, Date.now() - started);
    throw new ApiError(guidance(response.status, detail));
  }
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    // A 200 whose body is not JSON - a proxy page, a captive portal. The
    // parse error's message can carry a fragment of that body, so the error
    // is replaced rather than passed on.
    audit(path, "200-not-json", Date.now() - started);
    throw new ApiError(
      `ourpr at ${safeOrigin()} answered 200 with a body that is not JSON. ` +
        "Check OURPR_API_URL - it should be the API base, ending in /api.",
    );
  }
  audit(path, "200", Date.now() - started);
  return body;
}

// ─── Units ──────────────────────────────────────────────────────────────────
//
// The API speaks metres and stores pace as a string, "7:43". An agent reads
// miles and reasons about pace as text. Convert once, here, so no tool does it
// twice and no two tools do it differently.

/**
 * An id on its way into a URL path.
 *
 * Ids arrive from the agent, and an agent can be steered by text inside a
 * tool result. Unencoded, a crafted id could append query parameters or move
 * the request to a sibling path - fetch normalises "../" before sending.
 * Encoding makes the id one path segment and nothing more.
 */
export const pathId = (value: string): string => encodeURIComponent(value);

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
