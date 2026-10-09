import test from "node:test";
import assert from "node:assert/strict";
import { PortraitPanel } from "../scripts/panel.js";
import { PortraitStore } from "../scripts/store.js";
import { INITIAL_STATE, newPortrait } from "../scripts/model.js";
import { GmPortraitPreview } from "../scripts/gm-preview.js";

function fixture() {
  class Neon { static parameters = { intensity: { type: "range", value: 0.5 } }; }
  globalThis.CONFIG = { fxmaster: { filterEffects: { neon: Neon } } };
  globalThis.game = { user: { isGM: true } };
  let saved = { ...structuredClone(INITIAL_STATE), portraits: ["a", "b"].map((id) => newPortrait({ id, name: id, img: `${id}.png` }, id)) };
  const writes = [];
  const store = new PortraitStore({ read: () => saved, canWrite: () => true, write: async (next) => { saved = next; writes.push(next); } });
  const panel = new PortraitPanel(store);
  panel.selectedId = "a"; panel.selectedEffects.filter = "neon";
  const input = { type: "number", value: "0.5", validity: { valid: true } };
  panel.element = { querySelector: () => ({ elements: [input] }), contains: () => true };
  panel.readValues = () => ({ intensity: Number(input.value) });
  panel.render = () => {};
  return { panel, store, writes, input, read: () => saved };
}

test("missing effect engine leaves appearance controls available and saved effects intact", () => {
  const { panel, store, writes } = fixture();
  panel.effectsAvailable = false;
  const portrait = store.state.portraits[0];
  portrait.filter.enabled.neon = true;
  const saved = structuredClone(store.state);
  globalThis.game.modules = new Map([["tokenmagic", { active: true }]]);
  globalThis.TokenMagic = { filterTypes: { glow: class {} } };
  panel.saveMacro = () => {};
  for (const kind of ["filter", "particle", "tokenmagic"]) {
    panel.kind = kind;
    const markup = panel.portraitMarkup(portrait);
    assert.match(markup, /Портреты работают без эффектов/);
    assert.match(markup, /name="height"/);
    assert.doesNotMatch(markup, /data-action="toggle-effect"/);
    assert.deepEqual(panel.effectRegistry(), {});
    if (kind === "tokenmagic") {
      assert.match(markup, /data-action="copy-token" disabled/);
      assert.match(markup, /data-action="add-macro"[^>]*disabled/);
    }
  }
  assert.deepEqual(store.state, saved);
  assert.deepEqual(writes, []);
});

test("parameter edits apply automatically, coalescing rapid input into the latest value", async () => {
  const { panel, store, input, writes, read } = fixture();
  panel.scheduleLiveEffect();
  input.value = "0.8"; panel.scheduleLiveEffect();
  await new Promise((resolve) => setTimeout(resolve, 170));
  await store.pending;
  assert.equal(writes.length, 1);
  assert.equal(read().portraits[0].filter.enabled.neon, true);
  assert.equal(read().portraits[0].filter.options.neon.intensity, 0.8);
  assert.deepEqual(read().portraits[1].filter.enabled, {});
});

test("switching portraits before an automatic save cannot apply the old draft to the new selection", async () => {
  const { panel, store, input, read } = fixture();
  input.value = "0.9"; panel.scheduleLiveEffect();
  panel.onClick({ target: { closest: () => ({ dataset: { action: "select", id: "b" } }) } });
  input.value = "0.2"; panel.scheduleLiveEffect(); panel.flushLiveEffect();
  await store.pending;
  assert.equal(read().portraits[0].filter.options.neon.intensity, 0.9);
  assert.equal(read().portraits[1].filter.options.neon.intensity, 0.2);
});

test("temporarily empty or invalid numeric input does not enable or save an effect", async () => {
  const { panel, store, input, writes } = fixture();
  input.value = ""; panel.scheduleLiveEffect(); panel.flushLiveEffect();
  input.value = "5"; input.validity.valid = false; panel.scheduleLiveEffect(); panel.flushLiveEffect();
  await store.pending;
  assert.equal(writes.length, 0);
});

