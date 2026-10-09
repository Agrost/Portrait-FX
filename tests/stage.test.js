import test from "node:test";
import assert from "node:assert/strict";
import { PortraitStage } from "../scripts/stage.js";
import { effectState } from "../scripts/model.js";
import { PortraitPanel } from "../scripts/panel.js";

function canvas() {
  return { hidden: true, removed: false, remove() { this.removed = true; }, setAttribute() {} };
}
function fixture() {
  globalThis.document = { createElement: () => canvas() };
  globalThis.window = { innerWidth: 1200, innerHeight: 900 };
  const empty = { valid: false, baseTexture: { valid: false } };
  globalThis.PIXI = { Texture: { EMPTY: empty } };
  const frames = new Map();
  let next = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const advance = () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((callback) => callback());
  };
  const ready = () => { advance(); advance(); };
  class Effect { static parameters = { intensity: { type: "range", min: 0, max: 1, value: 0.5 } }; }
  globalThis.CONFIG = { fxmaster: { filterEffects: { neon: Effect }, particleEffects: { stars: Effect } } };
  const created = [], errors = [], expired = [];
  const stage = Object.create(PortraitStage.prototype);
  stage.reportError = (message) => errors.push(message);
  stage.onFilterExpired = (...args) => expired.push(args);
  stage.runtimeFactory = (options) => {
    const texture = { valid: true, baseTexture: { valid: true } };
    const runtime = {
      options, texture, filters: {}, particles: {}, stopped: false, renders: 0,
      sync(state) { this.particles = state; },
      syncFilters(state) { this.filters = state; },
      hasActiveFilters() { return Object.values(this.filters.enabled ?? {}).some(Boolean); },
      destroy() { this.stopped = true; options.canvas.remove(); },
    };
    runtime.app = { stage: { children: [{ texture, filters: [{ uniforms: { maskSampler: empty, uSdf: empty, haloSampler: empty } }] }] }, renderer: { render: () => {
      if (runtime.renderError) throw runtime.renderError; runtime.renders++;
    } } };
    created.push(runtime); return runtime;
  };
  const card = {
    image: { naturalWidth: 300, naturalHeight: 500, style: { visibility: "" } },
    media: { style: {}, children: [], append(item) { this.children.push(item); } },
    portrait: { id: "p", name: "Mage", height: 500, filter: effectState(), particle: effectState() },
    canvas: canvas(), runtime: null, pending: null, signature: "", size: "", disposed: false,
  };
  return { stage, card, created, errors, expired, advance, ready, frames };
}

test("plain portrait keeps saved effects intact without a runtime or effect libraries", () => {
  const { stage, card, created, errors, frames } = fixture();
  stage.runtimeFactory = null;
  card.portrait.filter.enabled.neon = true;
  card.portrait.particle.enabled.stars = true;
  card.portrait.tokenmagic = { enabled: { glow: true }, options: { glow: { params: [{ filterType: "glow" }] } } };
  const saved = structuredClone(card.portrait);
  delete globalThis.CONFIG;
  delete globalThis.PIXI;
  stage.update(card, 1);
  assert.equal(card.image.style.visibility, "");
  assert.equal(card.canvas.hidden, true);
  assert.equal(card.media.style.height, "500px");
  assert.deepEqual(card.portrait, saved);
  assert.deepEqual(created, []);
  assert.deepEqual(errors, []);
  assert.equal(frames.size, 0);
});

test("first filter keeps the source visible until textures and frame are ready", () => {
  const { stage, card, created, advance } = fixture();
  card.portrait.filter.enabled.neon = true; stage.update(card, 1);
  created[0].texture.baseTexture.valid = false; advance(); advance();
  assert.equal(card.image.style.visibility, ""); assert.equal(card.pending.canvas.hidden, true);
  assert.equal(created[0].renders, 0);
  created[0].texture.baseTexture.valid = true; advance();
  assert.equal(card.image.style.visibility, ""); advance();
  assert.equal(card.image.style.visibility, "hidden"); assert.equal(card.canvas.hidden, false);
  assert.equal(card.runtime.renders, 2);
});

test("editing effects keeps the previous live canvas until the replacement is ready", () => {
  const { stage, card, created, ready } = fixture();
  card.portrait.filter.enabled.neon = true; stage.update(card, 1); ready();
  const previous = card.canvas;
  card.portrait.filter.options.neon = { intensity: 0.8 }; stage.update(card, 1);
  assert.equal(card.canvas, previous); assert.equal(previous.hidden, false);
  assert.equal(previous.removed, false); assert.equal(created[0].stopped, false);
  assert.equal(card.pending.canvas.hidden, true); ready();
  assert.notEqual(card.canvas, previous); assert.equal(created[0].stopped, true);
  assert.equal(previous.removed, true);
  assert.equal(card.runtime.filters.options.neon.intensity.value, 0.8);
});

test("disabling the filter retains particles with the original image visible", () => {
  const { stage, card, ready } = fixture();
  card.portrait.filter.enabled.neon = true; card.portrait.particle.enabled.stars = true;
  stage.update(card, 1); ready();
  card.portrait.filter.enabled.neon = false; stage.update(card, 1); ready();
  assert.equal(card.image.style.visibility, ""); assert.equal(card.canvas.hidden, false);
  assert.equal(card.runtime.particles.enabled.stars, true);
});

