import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanTokenMagicParams, tokenMagicRegistry, tokenMagicRuntimeState, tokenMagicDescriptor, tokenMagicEditedParams, selectedTokenMagicParams, randomizeTokenMagicParams } from "../scripts/tokenmagic-data.js";
import { attachTokenMagic, createPortraitFxRuntime } from "../scripts/tokenmagic-runtime.js";
import { newPortrait, normalizeState, INITIAL_STATE } from "../scripts/model.js";
import { PortraitStore } from "../scripts/store.js";
import { PortraitPanel } from "../scripts/panel.js";

function catalog() {
  const preset = { name: "glow", params: [{ filterType: "glow", color: 0x123456, outerStrength: 3, animated: { outerStrength: { animType: "cosOscillation", val1: 1, val2: 3, loopDuration: 1000 } } }] };
  globalThis.game = { user: { isGM: true }, modules: new Map([["tokenmagic", { active: true }]]), settings: { get: () => false } };
  globalThis.CONFIG = { fxmaster: { filterEffects: {}, particleEffects: {} } };
  globalThis.TokenMagic = { getPresets: () => [preset], filterTypes: { glow: class {} } };
  return preset;
}

test("old state keeps its version and adds independent empty TokenMagic state", () => {
  const state = normalizeState({ ...INITIAL_STATE, portraits: [{ id: "p", height: 400 }] });
  assert.equal(state.schemaVersion, 3); assert.equal(state.portraits[0].height, 400);
  assert.deepEqual(state.portraits[0].tokenmagic, { enabled: {}, options: {} });
});

test("TokenMagic snapshots survive preset deletion and unavailable module without mutating presets", () => {
  const preset = catalog();
  const params = cleanTokenMagicParams(preset.params);
  const state = { enabled: { "preset:glow": true }, options: { "preset:glow": { params } } };
  preset.params[0].color = 0;
  TokenMagic.getPresets = () => [];
  assert.equal(tokenMagicRuntimeState(state).options["preset:glow"].params[0].color, 0x123456);
  game.modules.get("tokenmagic").active = false;
  assert.deepEqual(tokenMagicRuntimeState(state).enabled, {});
  assert.equal(state.enabled["preset:glow"], true);
});

test("copied filter metadata and runtime method overrides never reach the viewer", () => {
  const raw = JSON.parse('{"filterType":"glow","placeableId":"token","dummy":true,"apply":"bad","animated":{"destroy":{"animType":"move"}},"__proto__":{"polluted":true}}');
  const [clean] = cleanTokenMagicParams([raw]);
  assert.deepEqual(clean, { filterType: "glow", animated: {} });
  assert.equal({}.polluted, undefined);
  assert.throws(() => cleanTokenMagicParams([{ filterType: "glow", value: () => {} }]));
});

test("parameter editing changes actual filter values while preserving animations and arrays", () => {
  const preset = catalog();
  preset.params[0].anchors = [0.5, 0.5];
  const descriptor = tokenMagicDescriptor(tokenMagicRegistry()["preset:glow"]);
  const values = Object.fromEntries(Object.entries(descriptor.parameters).map(([key, def]) => [key, def.value]));
  values["tm-0-color"] = { value: "#abcdef", apply: true };
  values["tm-0-outerStrength"] = 5;
  const result = tokenMagicEditedParams(descriptor, values);
  assert.equal(result.params[0].color, 0xabcdef); assert.equal(result.params[0].outerStrength, 5);
  assert.deepEqual(result.params[0].animated, preset.params[0].animated);
  assert.deepEqual(result.params[0].anchors, [0.5, 0.5]);
  assert.equal(preset.params[0].outerStrength, 3);
});

test("randomized values are resolved once and linked values survive save/reload", () => {
  const result = randomizeTokenMagicParams([{ filterType: "glow", randomized: { outerStrength: { val1: 1, val2: 5, step: 1, link: "innerStrength" } } }], () => 0.5);
  assert.equal(result[0].outerStrength, 3); assert.equal(result[0].innerStrength, 3);
  const again = randomizeTokenMagicParams(JSON.parse(JSON.stringify(result)), () => 0);
  assert.deepEqual(again, result);
});