test("context menu removes only the requested added portrait and flushes an earlier edit safely", async () => {
  const { panel, store, read } = fixture();
  let prevented = false;
  panel.scheduleLiveEffect();
  panel.onContextMenu({ target: { closest: () => ({ dataset: { id: "b" } }) }, preventDefault() { prevented = true; }, stopPropagation() {} });
  await store.pending;
  assert.equal(prevented, true);
  assert.deepEqual(read().portraits.map((p) => p.id), ["a"]);
  assert.equal(read().portraits[0].filter.options.neon.intensity, 0.5);
  game.user.isGM = false;
  panel.onContextMenu({ target: { closest: () => ({ dataset: { id: "a" } }) }, preventDefault() { assert.fail(); } });
  assert.equal(read().portraits.length, 1);
});

test("clear all flushes the pending automatic edit first so it cannot re-enable an effect afterward", async () => {
  const { panel, store, read } = fixture();
  panel.scheduleLiveEffect();
  panel.onClick({ target: { closest: () => ({ dataset: { action: "clear-all" } }) } });
  await store.pending;
  assert.equal(panel.liveEdit, null);
  assert.equal(panel.liveTimer, null);
  for (const portrait of read().portraits) {
    assert.deepEqual(portrait.filter.enabled, {});
    assert.deepEqual(portrait.particle.enabled, {});
  }
  assert.equal(read().portraits[0].filter.options.neon.intensity, 0.5);
});

test("favorites sort first alphabetically on reopening but the open picker order stays stable", () => {
  const { panel } = fixture();
  const actors = [{ id: "c", name: "Charlie" }, { id: "b", name: "Beta" }, { id: "a", name: "Alpha" }];
  panel.favorites = { state: [] };
  assert.deepEqual(panel.actorsForPicker(actors).map((a) => a.id), ["a", "b", "c"]);
  panel.favorites.state = ["c", "b"];
  assert.deepEqual(panel.actorsForPicker(actors).map((a) => a.id), ["a", "b", "c"]);
  panel.actorOrder = null;
  assert.deepEqual(panel.actorsForPicker(actors).map((a) => a.id), ["b", "c", "a"]);
  assert.deepEqual(panel.actorsForPicker(actors.filter((a) => a.id !== "c")).map((a) => a.id), ["b", "a"]);
});

test("clicking a star leaves actor selection untouched without adding a portrait or writing world state", async () => {
  const { panel, writes } = fixture();
  const toggles = [];
  panel.favorites = { toggle: async (id) => toggles.push(id) };
  game.actors = { get: (id) => id === "b" ? { id } : null };
  panel.selectedActorId = "a";
  const click = (id) => panel.onClick({ target: { closest: () => ({ dataset: { action: "favorite", actorId: id } }) } });
  click("b"); click("missing");
  game.user.isGM = false; click("b");
  assert.deepEqual(toggles, ["b"]);
  assert.equal(panel.selectedActorId, "a");
  assert.deepEqual(writes, []);
});

test("search filters names without changing selection or the stable favorite order", () => {
  const { panel, writes } = fixture();
  const actors = [{ id: "mage", name: "Маг" }, { id: "ranger", name: "Следопыт" }, { id: "archmage", name: "Архимаг" }];
  panel.favorites = { state: ["mage"] }; panel.selectedActorId = "ranger";
  const ordered = panel.actorsForPicker(actors);
  const list = { innerHTML: "" };
  game.actors = { contents: actors };
  panel.element.querySelector = () => list;
  panel.render = () => assert.fail("Typing must not replace the search input");
  panel.onInput({ target: { dataset: { role: "actor-search" }, value: "  МАГ  " } });
  assert.ok(list.innerHTML.includes('data-actor-id="mage"'));
  assert.ok(list.innerHTML.includes('data-actor-id="archmage"'));
  assert.ok(!list.innerHTML.includes('data-actor-id="ranger"'));
  assert.equal(panel.selectedActorId, "ranger");
  panel.actorSearch = "нет такого"; assert.match(panel.actorOptionsMarkup(ordered), /Персонажи не найдены/);
  panel.actorSearch = ""; assert.deepEqual(panel.actorsForPicker(actors), ordered);
  assert.deepEqual(writes, []);
});

