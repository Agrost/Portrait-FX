import test from "node:test";
import assert from "node:assert/strict";
import { ClientPortraitView, normalizeClientView } from "../scripts/client-view.js";
import { INITIAL_STATE, newPortrait } from "../scripts/model.js";

function world() {
  return { ...structuredClone(INITIAL_STATE), portraits: ["a", "b"].map((id) => newPortrait({ id, name: id, img: `${id}.png` }, id)) };
}
function client(initial = {}) {
  let saved = structuredClone(initial);
  const writes = [];
  const view = new ClientPortraitView({
    read: () => structuredClone(saved),
    write: async (next) => { saved = structuredClone(next); writes.push(saved); },
  });
  return { view, writes, read: () => structuredClone(saved) };
}

test("player movement changes only the local projection, not GM or another client", async () => {
  const shared = world();
  const before = structuredClone(shared);
  const first = client(), second = client();
  await first.view.movePortrait(shared, "a", 5);
  assert.equal(first.view.project(shared).portraits[0].x, 30);
  assert.equal(second.view.project(shared).portraits[0].x, null);
  assert.deepEqual(shared, before);
  assert.equal(first.view.project(shared, { usePositions: false }).portraits[0].x, null);
});

test("local hiding stays hidden through GM updates and can be undone independently", async () => {
  const shared = world();
  const first = client(), second = client();
  await first.view.toggleHidden();
  shared.portraits.push(newPortrait({ id: "c", name: "c", img: "c.png" }, "c"));
  assert.equal(first.view.project(shared).portraits.every((item) => !item.visible), true);
  assert.equal(second.view.project(shared).portraits.every((item) => item.visible), true);
  shared.portraits[1].visible = false;
  await first.view.toggleHidden();
  assert.deepEqual(first.view.project(shared).portraits.map((item) => item.visible), [true, false, true]);
});

test("saved local preferences recover after reload and reset uses current GM positions", async () => {
  const shared = world();
  const first = client();
  await first.view.setPosition("a", 80);
  await first.view.toggleHidden();
  const reloaded = client(first.read());
  assert.equal(reloaded.view.state.hidden, true);
  assert.equal(reloaded.view.project(shared).portraits[0].x, 80);
  shared.portraits[0].x = 40;
  await reloaded.view.resetPositions();
  assert.equal(reloaded.view.project(shared).portraits[0].x, 40);
  assert.equal(reloaded.view.state.hidden, true);
});

test("rapid local arrow actions serialize without losing a move", async () => {
  const shared = world();
  const { view, writes } = client();
  await Promise.all([view.movePortrait(shared, "a", 5), view.movePortrait(shared, "a", 5), view.movePortrait(shared, "b", -5)]);
  assert.equal(view.project(shared).portraits[0].x, 35);
  assert.equal(view.project(shared).portraits[1].x, 70);
  assert.equal(writes.length, 3);
});

test("a failed local save retains preferences and does not block the next change", async () => {
  let saved = {};
  let failed = false;
  const errors = [];
  const view = new ClientPortraitView({ read: () => saved, write: async (next) => {
    if (!failed) { failed = true; throw new Error("Storage failed"); }
    saved = next;
  }, onError: (error) => errors.push(error.message) });
  await assert.rejects(view.toggleHidden(), /Storage failed/);
  assert.equal(view.state.hidden, false);
  await view.setPosition("a", 55);
  assert.equal(view.state.positions.a, 55);
  assert.deepEqual(errors, ["Storage failed"]);
});

test("invalid local positions are discarded or bounded", () => {
  assert.deepEqual(normalizeClientView({ hidden: "true", positions: { a: -10, b: 110, c: "60", d: Infinity } }), {
    hidden: false, positions: { a: 0, b: 100 }, mirrors: {},
  });
});

test("player flips only the selected local portrait and preserves GM and other clients", async () => {
  const shared = world();
  const before = structuredClone(shared);
  const first = client(), second = client();
  await first.view.flipPortrait(shared, "a");
  assert.deepEqual(first.view.project(shared).portraits.map((p) => p.mirrored), [true, false]);
  assert.deepEqual(second.view.project(shared), before);
  assert.deepEqual(shared, before);
  assert.equal(first.view.project(shared, { useMirrors: false }).portraits[0].mirrored, false);
  await first.view.flipPortrait(shared, "a");
  assert.equal(first.view.project(shared).portraits[0].mirrored, false);
});

test("local orientation restores after reload, starts from GM orientation and survives hiding", async () => {
  const shared = world();
  shared.portraits[0].mirrored = true;
  const first = client({ positions: { a: 40 } });
  await first.view.flipPortrait(shared, "a");
  await first.view.toggleHidden();
  const reloaded = client(first.read());
  await reloaded.view.toggleHidden();
  assert.equal(reloaded.view.project(shared).portraits[0].mirrored, false);
  assert.equal(reloaded.view.project(shared).portraits[0].x, 40);
  await reloaded.view.resetPositions();
  assert.equal(reloaded.view.project(shared).portraits[0].mirrored, false);
  shared.portraits[1].visible = false;
  await reloaded.view.flipPortrait(shared, "b");
  assert.equal(Object.hasOwn(reloaded.view.state.mirrors, "b"), false);
});

test("rapid flips serialize and invalid mirror entries do not become overrides", async () => {
  const shared = world();
  const { view } = client();
  await Promise.all([view.flipPortrait(shared, "a"), view.flipPortrait(shared, "a"), view.flipPortrait(shared, "b")]);
  assert.deepEqual(view.project(shared).portraits.map((p) => p.mirrored), [false, true]);
  assert.deepEqual(normalizeClientView({ mirrors: { a: true, b: false, c: "true", constructor: true } }).mirrors, { a: true, b: false });
});
