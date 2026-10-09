import test from "node:test";
import assert from "node:assert/strict";
import { PortraitStore } from "../scripts/store.js";
import { INITIAL_STATE, clone, newPortrait } from "../scripts/model.js";

function fixture({ canWrite = () => true, failFirst = false } = {}) {
  let saved = clone(INITIAL_STATE);
  const writes = [];
  const errors = [];
  let attempt = 0;
  const store = new PortraitStore({
    read: () => clone(saved), canWrite,
    write: async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failFirst && attempt++ === 0) throw new Error("write failed");
      saved = clone(value);
      writes.push(saved);
    },
    onError: (error) => errors.push(error.message),
  });
  return { store, writes, errors, read: () => saved };
}

test("concurrent GM actions serialize instead of overwriting each other", async () => {
  const { store, writes, read } = fixture();
  const first = store.change((state) => { state.portraits.push(newPortrait({ id: "actor", name: "Mage", img: "mage.webp" }, "p")); });
  const second = store.editPortrait("p", (portrait) => { portrait.filter.enabled.neon = true; });
  const third = store.editPortrait("p", (portrait) => { portrait.particle.enabled.fireflies = true; });
  await Promise.all([first, second, third]);
  assert.equal(writes.length, 3);
  assert.equal(read().revision, 3);
  assert.equal(read().portraits[0].filter.enabled.neon, true);
  assert.equal(read().portraits[0].particle.enabled.fireflies, true);
});

test("a failed save does not block the next user action", async () => {
  const { store, errors, read } = fixture({ failFirst: true });
  await assert.rejects(store.change((state) => { state.bottom = 160; }), /write failed/);
  await store.change((state) => { state.bottom = 120; });
  assert.deepEqual(errors, ["write failed"]);
  assert.equal(read().bottom, 120);
});

test("players cannot write world portrait state", async () => {
  const { store, writes } = fixture({ canWrite: () => false });
  await assert.rejects(store.change((state) => { state.enabled = false; }), /только GM/);
  assert.equal(writes.length, 0);
});

test("new clients recover the last saved state, including hidden portraits and effects", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    const portrait = newPortrait({ id: "a", name: "Ghost", img: "ghost.png" }, "p");
    portrait.visible = false;
    portrait.filter.enabled.neon = true;
    state.portraits.push(portrait);
  });
  const player = new PortraitStore({ read, write: () => assert.fail(), canWrite: () => false });
  assert.equal(player.state.portraits[0].visible, false);
  assert.equal(player.state.portraits[0].filter.enabled.neon, true);
  assert.equal(player.state.portraits[0].name, "Ghost");
});

test("hide all then show one portrait leaves every other portrait hidden and retains effects", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[0].filter.enabled.neon = true;
  });
  await store.setAllVisible(false);
  assert.equal(read().portraits.every((portrait) => !portrait.visible), true);
  await store.editPortrait("a", (portrait) => { portrait.visible = true; });
  assert.equal(read().portraits[0].visible, true);
  assert.equal(read().portraits[1].visible, false);
  assert.equal(read().portraits[0].filter.enabled.neon, true);
});

test("horizontal movement moves a single portrait instead of changing roster order", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
  });
  await store.movePortrait("a", 5);
  assert.deepEqual(read().portraits.map((portrait) => portrait.id), ["a", "b"]);
  assert.equal(read().portraits[0].x, 30);
  assert.equal(read().portraits[1].x, null);
  await store.movePortrait("a", -5);
  assert.equal(read().portraits[0].x, 25);
});

test("show all reveals and distributes the entire roster in one write without changing appearance or effects", async () => {
  const { store, read, writes } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b", "c"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits.forEach((p, i) => { p.x = 20 + i; p.visible = i === 0; p.offsetY = i * 50; });
    state.portraits[1].tokenmagic.enabled.glow = true;
  });
  const before = structuredClone(read());
  const writeCount = writes.length;
  await store.setAllVisible(true);
  assert.equal(writes.length, writeCount + 1);
  const expected = before.portraits.map((p) => ({ ...p, x: null, visible: true }));
  assert.deepEqual(read().portraits, expected);
});