test("new hidden portraits stay hidden through saved state and the toggle only affects subsequent new additions", async () => {
  const { panel, store, read } = fixture();
  const actors = [{ id: "c", name: "C", img: "c.png" }, { id: "d", name: "D", img: "d.png" }];
  game.actors = { get: (id) => actors.find((actor) => actor.id === id) };
  let next = 0; globalThis.foundry = { utils: { randomID: () => `new-${++next}` } };
  const add = (actorId) => panel.onClick({ target: { closest: () => ({ dataset: { action: "choose-actor", actorId } }) } });
  panel.onChange({ target: { dataset: { role: "add-hidden" }, checked: true } });
  add("c");
  panel.onChange({ target: { dataset: { role: "add-hidden" }, checked: false } });
  add("d");
  await store.pending;
  const reloaded = new PortraitStore({ read, write: () => assert.fail(), canWrite: () => false });
  assert.equal(reloaded.state.portraits.find((p) => p.actorId === "c").visible, false);
  assert.equal(reloaded.state.portraits.find((p) => p.actorId === "d").visible, true);
  assert.equal(reloaded.state.portraits.find((p) => p.id === "a").visible, true);
});

test("selecting a different portrait keeps roster nodes attached so its double click toggles only its visibility", async () => {
  const { panel, store, read } = fixture();
  const buttons = ["a", "b"].map((id) => ({ dataset: { id }, classList: { toggle() {} }, setAttribute() {} }));
  const editor = { innerHTML: "" };
  panel.element = { contains: () => true, querySelector: (selector) => selector === ".fxp-editor" ? editor : null, querySelectorAll: () => buttons };
  panel.render = () => assert.fail("The first click must not replace the roster");
  panel.portraitMarkup = (portrait) => portrait.id;
  panel.refreshConditions = panel.updateHeightHint = panel.applyPosition = () => {};
  const click = () => panel.onClick({ target: { closest: () => ({ dataset: { action: "select", id: "b" } }) } });
  click(); click(); assert.equal(panel.selectedId, "b"); assert.equal(editor.innerHTML, "b");
  const event = { target: { closest: (selector) => selector === '.fxp-roster [data-action="select"]' ? buttons[1] : null }, preventDefault() {} };
  panel.onDoubleClick(event); await store.pending;
  assert.equal(read().portraits[1].visible, false); assert.equal(read().portraits[0].visible, true);
  assert.equal(read().portraits[1].name, "b"); assert.equal(read().portraits[1].height, 500);
  panel.onDoubleClick(event); await store.pending; assert.equal(read().portraits[1].visible, true);
  game.user.isGM = false; panel.onDoubleClick(event); await store.pending; assert.equal(read().portraits[1].visible, true);
});

test("clicking rename again discards its draft while save still changes the stored name", async () => {
  const { panel, store, writes, read } = fixture();
  panel.element.querySelector = () => ({ focus() {} });
  const click = () => panel.onClick({ target: { closest: () => ({ dataset: { action: "rename" } }) } });
  click(); assert.equal(panel.renamingId, "a");
  panel.renameValue = "Discarded"; click();
  assert.equal(panel.renamingId, null); assert.equal(panel.renameValue, ""); assert.equal(writes.length, 0);
  click(); assert.equal(panel.renameValue, "a");
  panel.renameValue = "Saved"; panel.saveName(); await store.pending;
  assert.equal(read().portraits[0].name, "Saved"); assert.equal(panel.renamingId, null);
});

test("GM preview button flushes pending effects while keeping the portrait hidden from shared state", async () => {
  const { panel, store, writes, read } = fixture();
  await store.editPortrait("a", (portrait) => { portrait.visible = false; }); writes.length = 0;
  panel.preview = new GmPortraitPreview({ isGM: () => game.user.isGM });
  const click = () => panel.onClick({ target: { closest: () => ({ dataset: { action: "preview" } }) } });
  click(); assert.equal(panel.preview.isActive(store.state, "a"), true); assert.equal(writes.length, 0);
  assert.match(panel.portraitMarkup(store.state.portraits[0]), /Портрет виден только тебе/);
  panel.scheduleLiveEffect(); click(); await store.pending;
  assert.equal(panel.preview.isActive(store.state, "a"), false);
  assert.equal(read().portraits[0].visible, false);
  assert.equal(read().portraits[0].filter.enabled.neon, true);
  assert.equal(writes.length, 1);
  game.user.isGM = false; click(); assert.equal(panel.preview.id, null);
  assert.ok(!panel.portraitMarkup(store.state.portraits[0]).includes('data-action="preview"'));
  game.user.isGM = true;
  assert.ok(!panel.portraitMarkup(store.state.portraits[1]).includes('data-action="preview"'));
});

