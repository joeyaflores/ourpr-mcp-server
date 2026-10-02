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