test("roster drag order survives reload and changes screen slots while effects and vertical offsets follow actors", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b", "c"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[0].x = 80;
    state.portraits[1].visible = false;
    state.portraits[2].height = 620;
    state.portraits[2].offsetY = -150;
    state.portraits[2].filter.enabled.neon = true;
  });
  await store.reorderPortrait("c", "a");
  assert.deepEqual(read().portraits.map((p) => p.id), ["c", "a", "b"]);
  assert.ok(read().portraits.every((p) => p.x === null));
  const client = new PortraitStore({ read, write: () => assert.fail(), canWrite: () => false });
  assert.equal(client.state.portraits[0].height, 620);
  assert.equal(client.state.portraits[0].offsetY, -150);
  assert.equal(client.state.portraits[0].filter.enabled.neon, true);
  await store.reorderPortrait("c", "b", true);
  assert.deepEqual(read().portraits.map((p) => p.id), ["a", "b", "c"]);
  assert.equal(read().portraits[1].visible, false);
  const stable = structuredClone(read().portraits);
  await store.reorderPortrait("c", "c"); await store.reorderPortrait("missing", "a");
  assert.deepEqual(read().portraits, stable);
  await assert.rejects(client.reorderPortrait("c", "a"), /только GM/);
});

test("arrange resets visible manual positions and retains hidden positions and effects", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b", "c"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[0].x = 70;
    state.portraits[0].filter.enabled.neon = true;
    state.portraits[1].x = 30;
    state.portraits[2].x = 80;
    state.portraits[2].visible = false;
  });
  await store.arrangePortraits();
  assert.deepEqual(read().portraits.map((portrait) => portrait.x), [null, null, 80]);
  assert.equal(read().portraits[0].filter.enabled.neon, true);
  assert.equal(read().portraits[2].visible, false);
});

test("apply to all includes hidden portraits and preserves unrelated effects and portrait settings", async () => {
  class Neon {}
  globalThis.CONFIG = { fxmaster: { filterEffects: { neon: Neon } } };
  const { store, read, writes } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[1].visible = false;
    state.portraits[1].x = 70;
    state.portraits[1].filter.enabled.glitch = true;
    state.portraits[1].particle.enabled.fireflies = true;
  });
  const before = clone(read());
  const values = { intensity: 0.8, tint: { value: "#aabbcc", apply: true } };
  const operation = store.applyEffect({ kind: "filter", effectId: "neon", values });
  values.tint.value = "#000000";
  await operation;
  const result = read();
  assert.equal(writes.length, 2);
  for (const portrait of result.portraits) {
    assert.equal(portrait.filter.enabled.neon, true);
    assert.equal(portrait.filter.options.neon.tint.value, "#aabbcc");
  }
  assert.equal(result.portraits[1].visible, false);
  assert.equal(result.portraits[1].x, 70);
  assert.equal(result.portraits[1].filter.enabled.glitch, true);
  assert.deepEqual(result.portraits[1].particle, before.portraits[1].particle);
  assert.notEqual(result.portraits[0].filter.options.neon, result.portraits[1].filter.options.neon);
});

test("effect application and removal obey GM authorization and Water cannot be applied", async () => {
  class Neon {}
  globalThis.CONFIG = { fxmaster: { filterEffects: { neon: Neon, water: Neon } } };
  const { store, writes } = fixture({ canWrite: () => false });
  await assert.rejects(store.applyEffect({ kind: "filter", effectId: "neon", values: {} }), /только GM/);
  await assert.rejects(store.applyEffect({ kind: "filter", effectId: "water", values: {} }), /недоступен/);
  await assert.rejects(store.removePortrait("a"), /только GM/);
  assert.equal(writes.length, 0);
});