test("clicking a character adds it with current settings, preserves search, and repeated clicks never duplicate it", async () => {
  const { panel, store, read } = fixture();
  game.actors = { get: (id) => id === "c" ? { id, name: "C", img: "c.png" } : null };
  let next = 0; globalThis.foundry = { utils: { randomID: () => `click-${++next}` } };
  panel.addName = false; panel.addHeight = 600; panel.addHidden = true; panel.actorSearch = "C";
  const click = () => panel.onClick({ target: { closest: () => ({ dataset: { action: "choose-actor", actorId: "c" } }) } });
  click(); await store.pending;
  const added = read().portraits.find((p) => p.actorId === "c");
  assert.equal(added.visible, false); assert.equal(added.showName, false); assert.equal(added.height, 600);
  assert.equal(panel.selectedActorId, "c"); assert.equal(panel.selectedId, added.id); assert.equal(panel.actorSearch, "C");
  click(); click(); await store.pending;
  assert.equal(read().portraits.filter((p) => p.actorId === "c").length, 1);
  assert.equal(read().portraits.find((p) => p.actorId === "c").visible, true);
  assert.equal(panel.selectedId, added.id);
});

test("character clicks reject invalid height, removed actors, and non-GM requests", async () => {
  const { panel, store, writes } = fixture();
  const warnings = []; globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  game.actors = { get: (id) => id === "c" ? { id, name: "C", img: "c.png" } : null };
  const click = (actorId) => panel.onClick({ target: { closest: () => ({ dataset: { action: "choose-actor", actorId } }) } });
  panel.addHeight = ""; click("c"); panel.addHeight = 800; click("c");
  panel.addHeight = 500; click("removed"); game.user.isGM = false; click("c");
  await store.pending; assert.equal(writes.length, 0); assert.equal(warnings.length, 2);
});

test("keyboard navigation follows filtered actor rows and Escape returns focus to search without losing query", () => {
  const { panel } = fixture(); panel.actorSearch = "маг";
  const focused = [];
  const options = ["mage", "archmage"].map((actorId) => ({ dataset: { actorId }, focus: () => focused.push(actorId) }));
  panel.element.querySelectorAll = () => options;
  panel.element.querySelector = () => ({ focus: () => focused.push("search") });
  const press = (key, actorId) => panel.onActorKeyDown({ key, preventDefault() {}, target: { closest: (selector) => selector === '[data-actor-id]' ? (actorId ? { dataset: { actorId } } : null) : {} } });
  press("ArrowDown"); press("ArrowDown", "mage"); press("ArrowUp", "mage"); press("Escape", "archmage");
  assert.deepEqual(focused, ["mage", "archmage", "archmage", "search"]);
  assert.equal(panel.actorSearch, "маг");
  panel.element.querySelectorAll = () => [];
  assert.equal(press("ArrowDown"), true);
});

