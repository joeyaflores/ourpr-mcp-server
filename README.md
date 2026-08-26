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

**2. Point a client at it.**

### Claude Code

```bash
claude mcp add ourpr \
  --env OURPR_TOKEN=ourpr_pat_... \
  -- node /path/to/ourpr-mcp-server/build/index.js
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ourpr": {
      "command": "node",
      "args": ["/path/to/ourpr-mcp-server/build/index.js"],
      "env": { "OURPR_TOKEN": "ourpr_pat_..." }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`, same shape as above.

### From source

```bash
git clone https://github.com/joeyaflores/OurPR.git
cd OurPR/ourpr-mcp-server
npm install && npm run build
```

## Environment

| | |
|---|---|
| `OURPR_TOKEN` | **Required.** Your personal access token. |
| `OURPR_API_URL` | Optional. Defaults to `https://ourpr.app/api`. |

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

The token grants read access to your own activity data and nothing else. It
cannot write, cannot issue another token, cannot revoke your existing ones, and
cannot widen its own scope.

Revoke any token at any time in **Settings → Access tokens**. Revocation is
immediate and permanent — a revoked token can never be restored.

## License

MIT
