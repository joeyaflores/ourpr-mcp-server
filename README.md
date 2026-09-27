# ourpr-mcp-server

An MCP server that lets an AI agent read **your own** running history from
[ourpr](https://ourpr.app), and write one thing back. Ask about your
training in plain language, in whatever agent you already use.

Every tool reads. One tool writes, and only that one: `ourpr_plan_week` puts
a plan on a day still ahead. It cannot log a run, edit history, or issue
another credential, and it needs a token made with the write scope.

In Claude you do not need this package. Add ourpr. from
https://ourpr.app/your-runs: it signs you in once, with no token and nothing
to install. This package is for a script or an agent on your own computer.

## Price

Reading your own runs is free. Planning is part of **ourpr create**, $10 a
month, cancel any time: `ourpr_plan_week` answers only on an account that has
it. Nothing else in ourpr costs money.

## Why it exists

Every authenticated read in ourpr is gated by a session that lives about an
hour, so nothing outside a browser could hold one. Personal access tokens
changed that, and this is what they were for: your data, in your tools, with a
credential you issued to yourself and can revoke.

## Setup

**1. Make a token.** In ourpr, go to **Settings → ourpr. mcp → Tokens for a
script or a local server → New token**. Name it after the machine it
will live on, and choose **Write** if you want the agent to plan your week;
**Read** otherwise. Copy it — it is shown once and cannot be
recovered. A token lasts 90 days.

**2. Point a client at it.** The package runs from npm; nothing to clone.

**Keep the token out of any file inside a project.** A project's `.mcp.json`,
`.cursor/mcp.json` or `.vscode/mcp.json` is often committed, and a committed
token can be read by anyone who can read the repository. Every setup below
keeps the token in a user-level place or in your system's secret store.

**Pin the version.** Each setup names an exact version, so a new release never
runs with your token until you choose it. Change the number to update.

### Claude Code

Read the token without echoing it, so it stays out of your shell history, then
add the server for your user, not for a project:

```bash
printf 'Token: '; read -rs OURPR_TOKEN; echo
claude mcp add --scope user --env OURPR_TOKEN="$OURPR_TOKEN" --transport stdio \
  ourpr -- npx -y ourpr-mcp-server@0.4.1
unset OURPR_TOKEN
```

Claude Code keeps it in `~/.claude.json`, which belongs to your user.

### Claude Desktop

Download `ourpr.mcpb` from the latest release and open it. Claude Desktop asks
for the token and keeps it in your system's secret store. This is the
recommended way.

Or edit `claude_desktop_config.json`, which lives in your user folder, not in
a project. The token is then plain text in that file:

```json
{
  "mcpServers": {
    "ourpr": {
      "command": "npx",
      "args": ["-y", "ourpr-mcp-server@0.4.1"],
      "env": { "OURPR_TOKEN": "ourpr_pat_..." }
    }
  }
}
```

### VS Code

Run **MCP: Open User Configuration** and add the server there. VS Code asks
for the token once, masks it, and keeps it in its secret store:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "ourpr-token",
      "description": "ourpr personal access token",
      "password": true
    }
  ],
  "servers": {
    "ourpr": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ourpr-mcp-server@0.4.1"],
      "env": { "OURPR_TOKEN": "${input:ourpr-token}" }
    }
  }
}
```

### Cursor

Set `OURPR_TOKEN` in your shell profile or your system's secret manager, and
add the server to the global `~/.cursor/mcp.json`. The file holds only a
reference to the variable:

```json
{
  "mcpServers": {
    "ourpr": {
      "command": "npx",
      "args": ["-y", "ourpr-mcp-server@0.4.1"],
      "env": { "OURPR_TOKEN": "${env:OURPR_TOKEN}" }
    }
  }
}
```

### If a token leaks

Revoke it in **Profile → Settings → ourpr. mcp**, then make a new one.
Revocation is immediate.

### From source

```bash
git clone https://github.com/joeyaflores/ourpr-mcp-server.git
cd ourpr-mcp-server
npm install && npm run build && npm test
```

## Protocol

The server speaks MCP `2026-07-28`, and it still answers a client that opens
with the older `initialize` handshake. It is built on the official TypeScript
SDK v2 (`@modelcontextprotocol/server`), and the tests run each version.

## Environment

| | |
|---|---|
| `OURPR_TOKEN` | **Required.** Your personal access token. |
| `OURPR_API_URL` | Optional. Defaults to `https://ourpr.onrender.com/api`. |