test("appearance button opens and closes a plain form and slider edits save only the selected portrait", async () => {
  const { panel, store, writes, read } = fixture();
  const fields = { height: { value: "620" }, offsetY: { value: "-120" } };
  await store.editPortrait("a", (portrait) => { portrait.x = 35; });
  writes.length = 0;
  const form = { hidden: true, elements: { namedItem: (name) => fields[name] } };
  panel.element.querySelector = () => form; panel.applyPosition = () => {};
  const expanded = []; const button = { dataset: { action: "appearance-toggle" }, setAttribute: (_, value) => expanded.push(value), classList: { toggle() {} } };
  const click = () => panel.onClick({ target: { closest: () => button } });
  click(); assert.equal(form.hidden, false); click(); assert.equal(form.hidden, true);
  assert.equal(fields.height.value, "620"); assert.equal(writes.length, 0);
  click(); assert.deepEqual(expanded, ["true", "false", "true"]);
  let projected;
  panel.onAppearancePreview = () => { projected = panel.projectAppearance(store.state); };
  for (const name of ["height", "offsetY"]) {
    panel.onInput({ target: { name, value: fields[name].value, dataset: {}, closest: () => form } });
  }
  assert.equal(projected.portraits[0].height, 620); assert.equal(projected.portraits[0].offsetY, -120);
  assert.equal(writes.length, 0);
  panel.flushAppearance(); await store.pending;
  assert.equal(read().portraits[0].src, "a.png"); assert.equal(read().portraits[0].height, 620);
  assert.equal(read().portraits[0].x, 35); assert.equal(read().portraits[0].offsetY, -120);
  assert.equal(read().portraits[1].offsetY, 0);
  assert.match(panel.portraitMarkup(store.state.portraits[0]), /data-action="appearance-toggle"/);
  assert.ok(!panel.portraitMarkup(store.state.portraits[0]).includes("<details"));
  assert.doesNotMatch(panel.portraitMarkup(store.state.portraits[0]), /appearance-header|appearance-close|data-action="appearance"/);
});

test("size selection uses configured presets and custom entry survives rendering and adding an actor", async () => {
  const { panel, store, read } = fixture();
  let presets = { small: 420, normal: 530, large: 610 };
  panel.readHeightPresets = () => presets;
  const markup = panel.addHeightMarkup();
  assert.match(markup, /Маленький \(420\)/); assert.match(markup, /Обычный \(530\)/);
  assert.match(markup, /Большой \(610\)/); assert.equal(panel.addHeight, 530);
  const custom = { hidden: true }, input = { value: "", focus() {} };
  panel.element.querySelector = (selector) => selector.includes("custom-height") ? custom : input;
  panel.applyPosition = () => {};
  const choose = (value) => panel.onChange({ target: { dataset: { role: "add-height-preset" }, value } });
  choose("large"); assert.equal(panel.addHeight, 610); assert.equal(custom.hidden, true);
  choose("custom"); assert.equal(custom.hidden, false); assert.equal(input.value, 610);
  panel.addHeight = "587";
  presets = { small: 440, normal: 540, large: 620 };
  panel.addHeightMarkup(); assert.equal(panel.addHeight, "587");
  game.actors = { get: () => ({ id: "c", name: "C", img: "c.png" }) };
  globalThis.foundry = { utils: { randomID: () => "custom" } };
  panel.addActor("c"); await store.pending;
  assert.equal(read().portraits.find((p) => p.id === "custom").height, 587);
  choose("normal"); assert.equal(panel.addHeight, 540);
});

test("effects disclosure preserves a parameter draft and closing appearance preserves its draft", async () => {
  const { panel, store, writes } = fixture();
  const block = { hidden: true }, form = { hidden: false, draft: 630 };
  const button = { dataset: { action: "effects-toggle" }, setAttribute() {}, classList: { toggle() {} } };
  panel.element.querySelector = (selector) => selector === "#fxp-effects" ? block : selector.includes("appearance-toggle") ? button : form;
  panel.applyPosition = () => {};
  panel.appearanceOpen = true;
  assert.equal(panel.effectsOpen, false);
  panel.onClick({ target: { closest: () => button } }); assert.equal(block.hidden, false);
  panel.onClick({ target: { closest: () => button } }); assert.equal(block.hidden, true);
  button.dataset.action = "appearance-toggle";
  panel.onClick({ target: { closest: () => button } });
  assert.equal(form.hidden, true); assert.equal(form.draft, 630);
  await store.pending; assert.equal(writes.length, 0);
  const markup = panel.portraitMarkup(store.state.portraits[0]);
  assert.doesNotMatch(markup, /name="(?:src|x)"|data-action="visibility"|↔/);
  assert.match(markup, />Отразить<|>Отразить<\/button>/);
  const blockStart = markup.indexOf('id="fxp-effects"');
  const clear = markup.indexOf('data-action="clear"');
  const clearAll = markup.indexOf('data-action="clear-all"');
  assert.ok(blockStart < clear && clear < clearAll);
});

