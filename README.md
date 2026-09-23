# ourpr-mcp-server

An MCP server that lets an AI agent read **your own** running history from
[ourpr](https://ourpr.app). Ask about your training in plain language, in
whatever agent you already use.

Read only. It cannot change a run, plan a week, or issue another credential.

## Why it exists

Every authenticated read in ourpr is gated by a session that lives about an
hour, so nothing outside a browser could hold one. Personal access tokens
changed that, and this is what they were for: your data, in your tools, with a
credential you issued to yourself and can revoke.

## Setup

**1. Make a token.** In ourpr, go to **Settings → Access tokens → New token**.
Name it after the machine it will live on. Copy it — it is shown once and
cannot be recovered. A token lasts 90 days.

**2. Point a client at it.** The package runs from npm; nothing to clone.

### Claude Code

```bash
claude mcp add ourpr --env OURPR_TOKEN=ourpr_pat_... -- npx -y ourpr-mcp-server
```

### Claude Desktop

Download `ourpr.mcpb` from the latest release and open it. Claude Desktop asks
for the token and stores it as a secret.

Or edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ourpr": {
      "command": "npx",
      "args": ["-y", "ourpr-mcp-server"],
      "env": { "OURPR_TOKEN": "ourpr_pat_..." }
    }
  }
}
```

### Cursor, VS Code

`.cursor/mcp.json` or `.vscode/mcp.json`, same shape as above.

### From source

```bash
git clone https://github.com/joeyaflores/ourpr-mcp-server.git
cd ourpr-mcp-server
npm install && npm run build && npm test
```

## Environment

| | |
|---|---|
| `OURPR_TOKEN` | **Required.** Your personal access token. |
| `OURPR_API_URL` | Optional. Defaults to `https://ourpr.onrender.com/api`. |

The token is an environment variable and **not** a tool parameter, on purpose:
it never changes between calls, so passing it per call would put a live
credential into the agent's context, its transcript, and any log of either.

## Tools

### `ourpr_list_runs`

Your history between two dates, as a compact table: date, name, type, miles,
pace, moving time, elevation, average heart rate.

**Start here for almost anything** — totals, streaks, trends, finding a run.

```
"How many miles did I run in July?"
"What was my longest run this spring?"
"Show me every run over 15 miles in 2026"
```

`start_date`, `end_date` (YYYY-MM-DD), `include_non_runs`, `limit`.

It never truncates silently: if the window holds more than `limit`, the answer
says how many were left out.

### `ourpr_get_run`

One activity in full, with its mile splits, heart rate, cadence, calories and
recording device.

```
"Break down my Boston Marathon splits"
"Did I positive or negative split that half?"
```

### `ourpr_run_stream`

A run resampled onto a fixed 10 metre grid — elevation, elapsed time, and
where the watch recorded them, heart rate, power and cadence. Returns summary
statistics per channel rather than every sample.

A 404 is a normal answer: indoor runs have no profile.

### `ourpr_run_laps`

The laps the watch itself recorded — the runner's own button presses, which is
what a track session is actually divided by. Different from mile splits: laps
follow the workout, splits follow the mile.

### `ourpr_rep_workouts`

Every interval session ourpr can find in your history, with the reps and their
distance. An empty answer says how many activities were read, because "none
found" and "none exist" are different claims.

### `ourpr_detect_reps`

Ask whether one particular run was an interval session.

### `ourpr_similar_terrain`

Runs matching a given distance and climb — how you find what you have already
done that resembles a race you are training for.

```
"What have I run that's like Boston — 26 miles, 800 feet of climb?"
```

### `ourpr_plan_week`

The one write. One planned run, or a week of them, onto days still ahead.
Each lands on the runner's week as a plan they can see, edit and remove; the
day sheet says it came from outside. It never logs a run.

```
"Put a 6 mile easy run on Tuesday and 14 long on Saturday"
"Write me next week: three easy days, one workout, one long run"
```

`plans`, one to fourteen, each with `date` (YYYY-MM-DD, after today) and any
of `miles`, `minutes`, `name`, `note`, `tag` (easy, workout, race), `is_long`.

