import test from "node:test";
import assert from "node:assert/strict";
import { PortraitPanel } from "../scripts/panel.js";
import { INITIAL_STATE, newPortrait } from "../scripts/model.js";

test("world startup initializes portraits and GM editing without an effect engine", async () => {
  const originalOpen = PortraitPanel.prototype.open;
  let opened;
  PortraitPanel.prototype.open = function () { opened = this; };
  try {
    for (const oldPlus of [false, true]) {
      const callbacks = new Map(), windowEvents = new Map(), sections = [], messages = [];
      const makeElement = () => ({
        style: {}, dataset: {}, children: [], naturalWidth: 300, naturalHeight: 500,
        classList: { add() {}, toggle() {} },
        append(child) { this.children.push(child); }, addEventListener() {}, setAttribute() {}, remove() {},
        contains() { return false; }, querySelector() { return makeElement(); },
      });
      globalThis.document = {
        body: { append(element) { sections.push(element); } }, createElement: makeElement,
        getElementById: () => null, addEventListener() {}, removeEventListener() {},
      };
      globalThis.window = {
        innerWidth: 1200, innerHeight: 900,
        addEventListener(name, callback) { windowEvents.set(name, callback); }, removeEventListener() {},
      };
      globalThis.MutationObserver = globalThis.ResizeObserver = class { observe() {} disconnect() {} };
      globalThis.Hooks = { once(name, callback) { callbacks.set(name, callback); }, on() {} };
      globalThis.ui = { notifications: { error: (m) => messages.push(m), warn: (m) => messages.push(m) } };
      const portrait = newPortrait({ id: "actor", name: "Mage", img: "mage.png" }, "p");
      portrait.filter.enabled.neon = true;
      const values = new Map([["portraits", { ...INITIAL_STATE, portraits: [portrait] }]]);
      globalThis.game = {
        user: { id: "gm", isGM: true }, world: { id: "test" },
        modules: new Map([["sanos-portrait-fx", {}], ...(oldPlus ? [
          ["fxmaster", { active: true }], ["fxmaster-plus", { active: true, api: {} }],
        ] : [])]),
        settings: {
          register(_namespace, key, options) { if (!values.has(key)) values.set(key, options.default); },
          get(_namespace, key) { return values.get(key); },
          async set(_namespace, key, value) { values.set(key, value); },
        }, keybindings: { register() {} },
      };
      delete globalThis.CONFIG;
      delete globalThis.PIXI;
      await import(`../scripts/main.js?optional-startup=${oldPlus}`);
      callbacks.get("init")();
      callbacks.get("ready")();
      assert.equal(game.modules.get("sanos-portrait-fx").api.open(), true);
      assert.equal(opened.effectsAvailable, false);
      const stage = sections.find((section) => section.id === "fx-portraits-stage");
      assert.equal(stage.hidden, false);
      assert.equal(stage.children.length, 1);
      await opened.store.editPortrait("p", (p) => { p.name = "Renamed Mage"; });
      assert.equal(values.get("portraits").portraits[0].name, "Renamed Mage");
      assert.equal(values.get("portraits").portraits[0].filter.enabled.neon, true);
      assert.deepEqual(messages, []);
      windowEvents.get("beforeunload")();
    }
  } finally { PortraitPanel.prototype.open = originalOpen; }
});