test("all original main-library presets produce serializable descriptors and runtime snapshots", async (t) => {
  catalog();
  let source;
  try { source = await readFile(new URL("../../tokenmagic/fx/presets/defaultpresets.js", import.meta.url), "utf8"); }
  catch { t.skip("Sibling TokenMagic presets are not installed"); return; }
  const { presets } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  assert.ok(presets.length > 40);
  TokenMagic.getPresets = () => presets;
  const effects = tokenMagicRegistry();
  for (const preset of presets) {
    const id = `preset:${preset.name}`;
    assert.ok(effects[id], preset.name);
    const descriptor = tokenMagicDescriptor(effects[id]);
    assert.doesNotThrow(() => JSON.stringify(descriptor));
    const state = tokenMagicRuntimeState({ enabled: { [id]: true }, options: { [id]: { params: descriptor.params } } });
    assert.ok(state.options[id].params.length > 0, preset.name);
  }
});

test("copying requires one selected token and never changes its document", () => {
  catalog(); globalThis.canvas = { tokens: { controlled: [] } };
  assert.throws(selectedTokenMagicParams, /ровно один/);
  const raw = { filterType: "glow", filterOwner: "gm", placeableId: "token", color: 5 };
  canvas.tokens.controlled = [{ document: { getFlag: () => [{ tmFilters: { tmParams: raw } }] } }];
  const params = selectedTokenMagicParams(); params[0].color = 9;
  assert.equal(raw.color, 5); assert.equal(raw.placeableId, "token");
});

test("apply-all stores independent snapshots including hidden portraits and clears all three kinds", async () => {
  const preset = catalog();
  let saved = { ...INITIAL_STATE, portraits: ["a", "b"].map((id) => newPortrait({ id, name: id, img: `${id}.png` }, id)) };
  saved.portraits[1].visible = false;
  const store = new PortraitStore({ read: () => saved, write: async (next) => { saved = next; }, canWrite: () => true });
  await store.applyEffect({ kind: "tokenmagic", effectId: "preset:glow", values: { params: preset.params } });
  const reloaded = normalizeState(JSON.parse(JSON.stringify(saved)));
  assert.equal(reloaded.portraits[1].visible, false);
  assert.equal(reloaded.portraits[1].tokenmagic.enabled["preset:glow"], true);
  saved.portraits[0].tokenmagic.options["preset:glow"].params[0].color = 0;
  assert.equal(saved.portraits[1].tokenmagic.options["preset:glow"].params[0].color, 0x123456);
  await store.clearAllEffects();
  assert.deepEqual(saved.portraits[1].tokenmagic.enabled, {});
  assert.equal(saved.portraits[1].tokenmagic.options["preset:glow"].params.length, 1);
});

test("players cannot apply TokenMagic and empty copied sets cannot be enabled", async () => {
  const preset = catalog();
  const store = new PortraitStore({ read: () => INITIAL_STATE, write: () => assert.fail(), canWrite: () => false });
  await assert.rejects(store.applyEffect({ kind: "tokenmagic", effectId: "preset:glow", values: { params: preset.params } }), /только GM/);
  await assert.rejects(store.applyEffect({ kind: "tokenmagic", effectId: "copied-token", values: { params: [] } }), /нет фильтров/);
});

test("the panel uses numeric/color parameters, escapes preset names and copies to its selected portrait", async () => {
  const preset = catalog(); preset.name = '<img src="bad">';
  let saved = { ...INITIAL_STATE, portraits: [newPortrait({ id: "a", name: "A", img: "a.png" }, "a")] };
  const store = new PortraitStore({ read: () => saved, write: async (next) => { saved = next; }, canWrite: () => true });
  const panel = new PortraitPanel(store); panel.selectedId = "a"; panel.kind = "tokenmagic";
  const html = panel.portraitMarkup(store.state.portraits[0]);
  assert.match(html, /TokenMagic/); assert.match(html, /Взять эффекты выбранного токена/);
  assert.ok(!html.includes('<img src="bad">')); assert.match(html, /tm-0-color/);
  globalThis.canvas = { tokens: { controlled: [{ document: { getFlag: () => [{ tmFilters: { tmParams: preset.params[0] } }] } }] } };
  panel.element = { contains: () => true }; panel.render = () => {};
  panel.onClick({ target: { closest: () => ({ dataset: { action: "copy-token" } }) } });
  await store.pending;
  assert.equal(saved.portraits[0].tokenmagic.enabled["copied-token"], true);
});

