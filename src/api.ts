// The token is an environment variable, never a tool parameter, so no call carries it.

import { cell } from "./safe.js";

const TOKEN = process.env.OURPR_TOKEN ?? "";
const BASE = (process.env.OURPR_API_URL ?? "https://ourpr.onrender.com/api").replace(/\/$/, "");

// A token over plain http travels in the clear; localhost is the dev backend.
if (BASE.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  console.error(
    "[ourpr-mcp-server] OURPR_API_URL is http, not https - the token is not encrypted in transit",
  );
}

/** The configured host only; userinfo, path and query never reach an error. */
function safeOrigin(): string {
  try {
    const url = new URL(BASE);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "the configured host";
  }
}

/** The error code, never the message, which can carry the request URL. */
function reason(err: unknown): string {
  // Node puts the useful code one or two levels down in cause.
  let node: unknown = err;
  for (let depth = 0; node && depth < 4; depth++) {
    const code = (node as { code?: string }).code;
    if (typeof code === "string" && code) return code;
    node = (node as { cause?: unknown }).cause;
  }
  // A message passes only when it cannot carry a configured value.
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

function guidance(status: number, detail: string, retryAfterS?: string): string {
  if (status === 429) {
    const wait = /^\d+$/.test(retryAfterS ?? "") ? `${retryAfterS} seconds` : "a minute";
    return `ourpr allows 60 reads a minute for each token. Wait ${wait}, then ask again.`;
  }
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

// The path is logged and the token never is.
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
      // A request that carries the token never follows a redirect.
      redirect: "manual",
    });
  } catch (err) {
    throw new ApiError(
      `Could not reach ourpr at ${safeOrigin()} (${reason(err)}). Check ` +
        "OURPR_API_URL and the network.",
    );
  }

  // Outside the try, so a redirect is not reported as a network failure.
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
      // detail is remote text and is cleaned like any other.
      detail = cell(((await response.json()) as { detail?: string }).detail, 200);
    } catch {
      // The status carries the meaning without a body.
    }
    audit(path, `${response.status}`, Date.now() - started);
    throw new ApiError(
      guidance(response.status, detail, response.headers.get("retry-after") ?? undefined),
    );
  }
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    // A non-JSON body can leak into the parse error, so the error is replaced.
    audit(path, "200-not-json", Date.now() - started);
    throw new ApiError(
      `ourpr at ${safeOrigin()} answered 200 with a body that is not JSON. ` +
        "Check OURPR_API_URL - it should be the API base, ending in /api.",
    );
  }
  audit(path, "200", Date.now() - started);
  return body;
}

// Units: the API speaks metres and an agent reads miles. Convert once, here.

/** Encoded, so a crafted id stays one path segment. */
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

/** A calendar date to a Unix second; "end" reaches the end of the day. */
export function stamp(date: string, edge: "start" | "end"): number {
  const time = edge === "start" ? "T00:00:00Z" : "T23:59:59Z";
  const ms = Date.parse(`${date}${time}`);
  if (Number.isNaN(ms)) {
    throw new ApiError(`"${date}" is not a date. Use YYYY-MM-DD.`);
  }
  return Math.floor(ms / 1000);
}