test("clearing cancels preparation and re-enabling uses an attached fresh canvas", () => {
  const { stage, card, created, ready, frames } = fixture();
  card.portrait.filter.enabled.neon = true; stage.update(card, 1); ready();
  const previous = card.canvas;
  card.portrait.filter.options.neon = { intensity: 0.7 }; stage.update(card, 1);
  card.portrait.filter.enabled.neon = false; stage.update(card, 1);
  assert.equal(created.every((item) => item.stopped), true); assert.equal(frames.size, 0);
  assert.equal(previous.removed, true); assert.ok(card.media.children.includes(card.canvas));
  assert.equal(card.image.style.visibility, "");
  card.portrait.filter.enabled.neon = true; stage.update(card, 1); ready();
  assert.equal(created.length, 3); assert.equal(card.canvas.removed, false);
  assert.equal(created[2].options.canvas, card.canvas);
});

test("rapid edits cancel superseded preparations and commit only the latest state", () => {
  const { stage, card, created, ready } = fixture();
  card.portrait.filter.enabled.neon = true; stage.update(card, 1);
  card.portrait.filter.options.neon = { intensity: 0.9 }; stage.update(card, 1);
  assert.equal(created[0].stopped, true); ready();
  assert.equal(card.runtime, created[1]);
  assert.equal(card.runtime.filters.options.neon.intensity.value, 0.9);
  stage.update(card, 1); assert.equal(created.length, 2);
});

test("a replacement rendering error keeps the previous image and is reported once", () => {
  const { stage, card, created, errors, ready, advance } = fixture();
  card.portrait.filter.enabled.neon = true; stage.update(card, 1); ready();
  card.portrait.filter.options.neon = { intensity: 0.8 }; stage.update(card, 1);
  created[1].renderError = new Error("Shader failure"); advance(); stage.update(card, 1);
  assert.equal(card.runtime, created[0]); assert.equal(created[0].stopped, false);
  assert.equal(created[1].stopped, true); assert.equal(card.canvas.hidden, false);
  assert.equal(errors.length, 1);
});

test("failed initial allocation leaves source visible and removes candidate canvas", () => {
  const { stage, card, errors } = fixture();
  stage.runtimeFactory = () => { throw new Error("WebGL unavailable"); };
  card.portrait.filter.enabled.neon = true; stage.update(card, 1); stage.update(card, 1);
  assert.equal(card.image.style.visibility, ""); assert.equal(card.canvas.hidden, true);
  assert.equal(card.media.children[0].removed, true); assert.equal(errors.length, 1);
});

test("old filter expiration cannot disable a newer effect being prepared", () => {
  const { stage, card, created, expired, ready } = fixture();
  card.portrait.filter.enabled.neon = true; stage.update(card, 1); ready();
  card.portrait.filter.options.neon = { intensity: 0.8 }; stage.update(card, 1);
  created[0].options.onFilterExpired("neon"); assert.equal(expired.length, 0); ready();
  created[0].options.onFilterExpired("neon"); assert.equal(expired.length, 0);
  created[1].options.onFilterExpired("neon"); assert.deepEqual(expired, [["p", "neon"]]);
});

test("separate portraits retain independent runtimes and effect states", () => {
  const { stage, card, ready } = fixture();
  const second = { ...card, image: { ...card.image, style: {} }, media: { ...card.media, children: [], style: {} },
    portrait: { ...card.portrait, id: "second", filter: effectState(), particle: effectState() }, canvas: canvas() };
  card.portrait.filter.enabled.neon = true; second.portrait.particle.enabled.stars = true;
  stage.update(card, 2); stage.update(second, 2); ready();
  assert.notEqual(card.runtime, second.runtime); assert.equal(card.runtime.hasActiveFilters(), true);
  assert.equal(second.runtime.hasActiveFilters(), false); assert.equal(second.image.style.visibility, "");
});

test("portraits without effects do not allocate a rendering runtime", () => {
  const { stage, card, created } = fixture(); stage.update(card, 1);
  assert.equal(created.length, 0); assert.equal(card.canvas.hidden, true);
});

test("expanding Foundry sidebar scales the view without replacing its active FX runtime", () => {
  const { stage, card, created, ready } = fixture();
  card.portrait.visible = true;
  card.portrait.filter.enabled.neon = true;
  stage.state = { bottom: 80, portraits: [card.portrait, { ...card.portrait, id: "b" }, { ...card.portrait, id: "c" }] };
  stage.render = () => stage.update(card, 3);
  stage.update(card, 3); ready();
  const runtime = card.runtime;
  assert.equal(card.media.style.height, "500px");
  stage.setObstruction({ left: 760, right: 1190, top: 85, bottom: 880 });
  assert.equal(card.media.style.height, "360px");
  assert.equal(card.runtime, runtime);
  assert.equal(created.length, 1);
  assert.equal(card.pending, null);
  stage.setObstruction(null);
  assert.equal(card.media.style.height, "500px");
  assert.equal(created.length, 1);
});

