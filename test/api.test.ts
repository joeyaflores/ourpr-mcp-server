import { test } from "node:test";
import assert from "node:assert/strict";
import { guidance, waitWords } from "../src/api.js";

test("waitWords says the wait in the unit a person would use", () => {
  assert.equal(waitWords("42"), "42 seconds");
  assert.equal(waitWords("600"), "10 minutes");
  assert.equal(waitWords("50000"), "about 14 hours");
  assert.equal(waitWords(undefined), "a minute");
});

test("a 429 names the limit the server gave", () => {
  assert.equal(
    guidance(429, "A runner may write 120 plans a day.", "50000"),
    "A runner may write 120 plans a day. Wait about 14 hours, then ask again.",
  );
});

test("a 403 tells a refused read from a refused write", () => {
  assert.equal(
    guidance(403, "Reading needs ourpr connect. Your free reads ended on October 18."),
    "Your free reads ended. ourpr. connect opens them again at ourpr.app/settings.",
  );
  assert.match(guidance(403, "ourpr create needed to write."), /refused the write/);
});

test("a 403 names the switch when the runner turned it off", () => {
  assert.match(
    guidance(403, "Artificial Intelligence is off in your ourpr. Settings."),
    /^AI tools are off in your ourpr Settings/,
  );
});