test("clear all disables both categories including hidden portraits and retains saved parameters and appearance", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b"]) {
      const portrait = newPortrait({ id, name: id, img: `${id}.png` }, id);
      portrait.filter = { enabled: { neon: true, water: true }, options: { neon: { intensity: 0.7 } } };
      portrait.particle = { enabled: { fireflies: true }, options: { fireflies: { density: 0.4 } } };
      portrait.x = 75; portrait.mirrored = true; portrait.height = 600;
      portrait.visible = id === "a";
      state.portraits.push(portrait);
    }
  });
  const expected = clone(read());
  for (const portrait of expected.portraits) { portrait.filter.enabled = {}; portrait.particle.enabled = {}; }
  expected.revision++;
  await store.clearAllEffects();
  assert.deepEqual(read(), expected);
});

test("swaps save the final roster order which arrange and a new client continue using", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b", "c"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[1].filter.enabled.neon = true;
    state.portraits[1].height = 650;
    state.portraits[1].mirrored = true;
  });
  await Promise.all([store.swapPortrait("b", -1), store.swapPortrait("c", -1)]);
  assert.deepEqual(read().portraits.map((p) => p.id), ["b", "c", "a"]);
  await store.editPortrait("c", (portrait) => { portrait.x = 90; });
  await store.arrangePortraits();
  const client = new PortraitStore({ read, canWrite: () => false });
  assert.deepEqual(client.state.portraits.map((p) => p.id), ["b", "c", "a"]);
  assert.deepEqual(client.state.portraits.map((p) => p.x), [null, null, null]);
  assert.equal(client.state.portraits[0].filter.enabled.neon, true);
  assert.equal(client.state.portraits[0].height, 650);
  assert.equal(client.state.portraits[0].mirrored, true);
});

test("swaps exchange manual and automatic slots without moving other portraits", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "b", "c"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[0].x = 20;
    state.portraits[2].x = 80;
  });
  await store.swapPortrait("b", -1);
  assert.deepEqual(read().portraits.map((p) => [p.id, p.x]), [["b", 20], ["a", null], ["c", 80]]);
  await store.swapPortrait("b", 1);
  await store.editPortrait("b", (p) => { p.x = 55; });
  await store.swapPortrait("b", 1);
  assert.deepEqual(read().portraits.map((p) => [p.id, p.x]), [["a", 20], ["c", 55], ["b", 80]]);
});

test("visible swaps skip hidden portraits, stop at edges and hidden roster order can be edited", async () => {
  const { store, read } = fixture();
  await store.change((state) => {
    for (const id of ["a", "hidden", "b"]) state.portraits.push(newPortrait({ id, name: id, img: `${id}.png` }, id));
    state.portraits[1].visible = false;
    state.portraits[1].x = 61;
  });
  await store.swapPortrait("b", -1);
  assert.deepEqual(read().portraits.map((p) => p.id), ["b", "hidden", "a"]);
  assert.equal(read().portraits[1].x, 61);
  await store.swapPortrait("b", -1);
  await store.swapPortrait("a", 1);
  await store.swapPortrait("missing", -1);
  await store.swapPortrait("a", 2);
  assert.deepEqual(read().portraits.map((p) => p.id), ["b", "hidden", "a"]);
  await store.swapPortrait("hidden", -1);
  await store.editPortrait("hidden", (p) => { p.visible = true; });
  await store.arrangePortraits();
  assert.deepEqual(read().portraits.map((p) => [p.id, p.x]), [["hidden", null], ["b", null], ["a", null]]);
});

test("players cannot reorder portraits or clear everyone's effects", async () => {
  const { store, writes } = fixture({ canWrite: () => false });
  await assert.rejects(store.swapPortrait("a", 1), /только GM/);
  await assert.rejects(store.clearAllEffects(), /только GM/);
  assert.equal(writes.length, 0);
});