function runtimeFixture() {
  catalog();
  let counter = 0;
  const callbacks = new Set();
  class Matrix { constructor() { this.a = this.d = 1; this.b = this.c = this.tx = this.ty = 0; } }
  globalThis.PIXI = { Matrix, UPDATE_PRIORITY: { HIGH: 25 }, Ticker: { shared: { lastTime: 0, add: (fn) => callbacks.add(fn), remove: (fn) => callbacks.delete(fn) } } };
  globalThis.foundry = { utils: { randomID: () => `test-${++counter}` } };
  const nativeMap = new Map();
  class Animation {
    constructor(filter) { this.puppet = filter; this.animeId = `anime-${++counter}`; this.animated = filter.animated; nativeMap.set(this.animeId, this); }
    static removeAnimationByFilterId(placeableId, filterId) { for (const [id, a] of nativeMap) if (a.puppet.placeableId === placeableId && a.puppet.filterId === filterId) nativeMap.delete(id); }
    animate(delta) { this.puppet.time += delta; this.autoDisableCheck(); }
    autoDisableCheck() {}
  }
  class Filter {
    constructor(params) {
      Object.assign(this, params); this.time = 0; this.padding = params.padding ?? 12; this.animated ??= {};
      this.targetPlaceable = this.getPlaceable(); this.placeableImg = this.targetPlaceable._TMFXgetSprite();
      this.anime = new Animation(this);
    }
    destroy() { this.destroyed = true; }
  }
  const sourceAnimation = new Animation({ placeableId: "real-token", filterId: "real" });
  TokenMagic.filterTypes = { glow: Filter }; TokenMagic._getAnimeMap = () => nativeMap;
  const sprite = { visible: false, filters: null, width: 300, height: 500 };
  const fxm = { enabled: true, name: "fxmaster" };
  const expired = [], sizes = [];
  const runtime = {
    _mediaSprite: sprite, fxm: [], hasActiveFilters() { return this.fxm.length > 0; },
    _syncMediaFilters() { sprite.filters = [...this.fxm]; sprite.visible = this.fxm.length > 0; },
    destroy() { this.destroyed = true; },
    app: { stage: { position: { set: (x, y) => { runtime.offset = [x, y]; } } }, renderer: { resize: (...size) => sizes.push(size) } },
  };
  const options = { width: 300, height: 500, canvas: { style: {} }, onFilterExpired: (...args) => expired.push(args) };
  attachTokenMagic(runtime, TokenMagic, options);
  const sync = (params = [{ filterType: "glow", animated: {}, padding: 12 }]) => runtime.syncTokenMagic({ enabled: { effect: true }, options: { effect: { params } } });
  const advance = (time) => { PIXI.Ticker.shared.lastTime = time; for (const fn of callbacks) fn(); };
  return { runtime, options, sprite, fxm, expired, sizes, callbacks, nativeMap, sourceAnimation, sync, advance };
}

test("TokenMagic alone renders the image, survives FXMaster filter updates, and reserves padding", () => {
  const f = runtimeFixture(); f.sync();
  assert.equal(f.runtime.hasActiveFilters(), true); assert.equal(f.sprite.visible, true);
  const tm = f.sprite.filters[0]; assert.equal(tm.placeableImg, f.sprite);
  assert.deepEqual(f.sizes.at(-1), [324, 524]); assert.deepEqual(f.runtime.offset, [12, 12]);
  f.runtime.fxm = [f.fxm]; f.runtime._syncMediaFilters();
  assert.deepEqual(f.sprite.filters, [f.fxm, tm]);
  f.runtime.fxm = []; f.runtime._syncMediaFilters(); assert.equal(f.sprite.visible, true);
  f.runtime.destroy();
});

test("viewer animation is detached from native TokenMagic and survives scene animation resets", () => {
  const f = runtimeFixture(); f.sync();
  assert.equal(f.nativeMap.size, 1); assert.ok([...f.nativeMap.values()].includes(f.sourceAnimation));
  const filter = f.sprite.filters[0]; f.advance(10); f.advance(30); assert.equal(filter.time, 20);
  f.nativeMap.clear(); f.advance(50); assert.equal(filter.time, 40);
  f.runtime.destroy(); assert.equal(f.callbacks.size, 0); assert.equal(filter.destroyed, true);
  f.runtime.destroy();
});

