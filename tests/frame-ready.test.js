import test from "node:test";
import assert from "node:assert/strict";
import { frameReady } from "../scripts/frame-ready.js";

test("an unloaded filter sampler delays rendering until its texture becomes valid", () => {
  const sampler = { valid: false, baseTexture: { valid: true } };
  let renders = 0;
  const runtime = { app: { stage: { children: [{ filters: [{ uniforms: { strength: 0.5, samplers: [sampler] } }] }] },
    renderer: { render: () => renders++ } } };
  assert.equal(frameReady(runtime), false);
  assert.equal(renders, 0);
  sampler.valid = true;
  assert.equal(frameReady(runtime), true);
  assert.equal(renders, 1);
});

test("hidden display nodes do not block readiness and missing renderer fails visibly", () => {
  const runtime = { app: { stage: { children: [{ visible: false, texture: { valid: false, baseTexture: {} } }] },
    renderer: { render() {} } } };
  assert.equal(frameReady(runtime), true);
  assert.throws(() => frameReady({}), /renderer is unavailable/);
});

test("FXMaster mask, region and Neon halo EMPTY samplers never await a load", () => {
  const empty = { valid: false, destroyed: false, baseTexture: { valid: false } };
  globalThis.PIXI = { Texture: { EMPTY: empty } };
  let renders = 0;
  const runtime = { app: { stage: { children: [{
    texture: { valid: true, baseTexture: { valid: true } },
    filters: [{ uniforms: { maskSampler: empty, uSdf: empty, haloSampler: empty, hasMask: 0, haloReady: 0 } }],
  }] }, renderer: { render: () => renders++ } } };
  assert.equal(frameReady(runtime), true);
  assert.equal(frameReady(runtime), true);
  assert.equal(renders, 2);
});

test("ignoring EMPTY does not skip an actual asset or a destroyed texture", () => {
  const empty = { valid: false, baseTexture: { valid: false } };
  globalThis.PIXI = { Texture: { EMPTY: empty } };
  const asset = { valid: false, baseTexture: { valid: false } };
  const runtime = { app: { stage: { children: [{ filters: [{ uniforms: { maskSampler: empty, uGlyphAtlas: asset } }] }] },
    renderer: { render() {} } } };
  assert.equal(frameReady(runtime), false);
  asset.valid = true;
  asset.baseTexture.valid = true;
  assert.equal(frameReady(runtime), true);
  asset.destroyed = true;
  assert.equal(frameReady(runtime), false);
});
