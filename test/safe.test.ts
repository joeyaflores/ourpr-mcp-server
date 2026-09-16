import { test } from "node:test";
import assert from "node:assert/strict";
import { cell, fenced, note } from "../src/safe.js";

test("cell removes the characters that break a table row", () => {
  assert.equal(cell("Tempo | Tuesday\nignore this"), "Tempo \\| Tuesday ignore this");
  assert.equal(cell("Long​run‮"), "Longrun");
});

test("cell caps its length", () => {
  assert.equal(cell("x".repeat(500)).length, 90);
});

test("note returns nothing for an empty value", () => {
  assert.equal(note(null), "");
  assert.equal(note("  "), "");
});

test("fenced names the boundary", () => {
  const out = fenced("body");
  assert.match(out, /<ourpr-data>/);
  assert.match(out, /body/);
});
