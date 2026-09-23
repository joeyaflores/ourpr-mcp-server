import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TOKEN = "ourpr_pat_TESTSECRET_never_printed";
const USERINFO = "admin:s3cr3t";
// A port nothing listens on, so every call fails and every error path prints.
const BASE = `http://${USERINFO}@127.0.0.1:9/api`;

const CALLS: [string, Record<string, unknown>][] = [
  ["ourpr_list_runs", { start_date: "2026-01-01", end_date: "2026-01-31" }],
  ["ourpr_get_run", { activity_id: "1" }],
  ["ourpr_run_stream", { activity_id: "1" }],
  ["ourpr_run_laps", { activity_id: "1" }],
  ["ourpr_rep_workouts", {}],
  ["ourpr_detect_reps", { activity_id: "1" }],
  ["ourpr_similar_terrain", { miles: 10, gain_ft: 500 }],
  ["ourpr_plan_week", { plans: [{ date: "2099-01-01", miles: 6 }] }],
];

test("no tool result and no stderr line carries the token or the URL's userinfo", async () => {
  let stderr = "";
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
    env: { ...process.env, OURPR_TOKEN: TOKEN, OURPR_API_URL: BASE } as Record<string, string>,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);

  const listed = await client.listTools();
  assert.equal(listed.tools.length, CALLS.length);

  let printed = "";
  for (const [name, args] of CALLS) {
    const result = await client.callTool({ name, arguments: args });
    printed += JSON.stringify(result);
  }
  await client.close();

  for (const text of [printed, stderr]) {
    assert.ok(!text.includes(TOKEN), "the token was printed");
    assert.ok(!text.includes(USERINFO), "the URL's userinfo was printed");
    assert.ok(!text.includes("s3cr3t"), "the URL's password was printed");
  }
  assert.ok(printed.length > 0);
});
