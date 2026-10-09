import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyAnimationDelays } from "../scripts/tokenmagic-animation.js";
import { collectTokenMagicMacro } from "../scripts/tokenmagic-macros.js";
import { cleanTokenMagicParams } from "../scripts/tokenmagic-data.js";

async function originalAnime(t) {
  let source;
  try { source = await readFile(new URL("../../tokenmagic/fx/Anime.js", import.meta.url), "utf8"); }
  catch { t.skip("Sibling TokenMagic sources are not installed"); return; }
  source = source.replace(/^import .*;\r?\n/m, "const isAnimationDisabled = () => false;\n");
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).Anime;
}

function instance(Anime, alphaDelay = 50000) {
  const ramp = (delay, from, to, duration) => ({
    active: true, animType: "halfCosOscillation", loops: 1, loopDuration: duration,
    val1: from, val2: to, syncShift: 0, pauseBetweenDuration: 0, delay,
  });
  const puppet = { alpha: 1, brightness: 1, animated: {
    alpha: ramp(alphaDelay, 1, 0, 20000), brightness: ramp(0, 1, 0, 70000),
  } };
  const anime = Object.create(Anime.prototype);
  for (const key of ["frameTime", "elapsedTime", "loopElapsedTime", "pauseBetweenElapsedTime", "loops", "internalLoops", "ping", "pauseBetween", "shutdown"]) anime[key] = {};
  anime.puppet = puppet; anime.animated = puppet.animated;
  for (const effect of Object.keys(puppet.animated)) anime.initInternals(effect);
  anime.persistTerminatedEffect = () => {};
  let finished = 0;
  anime.autoDisableCheck = () => {
    if (Object.values(anime.animated).every((animation) => animation.active === false)) finished++;
  };
  applyAnimationDelays(anime);
  return { anime, puppet, finished: () => finished };
}

test("original Anime keeps alpha at one for 50 seconds, then fades over 20 seconds independently of brightness", async (t) => {
  const Anime = await originalAnime(t); if (!Anime) return;
  const { anime, puppet } = instance(Anime);
  for (let elapsed = 0; elapsed < 50000; elapsed += 20) anime.animate(20);
  assert.equal(puppet.alpha, 1);
  assert.equal(anime.elapsedTime.alpha, 0);
  assert.ok(puppet.brightness < 0.3);
  for (let elapsed = 0; elapsed < 10000; elapsed += 20) anime.animate(20);
  assert.ok(Math.abs(puppet.alpha - 0.5) < 0.002);
  for (let elapsed = 0; elapsed < 10060; elapsed += 20) anime.animate(20);
  assert.equal(puppet.alpha, 0);
  assert.equal(puppet.animated.alpha.active, false);
  anime.animate(100);
  assert.equal(puppet.alpha, 0);
});

test("a frame crossing a delay boundary advances only its remainder; another instance starts its delay afresh", async (t) => {
  const Anime = await originalAnime(t); if (!Anime) return;
  const first = instance(Anime, 50);
  first.anime.animate(75);
  assert.equal(first.anime.elapsedTime.alpha, 25);
  assert.equal(first.anime.elapsedTime.brightness, 75);
  const second = instance(Anime, 50);
  second.anime.animate(25);
  assert.equal(second.puppet.alpha, 1);
  assert.equal(second.anime.elapsedTime.alpha, 0);
});

test("waiting animations do not trigger automatic expiration even while every other property has finished", async (t) => {
  const Anime = await originalAnime(t); if (!Anime) return;
  const f = instance(Anime, 50000);
  f.puppet.animated.brightness.active = false;
  f.anime.animate(49999);
  assert.equal(f.finished(), 0);
  assert.equal(f.puppet.animated.alpha.active, true);
  f.anime.animate(1);
  assert.equal(f.finished(), 0);
  f.anime.animate(20000); f.anime.animate(1); f.anime.animate(1);
  assert.equal(f.puppet.alpha, 0);
  assert.equal(f.finished(), 1);
});

test("macro import and JSON snapshots preserve an animation delay without timers", async () => {
  const source = `await TokenMagic.addFiltersOnSelected([{filterType:'adjustment',alpha:1,
    animated:{alpha:{active:true,animType:'halfCosOscillation',val1:1,val2:0,loops:1,loopDuration:20000,delay:50000}}}]);`;
  const params = cleanTokenMagicParams(await collectTokenMagicMacro(source));
  const snapshot = JSON.parse(JSON.stringify(params));
  assert.equal(snapshot[0].animated.alpha.delay, 50000);
  assert.equal(snapshot[0].animated.alpha.loopDuration, 20000);
});
