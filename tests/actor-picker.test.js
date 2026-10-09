import test from "node:test";
import assert from "node:assert/strict";
import { ActorPicker, filterPickerActors } from "../scripts/actor-picker.js";
import { ActorCategories } from "../scripts/actor-categories.js";
import { PortraitPanel } from "../scripts/panel.js";
import { PortraitStore } from "../scripts/store.js";
import { INITIAL_STATE } from "../scripts/model.js";

const actors = [{ id: "a", name: "Маг", img: "a.png" }, { id: "b", name: "Следопыт", img: "b.png" }, { id: "c", name: "Архимаг", img: "c.png" }];
function fixture() {
  globalThis.game = { user: { isGM: true }, actors: { contents: actors, get: (id) => actors.find((actor) => actor.id === id) } };
  let saved = structuredClone(INITIAL_STATE), categoryData = { categories: [{ id: "f", name: 'Фракции <"test">' }], assignments: { a: ["f"] } };
  const store = new PortraitStore({ read: () => saved, write: async (next) => { saved = next; }, canWrite: () => game.user.isGM });
  const categories = new ActorCategories({ read: () => categoryData, write: async (next) => { categoryData = next; }, canWrite: () => game.user.isGM });
  const panel = new PortraitPanel(store, { categories });
  return { panel, picker: panel.picker, categories, store, read: () => saved };
}

test("search combines with category union and uncategorized filtering without duplicating multi-category actors", () => {
  const assignments = { a: ["f", "r"], c: ["r"] };
  const ids = (options) => filterPickerActors(actors, { assignments, ...options }).map((actor) => actor.id);
  assert.deepEqual(ids({ search: " МАГ " }), ["a", "c"]);
  assert.deepEqual(ids({ selected: new Set(["f"]), search: "маг" }), ["a"]);
  assert.deepEqual(ids({ selected: new Set(["f", "r"]) }), ["a", "c"]);
  assert.deepEqual(ids({ uncategorized: true }), ["b"]);
  assert.deepEqual(ids({ selected: new Set(["r"]), uncategorized: true }), ["a", "b", "c"]);
});

test("separate picker adds with current height and visibility after main panel closes and never duplicates", async () => {
  const { panel, picker, store, read } = fixture();
  let id = 0; globalThis.foundry = { utils: { randomID: () => `p${++id}` } };
  panel.addHeightPreset = "custom"; panel.addHeight = 612; panel.addName = false; panel.addHidden = true;
  picker.element = { contains: () => true };
  picker.render = () => {};
  const click = () => picker.onClick({ target: { closest: () => ({ dataset: { action: "picker-add", actorId: "a" } }) } });
  assert.equal(panel.element, null);
  click(); click(); await store.pending;
  assert.equal(read().portraits.length, 1);
  assert.equal(read().portraits[0].height, 612);
  assert.equal(read().portraits[0].showName, false);
  assert.equal(read().portraits[0].visible, false);
  panel.addActor("b"); await store.pending;
  assert.equal(read().portraits[1].visible, false);
  assert.equal(read().portraits[1].height, 612);
});

test("picker favorites are stable until reopening and markup escapes actor and category names", () => {
  const { panel, picker } = fixture();
  panel.favorites = { state: [] };
  const original = picker.actors().map((actor) => actor.id);
  panel.favorites.state = ["b"];
  assert.deepEqual(picker.actors().map((actor) => actor.id), original);
  picker.actorOrder = null;
  assert.equal(picker.actors()[0].id, "b");
  picker.assignmentActor = "a";
  assert.match(picker.listMarkup(), /Фракции &lt;&quot;test&quot;&gt;/);
  assert.doesNotMatch(picker.listMarkup(), /Фракции <"test">/);
  game.user.isGM = false;
  let added = false; panel.addActor = () => { added = true; };
  picker.element = { contains: () => true };
  picker.onClick({ target: { closest: () => ({ dataset: { action: "picker-add", actorId: "a" } }) } });
  assert.equal(added, false);
});

test("renaming categories preserves selected filters and assignments while added strip follows portrait order", async () => {
  const { picker, panel, categories } = fixture();
  picker.selected.add("f");
  await categories.save("f", "НПС");
  assert.match(picker.listMarkup(), /Маг/);
  assert.doesNotMatch(picker.listMarkup(), /Следопыт/);
  panel.store.state.portraits = [{ id: "p2", actorId: "b", name: "Следопыт", src: "b.png", visible: false }, { id: "p1", actorId: "a", name: "Маг", src: "a.png", visible: true }];
  const markup = picker.addedMarkup();
  assert.ok(markup.indexOf('data-id="p2"') < markup.indexOf('data-id="p1"'));
  assert.match(markup, /is-hidden-portrait/);
  assert.match(picker.listMarkup(), /data-action="picker-add" data-actor-id="a" disabled/);
});

test("picker geometry fits narrow viewports and moving or resizing cannot put the header offscreen", () => {
  const picker = new ActorPicker({ panel: {}, categories: {} });
  globalThis.window = { innerWidth: 320, innerHeight: 460 };
  picker.element = { style: {} }; picker.position = { left: 900, top: 900 };
  picker.applyGeometry();
  assert.deepEqual(picker.element.style, { width: "304px", height: "444px", left: "8px", top: "8px" });
  window.innerWidth = 1200; window.innerHeight = 900;
  picker.applyGeometry();
  assert.equal(picker.element.style.width, "780px");
  assert.equal(picker.element.style.height, "600px");
});
