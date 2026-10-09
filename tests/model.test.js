import test from "node:test";
import assert from "node:assert/strict";
import { normalizeState, runtimeOptions, runtimeState, defaultValues, isParameterVisible, escapeHtml, registry } from "../scripts/model.js";

class Effect {
  static get parameters() {
    return {
      density: { type: "range", min: 0, max: 1, value: 0.3, __fxmInternalRange: { min: 0, max: 10 }, showWhen: () => true },
      tint: { type: "color", value: { value: "#ffeedd", apply: true } },
      manualPlacement: { type: "checkbox", value: true },
      soundFxEnabled: { type: "checkbox", value: true },
      lightSource: { type: "checkbox", value: true },
      tokenAvoidance: { type: "checkbox", value: true },
      tokenAvoidanceRadius: { type: "range", min: 0, max: 3, value: 1 },
    };
  }
}

test("runtime options retain wrapped normalized ranges and color semantics", () => {
  const options = runtimeOptions(Effect, { density: 0.8, tint: { value: "#123456", apply: false } });
  assert.equal(options.density.value, 0.8);
  assert.deepEqual(options.density.__fxmInternalRange, { min: 0, max: 10 });
  assert.deepEqual(options.tint.value, { value: "#123456", apply: false });
  assert.equal(options.density.showWhen, undefined);
  assert.doesNotThrow(() => structuredClone(options));
});

test("portrait rendering disables scene lights, token avoidance, manual placement and sound", () => {
  const options = runtimeOptions(Effect, {});
  for (const key of ["manualPlacement", "lightSource", "soundFxEnabled", "tokenAvoidance"]) {
    assert.equal(options[key].value, false);
  }
});

test("effects from missing modules are retained in storage but excluded from runtime", () => {
  const state = { enabled: { known: true, removed: true, disabled: false }, options: { known: { density: 0.6 } } };
  const runtime = runtimeState(state, { known: Effect });
  assert.deepEqual(runtime.enabled, { known: true });
  assert.equal(runtime.options.known.density.value, 0.6);
  assert.equal(runtime.soundFxEnabled, false);
  assert.equal(state.enabled.removed, true);
});

test("world state validates dimensions and does not duplicate portrait ids", () => {
  const state = normalizeState({ bottom: 900, portraits: [{ id: "a", height: -10 }, { id: "a" }, null] });
  assert.equal(state.bottom, 450);
  assert.equal(state.portraits.length, 1);
  assert.equal(state.portraits[0].height, 100);
  assert.deepEqual(state.portraits[0].filter, { enabled: {}, options: {} });
});

test("conditional settings use the same values as runtime options", () => {
  assert.equal(isParameterVisible({ showWhen: { enabled: true }, hideWhen: { orbit: true } }, { enabled: true, orbit: false }), true);
  assert.equal(isParameterVisible({ showWhen: ({ get }) => get("enabled") }, { enabled: false }), false);
  assert.equal(isParameterVisible({ hideWhen: { orbit: true } }, { orbit: true }), false);
});

test("partial saved options keep defaults without sharing mutable color values", () => {
  const first = defaultValues(Effect, { density: 99 });
  const second = defaultValues(Effect);
  assert.equal(first.density, 1);
  first.tint.value = "#000000";
  assert.equal(second.tint.value, "#ffeedd");
});

test("names, paths and registry labels cannot inject HTML", () => {
  assert.equal(escapeHtml('<img src="x" onerror="bad()">'), "&lt;img src=&quot;x&quot; onerror=&quot;bad()&quot;&gt;");
});

test("Water is excluded from portrait choices and runtime without altering FXMaster registry or Underwater", () => {
  const raw = { water: Effect, underwater: Effect, neon: Effect };
  globalThis.CONFIG = { fxmaster: { filterEffects: raw } };
  assert.deepEqual(Object.keys(registry("filter")), ["underwater", "neon"]);
  assert.equal(raw.water, Effect);
  const saved = { enabled: { water: true, neon: true }, options: { water: { density: 0.5 } } };
  assert.deepEqual(runtimeState(saved, registry("filter")).enabled, { neon: true });
  assert.equal(saved.enabled.water, true);
});
