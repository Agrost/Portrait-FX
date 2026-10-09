import test from "node:test";
import assert from "node:assert/strict";
import { normalizeState, newPortrait } from "../scripts/model.js";
import { automaticX, displayedX, panelPosition, panelSize, portraitArea, screenX, localX } from "../scripts/layout.js";

test("new portraits start at 500 px, with automatic horizontal placement", () => {
  const portrait = newPortrait({ id: "actor", name: "Mage", img: "mage.png" }, "p");
  assert.equal(portrait.height, 500);
  assert.equal(portrait.x, null);
  assert.equal(normalizeState({ portraits: [{ id: "p" }] }).portraits[0].height, 500);
});

test("upgrade converts the old default height but preserves other configured heights", () => {
  const old = normalizeState({ portraits: [{ id: "a", height: 320 }, { id: "b", height: 250 }] });
  assert.equal(old.portraits[0].height, 500);
  assert.equal(old.portraits[1].height, 250);
  assert.equal(normalizeState({ ...old, portraits: [{ id: "a", height: 320 }] }).portraits[0].height, 320);
  assert.equal(normalizeState({ schemaVersion: 2, portraits: [{ id: "a", height: 400 }] }).portraits[0].height, 500);
  assert.equal(normalizeState({ schemaVersion: 2, portraits: [{ id: "a", height: 320 }] }).portraits[0].height, 320);
  assert.equal(normalizeState({ schemaVersion: 3, portraits: [{ id: "a", height: 400 }] }).portraits[0].height, 400);
});

test("names default to enabled and explicitly hidden captions survive saving", () => {
  const actor = { id: "a", name: "Mage", img: "mage.png" };
  assert.equal(newPortrait(actor, "p").showName, true);
  const hidden = newPortrait(actor, "p", false);
  assert.equal(normalizeState({ schemaVersion: 3, portraits: [hidden] }).portraits[0].showName, false);
  assert.equal(normalizeState({ portraits: [{ id: "old" }] }).portraits[0].showName, true);
});

test("legacy hide-all becomes individually hidden portraits without a global lock", () => {
  const state = normalizeState({ enabled: false, portraits: [{ id: "a", visible: true }, { id: "b", visible: true }] });
  assert.equal(state.portraits.every((portrait) => !portrait.visible), true);
  state.portraits[0].visible = true;
  const shown = normalizeState(state);
  assert.equal(shown.portraits[0].visible, true);
  assert.equal(shown.portraits[1].visible, false);
});

test("saved portrait position overrides automatic placement and keeps the image on screen", () => {
  assert.equal(displayedX({ x: 60 }, 0, 2, 240, 1200), 60);
  assert.equal(displayedX({ x: 0 }, 0, 2, 240, 1200), (120 + 16) / 1200 * 100);
  assert.equal(displayedX({ x: null }, 0, 2, 240, 1200), 25);
});

test("default portraits occupy equally spaced screen slots with half-slot edge margins", () => {
  assert.equal(automaticX(0, 1), 50);
  assert.deepEqual([0, 1].map((index) => automaticX(index, 2)), [25, 75]);
  const positions = [0, 1, 2, 3].map((index) => displayedX({ x: null }, index, 4, 220, 1280));
  assert.deepEqual(positions, [12.5, 37.5, 62.5, 87.5]);
});

test("menu positions survive dragging while remaining reachable in smaller viewports", () => {
  assert.deepEqual(panelPosition({ left: 100, top: 120 }, 430, 1280, 720), { left: 100, top: 120 });
  assert.deepEqual(panelPosition({ left: 1000, top: 900 }, 430, 640, 480), { left: 202, top: 320 });
});

test("portraits reserve the widest free side when Foundry sidebar overlaps their vertical area", () => {
  assert.deepEqual(portraitArea(1280, 720, 80, 500, { left: 826, right: 1258, top: 85, bottom: 712 }), { left: 0, width: 810 });
  assert.deepEqual(portraitArea(1280, 720, 80, 500, { left: 8, right: 440, top: 85, bottom: 712 }), { left: 456, width: 824 });
  assert.deepEqual(portraitArea(1280, 720, 80, 500, { left: 826, right: 1258, top: 14, bottom: 72 }), { left: 0, width: 1280 });
  assert.deepEqual(portraitArea(1280, 720, 80, 500, null), { left: 0, width: 1280 });
});

test("sidebar compression maps coordinates without overwriting saved positions", () => {
  const portrait = { x: 60 };
  const area = { left: 456, width: 824 };
  const x = screenX(portrait, 0, 1, 300, 1280, area);
  assert.ok(Math.abs(localX(x / 100 * 1280, 300, area) - 60) < 1e-9);
  assert.equal(portrait.x, 60);
  assert.equal(screenX(portrait, 0, 1, 300, 1280, { left: 0, width: 1280 }), 60);
});

test("saved menu size survives reopening and is bounded by the current viewport", () => {
  assert.deepEqual(panelSize({ width: 600, height: 450 }, 1280, 620), { width: 600, height: 450 });
  assert.deepEqual(panelSize({ width: 600, height: 450 }, 480, 300), { width: 464, height: 300 });
  assert.deepEqual(panelSize({ width: 100, height: 20 }, 1280, 620), { width: 320, height: 200 });
  assert.deepEqual(panelSize(null, 1280, 620), { width: 430, height: null });
  assert.deepEqual(panelSize({ width: 600, height: 450 }, 300, 140), { width: 284, height: 140 });
});
