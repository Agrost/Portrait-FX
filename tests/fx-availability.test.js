import test from "node:test";
import assert from "node:assert/strict";
import { viewerFxFactory } from "../scripts/fx-availability.js";

test("missing, inactive and older effect dependencies leave plain portraits available", () => {
  const factory = () => {};
  const setups = [
    [],
    [["fxmaster", { active: true }]],
    [["fxmaster-plus", { active: true, api: { createViewerFxRuntime: factory } }]],
    [["fxmaster", { active: false }], ["fxmaster-plus", { active: true, api: { createViewerFxRuntime: factory } }]],
    [["fxmaster", { active: true }], ["fxmaster-plus", { active: false, api: { createViewerFxRuntime: factory } }]],
    [["fxmaster", { active: true }], ["fxmaster-plus", { active: true, api: {} }]],
  ];
  for (const setup of setups) {
    globalThis.game = { modules: new Map(setup) };
    assert.equal(viewerFxFactory(), null);
  }
  globalThis.game = { modules: new Map([
    ["fxmaster", { active: true }], ["fxmaster-plus", { active: true, api: { createViewerFxRuntime: factory } }],
  ]) };
  assert.equal(viewerFxFactory(), factory);
});