test("changing an added portrait's height still enlarges it in a crowded row/expanded sidebar", () => {
  const { stage, card } = fixture();
  card.portrait.visible = true;
  stage.state = { bottom: 80, portraits: [card.portrait, { ...card.portrait, id: "b" }, { ...card.portrait, id: "c" }] };
  stage.obstruction = { left: 760, right: 1190, top: 85, bottom: 880 };
  stage.update(card, 3);
  const first = parseFloat(card.media.style.height);
  card.portrait.height = 600;
  stage.update(card, 3);
  assert.ok(Math.abs(parseFloat(card.media.style.height) - first * 1.2) < 1e-9);
  card.portrait.height = 400;
  stage.update(card, 3);
  assert.ok(Math.abs(parseFloat(card.media.style.height) - first * 0.8) < 1e-9);
});

test("manual portrait height is limited only by actual screen bounds, not per-slot width", () => {
  const { stage, card } = fixture();
  card.portrait.height = 600;
  stage.update(card, 3);
  assert.equal(card.media.style.height, "600px");
  globalThis.window.innerHeight = 650;
  stage.update(card, 3);
  assert.equal(card.media.style.height, "546px");
});

test("double click opens only a current portrait and only for an authorized GM", () => {
  const { stage, card } = fixture();
  stage.cards = new Map([["p", card]]);
  const opened = [];
  stage.onOpenPortrait = (id) => opened.push(id);
  let gm = false;
  stage.canOpenPortrait = () => gm;
  const event = { target: { closest: () => ({ dataset: { portraitId: "p" } }) }, preventDefault() {} };
  stage.openPortrait(event); assert.deepEqual(opened, []);
  gm = true;
  stage.openPortrait(event); assert.deepEqual(opened, ["p"]);
  stage.cards.clear(); stage.openPortrait(event); assert.deepEqual(opened, ["p"]);
});

test("stationary portrait clicks do not capture pointer or save a position; drag still works", () => {
  const { stage, card } = fixture();
  const positions = [];
  let captures = 0;
  let captured = false;
  card.element = { dataset: { portraitId: "p" }, style: {}, classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 450, width: 300 }) };
  stage.cards = new Map([["p", card]]);
  stage.canMove = () => true;
  stage.onPositionChange = (id, x) => positions.push([id, x]);
  stage.element = { setPointerCapture() { captures++; captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; } };
  const event = { button: 0, pointerId: 1, clientX: 600, target: { closest: () => card.element } };
  stage.startDrag(event); stage.endDrag(event);
  assert.equal(captures, 0); assert.deepEqual(positions, []);
  stage.startDrag(event); stage.moveDrag({ ...event, clientX: 660 }); stage.endDrag(event);
  assert.equal(captures, 1); assert.equal(positions.length, 1);
  assert.equal(positions[0][0], "p"); assert.ok(Math.abs(positions[0][1] - 55) < 1e-9);
});

test("opening GM settings selects the clicked portrait and expands an existing collapsed panel", () => {
  globalThis.game = { user: { isGM: true } };
  const panel = Object.create(PortraitPanel.prototype);
  panel.store = { state: { portraits: [{ id: "a" }, { id: "b" }] } };
  panel.selectedId = "a"; panel.collapsed = true; panel.actorSearch = "маг";
  const body = { scrollTop: 200 };
  let opens = 0;
  panel.open = () => { opens++; panel.element = { querySelector: () => body }; };
  panel.openPortrait("b");
  assert.equal(panel.selectedId, "b"); assert.equal(panel.collapsed, false);
  assert.equal(panel.actorSearch, "маг"); assert.equal(body.scrollTop, 0); assert.equal(opens, 1);
  game.user.isGM = false; panel.openPortrait("a");
  assert.equal(panel.selectedId, "b"); assert.equal(opens, 1);
});

test("TokenMagic alone prepares a canvas and hides the source only after the frame is ready", () => {
  const { stage, card, created, ready } = fixture();
  globalThis.game = { modules: new Map([["tokenmagic", { active: true }]]) };
  globalThis.TokenMagic = { filterTypes: { glow: class {} }, getPresets: () => [] };
  card.portrait.tokenmagic = { enabled: { "copied-token": true }, options: { "copied-token": { params: [{ filterType: "glow", color: 1 }] } } };
  const base = stage.runtimeFactory;
  stage.runtimeFactory = (options) => {
    const runtime = base(options);
    runtime.syncTokenMagic = (state) => { runtime.tokenmagic = state; };
    runtime.hasActiveFilters = () => Object.keys(runtime.tokenmagic?.enabled ?? {}).length > 0;
    return runtime;
  };
  stage.update(card, 1);
  assert.equal(created[0].options.tokenMagic, true); assert.equal(card.image.style.visibility, "");
  ready(); assert.equal(card.image.style.visibility, "hidden");
  assert.equal(card.runtime.tokenmagic.options["copied-token"].params[0].color, 1);
  card.portrait.tokenmagic.enabled = {}; stage.update(card, 1);
  assert.equal(created[0].stopped, true); assert.equal(card.image.style.visibility, "");
});
