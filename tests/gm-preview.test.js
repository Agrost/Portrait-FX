import test from "node:test";
import assert from "node:assert/strict";
import { GmPortraitPreview } from "../scripts/gm-preview.js";
import { ClientPortraitView } from "../scripts/client-view.js";
import { INITIAL_STATE, newPortrait } from "../scripts/model.js";

function world() {
  const portraits = ["hidden", "other", "shown"].map((id) => newPortrait({ id, name: id, img: `${id}.png` }, id));
  portraits[0].visible = portraits[1].visible = false;
  portraits[0].filter = { enabled: { neon: true }, options: { neon: { intensity: 0.8 } } };
  portraits[0].particle = { enabled: { stars: true }, options: { stars: { density: 0.3 } } };
  portraits[0].tokenmagic = { enabled: { glow: true }, options: { glow: { params: [{ filterType: "glow", outerStrength: 5 }] } } };
  return { ...structuredClone(INITIAL_STATE), portraits };
}

test("preview reveals only the selected hidden portrait on the GM client without mutating shared or local state", () => {
  const shared = world(), before = structuredClone(shared);
  const gm = new GmPortraitPreview({ isGM: () => true });
  const player = new GmPortraitPreview({ isGM: () => false });
  const otherGm = new GmPortraitPreview({ isGM: () => true });
  const view = new ClientPortraitView({ read: () => ({}) });
  const local = view.project(shared);
  gm.toggle(shared, "hidden");
  assert.deepEqual(gm.project(local, shared).portraits.map((p) => p.visible), [true, false, true]);
  assert.deepEqual(player.project(local, shared).portraits.map((p) => p.visible), [false, false, true]);
  assert.deepEqual(otherGm.project(local, shared), before);
  assert.deepEqual(shared, before); assert.deepEqual(local, before);
});

test("preview reflects current appearance and all three effect states; publishing reveals that state to players", () => {
  const shared = world();
  const gm = new GmPortraitPreview({ isGM: () => true });
  const player = new GmPortraitPreview();
  gm.toggle(shared, "hidden");
  Object.assign(shared.portraits[0], { name: "Ready", height: 650, mirrored: true });
  shared.portraits[0].tokenmagic.options.glow.params[0].outerStrength = 9;
  const visible = gm.project(shared).portraits[0];
  assert.deepEqual(visible, { ...shared.portraits[0], visible: true });
  visible.tokenmagic.options.glow.params[0].outerStrength = 1;
  assert.equal(shared.portraits[0].tokenmagic.options.glow.params[0].outerStrength, 9);
  assert.equal(player.project(shared).portraits[0].visible, false);
  shared.portraits[0].visible = true;
  assert.deepEqual(gm.project(shared), player.project(shared));
  assert.equal(gm.id, null);
  shared.portraits[0].visible = false;
  assert.equal(gm.project(shared).portraits[0].visible, false);
});

test("preview switches between hidden portraits and turns off locally without changing world visibility", () => {
  const shared = world(); let changes = 0;
  const gm = new GmPortraitPreview({ isGM: () => true, onChange: () => changes++ });
  gm.toggle(shared, "hidden"); gm.toggle(shared, "other");
  assert.deepEqual(gm.project(shared).portraits.map((p) => p.visible), [false, true, true]);
  gm.toggle(shared, "other");
  assert.deepEqual(gm.project(shared), shared); assert.equal(changes, 3);
  assert.equal(new GmPortraitPreview({ isGM: () => true }).isActive(shared, "hidden"), false);
});

test("players and invalid or already visible portraits cannot start preview", () => {
  const shared = world(); let isGM = false; let changes = 0;
  const preview = new GmPortraitPreview({ isGM: () => isGM, onChange: () => changes++ });
  preview.toggle(shared, "hidden"); assert.equal(preview.id, null);
  isGM = true;
  preview.toggle(shared, "missing"); preview.toggle(shared, "shown");
  assert.equal(preview.id, null); assert.equal(changes, 0);
});

test("deleting a previewed portrait or losing GM rights clears preview and cannot revive it later", () => {
  const shared = world(); let isGM = true;
  const gm = new GmPortraitPreview({ isGM: () => isGM });
  gm.toggle(shared, "hidden");
  const removed = shared.portraits.shift(); gm.project(shared); assert.equal(gm.id, null);
  shared.portraits.unshift(removed); assert.equal(gm.project(shared).portraits[0].visible, false);
  gm.toggle(shared, "hidden"); isGM = false;
  assert.equal(gm.project(shared).portraits[0].visible, false); assert.equal(gm.id, null);
  isGM = true; assert.equal(gm.project(shared).portraits[0].visible, false);
});