test("finite components expire a preset only once all its components finish", () => {
  const f = runtimeFixture(); f.sync([{ filterType: "glow", autoDestroy: true, animated: { time: { active: false } } }, { filterType: "glow", autoDisable: true, animated: { time: { active: true } } }]);
  f.advance(0); assert.equal(f.expired.length, 0);
  f.sprite.filters[0].animated.time.active = false; f.advance(10);
  assert.deepEqual(f.expired, [["effect", "tokenmagic"]]); assert.equal(f.runtime.hasActiveFilters(), false);
  f.advance(20); assert.equal(f.expired.length, 1); f.runtime.destroy();
});

test("an unsupported filter cleans up completed filters without touching token animations", () => {
  const f = runtimeFixture();
  assert.throws(() => f.sync([{ filterType: "glow" }, { filterType: "missing" }]), /Неизвестный/);
  assert.equal(f.nativeMap.size, 1); assert.equal(f.sprite.filters.length, 0);
  f.runtime.destroy(); assert.equal(f.callbacks.size, 0);
});

test("inactive TokenMagic leaves the original FXMaster runtime unchanged", () => {
  catalog(); game.modules.get("tokenmagic").active = false;
  const runtime = { destroy: () => assert.fail() };
  assert.equal(createPortraitFxRuntime(() => runtime, {}), runtime);
});

test("original TokenMagic Glow and Anime sources animate without canvas flags or native ticker ownership", async (t) => {
  let animeSource, protoSource, glowSource;
  try {
    [animeSource, protoSource, glowSource] = await Promise.all([
      readFile(new URL("../../tokenmagic/fx/Anime.js", import.meta.url), "utf8"),
      readFile(new URL("../../tokenmagic/fx/filters/proto/FilterProto.js", import.meta.url), "utf8"),
      readFile(new URL("../../tokenmagic/fx/filters/FilterGlow.js", import.meta.url), "utf8"),
    ]);
  } catch { t.skip("Sibling TokenMagic sources are not installed"); return; }
  const f = runtimeFixture();
  class Point { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class BaseFilter { destroy() { this.destroyed = true; } }
  PIXI.Point = Point; PIXI.Filter = BaseFilter;
  PIXI.filters = { GlowFilter: class extends BaseFilter {} };
  foundry.utils.mergeObject = (target, params) => Object.assign(target, params);
  globalThis.canvas = { app: { ticker: { add: () => assert.fail("Unexpected native ticker registration"), remove() {} } } };
  const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const { Anime } = await load(animeSource.replace(/^import .*;\r?\n/m, 'const isAnimationDisabled = () => false;\n'));
  const proto = protoSource.replace(/^import .*;\r?\n/gm, "");
  await load('const PlaceableType = { TOKEN: "Token" }; const FilterOverrideManager = { applyOverrides() {} }; const getPlaceableById = () => { throw new Error("Native scene lookup was used"); };\n' + proto);
  const animeUrl = `data:text/javascript;base64,${Buffer.from(animeSource.replace(/^import .*;\r?\n/m, 'const isAnimationDisabled = () => false;\n')).toString("base64")}`;
  const glow = glowSource.replace(/^import .*;\r?\n/gm, "");
  const { FilterGlow } = await load(`import { Anime } from "${animeUrl}";\n${glow}`);
  TokenMagic.filterTypes.glow = FilterGlow;
  TokenMagic._getAnimeMap = Anime.getAnimeMap;
  f.sync([{ filterType: "glow", outerStrength: 3, alpha: 1, animated: {
    outerStrength: { animType: "cosOscillation", val1: 1, val2: 3, loopDuration: 1000 },
    alpha: { animType: "halfCosOscillation", val1: 1, val2: 0, loopDuration: 20000, loops: 1, delay: 50000 },
  } }]);
  const filter = f.sprite.filters[0];
  assert.equal(Anime.getAnimeMap().size, 0);
  f.advance(0); const first = filter.outerStrength;
  f.advance(100); f.advance(200); f.advance(300);
  assert.notEqual(filter.outerStrength, first);
  assert.equal(filter.targetPlaceable._TMFXgetSprite(), f.sprite);
  Anime.resetAnimation(); f.advance(400); assert.notEqual(filter.outerStrength, first);
  for (let time = 500; time <= 50000; time += 100) f.advance(time);
  assert.equal(filter.alpha, 1);
  assert.equal(filter.anime.elapsedTime.alpha, 0);
  for (let time = 50100; time <= 70300; time += 100) f.advance(time);
  assert.equal(filter.alpha, 0);
  assert.equal(filter.animated.alpha.active, false);
  f.runtime.destroy(); assert.equal(Anime.getAnimeMap().size, 0); assert.equal(f.callbacks.size, 0);
});