The token is an environment variable and **not** a tool parameter, on purpose:
it never changes between calls, so passing it per call would put a live
credential into the agent's context, its transcript, and any log of either.

## Tools

Every tool reads what you imported into ourpr, and what you logged or planned
there. Runs that reach ourpr through the Strava sync stay out: Strava's API
Policy (2026) keeps its API data out of MCP servers and AI tools. Your Strava
bulk export is yours to use anywhere, so import it and every run is here.

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

### `ourpr_training_blocks`

Your goal race and its Block: race day, distance, goal time, the week of the
Block today falls in, and the miles for each week so far. A week that has not
begun shows no miles, not zero. Also the Blocks before your past races, each
with its result, its weeks and its peak week.

```
"What week of my Dallas block am I in, and how is my mileage building?"
"How does this block compare with the one before my last marathon?"
```

`past`: how many past Blocks, newest first. Three by default.

### `ourpr_list_races`

Every race ourpr finds in your history, tune-ups included, through the same
detector the app's Blocks use. Each row carries the run id for
`ourpr_get_run`. The answer also names the fastest result at 5K, 10K, half
marathon and marathon.

```
"What is my half marathon PR?"
"List every marathon I have run, with the times"
```

`distance`, `limit`.

### `ourpr_list_plans`

The plans already on your week between two dates, two weeks from today by
default: the day, the name, the miles or time, the tag, your note, whether a
run you logged fulfilled it, and whether ourpr create wrote it. An agent reads
this before `ourpr_plan_week`, so a new plan does not land on a day that
already holds one.

```
"What do I have planned for the next two weeks?"
"Did I do the runs I planned last week?"
```

`start_date`, `end_date` (YYYY-MM-DD).

### `ourpr_plan_week`

The one write. One planned run, or a week of them, onto days still ahead.
Each lands on the runner's week as a plan they can see, edit and remove; the
day sheet says it came from ourpr create. It never logs a run.

```
"Put a 6 mile easy run on Tuesday and 14 long on Saturday"
"Write me next week: three easy days, one workout, one long run"
```

`plans`, one to fourteen, each with `date` (YYYY-MM-DD, after today) and any
of `miles`, `minutes`, `name`, `note`, `tag` (easy, workout, race), `is_long`.

Needs a token made with the **Write** scope, and ourpr create on the account.
A **Read** token, or an account without create, is refused before anything is
written. Thirty plans a day.

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

The token grants read access to your own runs, your goal race and your plans.
On ourpr, every query a token makes is scoped to its owner by construction, and
a test refuses a token route that could reach past it. A token made with the
write scope, with ourpr create, may also put plans on your own week through
one route, and nothing else. No token can log a run, issue another token, revoke
your existing ones, or widen its own scope.

Each token may make 60 reads a minute, and a runner may write 30 plans a day.
ourpr answers 429 past either, with `RateLimit` and `Retry-After` headers, and
the tool says how long to wait.

Revoke any token at any time in **Profile → Settings → ourpr. mcp**.
Revocation is immediate and permanent — a revoked token can never be restored.

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

Trusted publishing is the only way in. The package's npm settings require
two-factor authentication and disallow tokens, so no stolen npm token can
publish a version, and the OIDC workflow still can. `npm-shrinkwrap.json` ships
in the package, so every install resolves the same dependency tree that the
release tested. Run `npm install` and commit the shrinkwrap after any
dependency change.

A release changes the version in five places: `package.json`,
`npm-shrinkwrap.json` (through `npm install`), `manifest.json`, `server.json`
and the `McpServer` in `src/index.ts`. Every setup command in this README pins
the version, and so does `AGENT_VERSION` in ourpr's `lib/agent-connect.ts`.

## License

MIT