function rosterFixture(panel, ids) {
  const buttons = ids.map((id, index) => ({
    dataset: { id }, style: { order: "" }, classList: { add() {}, remove() {} },
    animations: [], animate(frames) { this.animations.push(frames); },
    getBoundingClientRect() {
      const slot = this.style.order === "" ? index : Number(this.style.order);
      const left = 100 + slot % 3 * 90, top = 100 + Math.floor(slot / 3) * 40;
      return { left, right: left + 80, top, bottom: top + 30, width: 80, height: 30 };
    },
  }));
  const roster = { querySelectorAll: () => buttons,
    getBoundingClientRect: () => ({ left: 100, right: 420, top: 100, bottom: 100 + Math.ceil(ids.length / 3) * 40 }),
  };
  panel.element = { contains: () => true, querySelector: () => roster, querySelectorAll: () => buttons };
  globalThis.window = {};
  return { buttons, transfer: { setData() {} } };
}

test("dragging an unselected name previews its insertion before saving without selecting, hiding, or removing portraits", async () => {
  const { panel, store, read } = fixture();
  const { buttons, transfer } = rosterFixture(panel, ["a", "b"]);
  const start = () => panel.startRosterDrag({ target: { closest: () => buttons[1] }, dataTransfer: transfer });
  start();
  const event = { clientX: 110, clientY: 110, dataTransfer: transfer, preventDefault() {} };
  panel.overRosterDrag(event);
  assert.deepEqual(panel.rosterPreviewOrder, ["b", "a"]);
  assert.deepEqual(read().portraits.map((p) => p.id), ["a", "b"]);
  assert.equal(buttons[0].style.order, "1"); assert.equal(buttons[0].animations.length, 1);
  panel.dropRosterDrag(event);
  await store.pending;
  assert.deepEqual(read().portraits.map((p) => p.id), ["b", "a"]);
  assert.ok(read().portraits.every((p) => p.visible));
  assert.equal(panel.selectedId, "a"); assert.equal(panel.rosterDragId, null);
  game.user.isGM = false;
  start();
  assert.equal(panel.rosterDragId, null);
});

test("dropping into trailing empty space works and cancellation restores a temporary wrapped order", async () => {
  const { panel, store, read, writes } = fixture();
  const { buttons, transfer } = rosterFixture(panel, ["a", "b"]);
  panel.startRosterDrag({ target: { closest: () => buttons[0] }, dataTransfer: transfer });
  const event = { clientX: 410, clientY: 115, dataTransfer: transfer, preventDefault() {} };
  panel.overRosterDrag(event); assert.deepEqual(panel.rosterPreviewOrder, ["b", "a"]);
  panel.clearRosterDrag();
  assert.ok(buttons.every((button) => button.style.order === "")); assert.equal(writes.length, 0);
  assert.deepEqual(read().portraits.map((p) => p.id), ["a", "b"]);
  panel.startRosterDrag({ target: { closest: () => buttons[0] }, dataTransfer: transfer });
  panel.dropRosterDrag(event); await store.pending;
  assert.deepEqual(read().portraits.map((p) => p.id), ["b", "a"]);
  assert.equal(panel.rosterDropTarget({ clientX: 10, clientY: 10 }), null);
});

test("rapid slider inputs preview immediately, save the latest draft, and cannot affect a newly selected actor", async () => {
  const { panel, store, read, writes } = fixture();
  let projected;
  panel.onAppearancePreview = () => { projected = panel.projectAppearance(store.state); };
  const input = (name, value) => panel.onInput({ target: { dataset: {}, name, value, closest: () => ({}) } });
  input("height", "540"); input("height", "620"); input("offsetY", "150");
  assert.equal(projected.portraits[0].height, 620); assert.equal(projected.portraits[0].offsetY, 150);
  assert.equal(read().portraits[0].height, 500); assert.equal(writes.length, 0);
  panel.selectPortrait("b"); input("height", "570");
  panel.flushAppearance(); await store.pending;
  assert.equal(read().portraits[0].height, 620); assert.equal(read().portraits[0].offsetY, 150);
  assert.equal(read().portraits[1].height, 570); assert.equal(read().portraits[1].offsetY, 0);
  assert.equal(writes.length, 2); assert.equal(panel.appearanceDrafts.size, 0);
  input("height", "701"); input("offsetY", "451"); panel.flushAppearance(); await store.pending;
  assert.equal(writes.length, 2);
});