Needs a token made with the **Read and write** scope in Settings, and ourpr
create behind it. A read-only token, or one without it, is refused before
anything is written. Thirty plans a day.

## How the tool set was chosen

By an evaluation, not by listing the API.

Ten questions with verified answers were written first, computed straight from
the database by an oracle that shares no code with this server
(`backend/scripts/mcp_eval_oracle.py`). They said what actually matters: nine
of ten need the activity window, three need one run in full, two need a second
source.

So the window is the tool that has to be excellent — and a `training_summary`
tool that seemed obvious while guessing turned out to answer nothing, and was
not built.

Two of those questions are answered through this server, over the protocol, in
four tool calls, and both match the oracle exactly:

```
Q1 peak week   : 63.6   oracle 63.6   MATCH
Q2 fastest 10mi: 6:23   oracle 6:23   MATCH
```

## Context is the real constraint

A window can hold 800 runs. Handing an agent 800 full activity objects destroys
the context it needs to think with, so `ourpr_list_runs` returns a compact
markdown table and one run in full is a separate tool.

Same for streams: a ten mile run is about 1,600 samples per channel across five
channels, so the tool returns min, average, max and coverage rather than 8,000
numbers the agent would only reduce anyway.

## Security

The token grants read access to your own activity data. A token made with the
write scope, with ourpr create, may also put plans on your own week through
one route, and nothing else. No token can log a run, issue another token, revoke
your existing ones, or widen its own scope.

Each token may make 60 reads a minute, and a runner may write 30 plans a day.
ourpr answers 429 past either, with `RateLimit` and `Retry-After` headers, and
the tool says how long to wait.

Revoke any token at any time in **Settings → Access tokens**. Revocation is
immediate and permanent — a revoked token can never be restored.

### Tool results are untrusted content

A run's name and description are free text a person typed, or that arrived from
an import. They travel into the same token stream as the agent's instructions,
and a model has no boundary between the two.

Two defences, doing different jobs:

**The structure is neutralised.** Control characters, newlines, zero-width and
bidirectional marks are stripped; a `|` is escaped so the table column it sits
in survives; every field is capped. A newline in a name would otherwise end a
table row early and shift every column after it — an agent then reads a wrong
answer rather than refusing one.

**The boundary is named.** Runner-authored data is returned inside
`<ourpr-data>` delimiters with one line saying it is data, not instructions.
That reduces how often injection lands. It does not prevent it, and nothing
here is written as though it did. The delimiters wrap the text content only;
the structured result carries the same neutralised fields without them.

What this deliberately does not do is pattern-match for "ignore previous
instructions" and its cousins. That is whack-a-mole against anyone who writes
the sentence differently, and it would suggest the content had been made safe.

### No configured value is ever printed

`OURPR_TOKEN` appears in no log, no error and no tool result.

`OURPR_API_URL` is reduced to scheme and host before it reaches an error
message. It is a URL, so it can carry `user:password@` — which a self-hosted
instance behind basic auth plausibly would — and an error goes straight into
the agent's transcript.

This is not hypothetical. Node's own fetch error for such a URL reads:

```
Request cannot be constructed from a URL that includes credentials:
https://admin:s3cr3t@127.0.0.1:59999/api
```

The password is in the message. This server passes an underlying error message
through only when it contains no `@`, no configured base URL and no token, and
otherwise falls back to the error code.

### Other properties

**No token passthrough.** The server holds its own credential from the
environment and never accepts one from the MCP client, which is what the
specification forbids.

**Redirects are refused.** A request carrying a credential does not follow one.

**Every call is logged to stderr** — outcome, path without its query, and
duration. The token is never in it.

**Stateless.** No handles are minted, so there is nothing to hijack.

## Release

A tag `v*` publishes to npm through trusted publishing (GitHub OIDC, provenance
attached; no token lives in the repository). `npm run build` writes the
bundle's entry point; `npx @anthropic-ai/mcpb pack` builds `ourpr.mcpb` for
the release. `server.json` registers the package in the MCP Registry with
`mcp-publisher publish`.

## License

MIT
