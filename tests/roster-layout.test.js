import test from "node:test";
import assert from "node:assert/strict";
import { rosterInsertionIndex } from "../scripts/roster-layout.js";

test("insertion covers gaps, both edges, and rows with wrapped names", () => {
  const boxes = [
    { left: 10, right: 90, top: 10, bottom: 40 },
    { left: 100, right: 170, top: 10, bottom: 40 },
    { left: 10, right: 150, top: 50, bottom: 100 },
    { left: 160, right: 230, top: 50, bottom: 100 },
  ];
  assert.equal(rosterInsertionIndex(boxes, 0, 20), 0);
  assert.equal(rosterInsertionIndex(boxes, 95, 20), 1);
  assert.equal(rosterInsertionIndex(boxes, 300, 20), 2);
  assert.equal(rosterInsertionIndex(boxes, 0, 75), 2);
  assert.equal(rosterInsertionIndex(boxes, 155, 75), 3);
  assert.equal(rosterInsertionIndex(boxes, 300, 110), 4);
  assert.equal(rosterInsertionIndex([], 0, 0), 0);
});