test("pointer reorder preserves clicks, opens a live gap, and cancellation restores order without a write", async () => {
  const { panel, store, read, writes } = fixture();
  const { buttons } = rosterFixture(panel, ["a", "b"]);
  let captured = false, captures = 0;
  panel.element.setPointerCapture = () => { captured = true; captures++; };
  panel.element.hasPointerCapture = () => captured;
  panel.element.releasePointerCapture = () => { captured = false; };
  const ghosts = [];
  buttons[0].cloneNode = () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; } });
  globalThis.document = { body: { append: (ghost) => ghosts.push(ghost) } };
  const start = { button: 0, pointerId: 1, clientX: 140, clientY: 115, target: { closest: () => buttons[0] } };
  panel.startDrag(start); panel.endDrag(start);
  assert.equal(captures, 0); assert.equal(writes.length, 0);
  panel.startDrag(start);
  const move = { pointerId: 1, buttons: 1, clientX: 410, clientY: 115, preventDefault() {} };
  panel.moveDrag(move);
  assert.equal(captured, true); assert.equal(ghosts.length, 1);
  assert.deepEqual(panel.rosterPreviewOrder, ["b", "a"]); assert.equal(writes.length, 0);
  panel.endDrag(move, true);
  assert.equal(captured, false); assert.equal(ghosts[0].removed, true);
  assert.ok(buttons.every((button) => button.style.order === ""));
  assert.deepEqual(read().portraits.map((p) => p.id), ["a", "b"]);
  panel.startDrag(start); panel.moveDrag(move); panel.endDrag(move);
  await store.pending;
  assert.deepEqual(read().portraits.map((p) => p.id), ["b", "a"]);
  panel.onClick({ target: { closest: () => ({ dataset: { action: "select", id: "b" } }) } });
  assert.equal(panel.selectedId, "a");
});

test("a slower earlier appearance save cannot replace a newer preview and the slider stays attached", async () => {
  const { panel, store, read } = fixture();
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const write = store.write;
  let count = 0;
  store.write = async (state) => { if (count++ === 0) await wait; await write(state); };
  let projected;
  panel.onAppearancePreview = () => { projected = panel.projectAppearance(store.state); };
  const input = { dataset: {}, name: "height", value: "550", closest: () => ({}) };
  globalThis.document = { activeElement: input };
  panel.renderedAppearanceStructure = panel.appearanceStructure();
  panel.render = PortraitPanel.prototype.render;
  Object.defineProperty(panel.element, "innerHTML", { set: () => assert.fail("Saving must keep the slider attached") });
  store.onChange = () => { panel.render(); panel.onAppearancePreview(); };
  panel.onInput({ target: input }); panel.flushAppearance();
  await new Promise((resolve) => setTimeout(resolve, 0));
  input.value = "620"; panel.onInput({ target: input }); panel.flushAppearance();
  assert.equal(projected.portraits[0].height, 620);
  release(); await store.pending;
  assert.equal(projected.portraits[0].height, 620); assert.equal(read().portraits[0].height, 620);
  assert.equal(panel.appearanceDrafts.size, 0);
});

test("an effect save during roster drag defers DOM replacement until the drag ends", () => {
  const { panel } = fixture();
  panel.render = PortraitPanel.prototype.render;
  panel.rosterDragId = "a";
  panel.element = { querySelectorAll: () => [] };
  panel.render(); assert.equal(panel.rosterRenderPending, true);
  let renders = 0;
  panel.render = () => { renders++; };
  panel.clearRosterDrag();
  assert.equal(renders, 1); assert.equal(panel.rosterDragId, null);
  assert.equal(panel.rosterRenderPending, false);
});
