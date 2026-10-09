import test from "node:test";
import assert from "node:assert/strict";
import { Worker as NodeWorker } from "node:worker_threads";
import { resolveObjectURL } from "node:buffer";
import { collectTokenMagicMacro, importTokenMagicMacro } from "../scripts/tokenmagic-macros.js";
import { tokenMagicRegistry, tokenMagicRuntimeState } from "../scripts/tokenmagic-data.js";
import { PortraitPanel } from "../scripts/panel.js";
import { PortraitStore } from "../scripts/store.js";
import { newPortrait, INITIAL_STATE } from "../scripts/model.js";

class BrowserWorker {
  constructor(url) {
    this.ready = resolveObjectURL(url).text().then((script) => {
      if (this.stopped) return;
      this.worker = new NodeWorker(`const {parentPort} = require('node:worker_threads');
        globalThis.postMessage = (data) => parentPort.postMessage(data);
        ${script}
        parentPort.on('message', (data) => globalThis.onmessage({data}));`, { eval: true });
      this.worker.on("message", (data) => this.onmessage?.({ data }));
      this.worker.on("error", (error) => this.onerror?.({ message: error.message, preventDefault() {} }));
    });
  }
  postMessage(data) { this.ready.then(() => this.worker?.postMessage(data)); }
  terminate() { this.stopped = true; this.worker?.terminate(); }
}

const portrait = { id: "p", name: "Vivi", height: 500, src: "portrait.png" };
const source = `await (async () => {
  const TM = globalThis.TokenMagic;
  const tokens = [...(canvas.tokens?.controlled ?? [])];
  if (!game.modules.get('tokenmagic')?.active || !TM) return ui.notifications.warn('missing');
  const ID = 'sano-living-darkness';
  const TOTAL_TIME = 90000;
  const ramp = (from, to, duration = TOTAL_TIME, color = false) => ({
    active: true, animType: color ? 'halfColorOscillation' : 'halfCosOscillation',
    loopDuration: duration, loops: 1, val1: from, val2: to
  });
  const move = speed => ({active: true, animType: 'move', speed});
  function parameters() {
    return [
      {filterType:'splash',color:0x060407,spread:0,textureAlphaBlend:true,animated:{spread:ramp(0,2.2,TOTAL_TIME*.85),time:move(.00035)}},
      {filterType:'smoke',color:0,blend:5,animated:{color:ramp(0,0x484348,TOTAL_TIME*.8,true),time:move(.002)}},
      {filterType:'flood',glint:0,billowy:0,tintIntensity:0,animated:{billowy:ramp(0,.65,TOTAL_TIME*.85),time:move(.00018)}},
      {filterType:'distortion',maskSpriteScaleX:0,animated:{maskSpriteScaleX:ramp(0,3.5,TOTAL_TIME*.85)}},
      {filterType:'shadow',alpha:0,animated:{alpha:ramp(0,.4,TOTAL_TIME*.7)}},
      {filterType:'adjustment',alpha:1,brightness:1,animated:{alpha:ramp(1,0),brightness:ramp(1,.18,TOTAL_TIME*.85)}}
    ].map((filter,index)=>({...filter,filterId:ID,enabled:true,rank:100+index*10,zOrder:100+index*10}));
  }
  for (const token of tokens) {
    if (!token.document.isOwner) continue;
    if (TM.hasFilterId(token, ID)) await TM.deleteFilters(token, ID);
    else await TM.addUpdateFilters(token, parameters());
  }
})();`;

function setup() {
  let library = [];
  const api = { getPresets: () => [], filterTypes: Object.fromEntries(["splash", "smoke", "flood", "distortion", "shadow", "adjustment", "glow"].map((type) => [type, class {}])) };
  globalThis.TokenMagic = api;
  globalThis.Worker = BrowserWorker;
  globalThis.game = { user: { isGM: true }, modules: new Map([["tokenmagic", { active: true }]]), settings: { get: (_namespace, key) => key === "tokenMagicMacros" ? structuredClone(library) : false } };
  return { api, setLibrary: (value) => { library = structuredClone(value); } };
}

test("living darkness imports via a real worker without calling scene TokenMagic", async () => {
  const { api } = setup();
  api.addUpdateFilters = () => { throw new Error("Real token must not be touched"); };
  const params = await importTokenMagicMacro(source, portrait);
  assert.deepEqual(params.map((item) => item.filterType), ["splash", "smoke", "flood", "distortion", "shadow", "adjustment"]);
  assert.deepEqual(params.at(-1).animated.alpha, { active: true, animType: "halfCosOscillation", loopDuration: 90000, loops: 1, val1: 1, val2: 0 });
  assert.equal(params[1].animated.color.animType, "halfColorOscillation");
});

test("selected, targeted and placeable helpers collect compatible effects", async () => {
  setup();
  const params = await collectTokenMagicMacro(`
    await TokenMagic.addFiltersOnSelected([{filterType:'glow',filterId:'one',color:1}]);
    await token.TMFXaddUpdateFilters([{filterType:'glow',filterId:'one',color:2}]);
    await TokenMagic.addFiltersOnTargeted([{filterType:'smoke',filterId:'two'}]);
    await TokenMagic.deleteFilters(token,'two');`, portrait);
  assert.deepEqual(params, [{ filterType: "glow", filterId: "one", color: 2 }]);
});

test("GM permission, syntax, unsupported document writes and unknown filters reject import", async () => {
  setup();
  game.user.isGM = false;
  await assert.rejects(importTokenMagicMacro(source, portrait), /GM/);
  game.user.isGM = true;
  await assert.rejects(importTokenMagicMacro("const = ;", portrait));
  await assert.rejects(importTokenMagicMacro("await token.document.update({hidden:true})", portrait), /только фильтры/);
  await assert.rejects(importTokenMagicMacro("await TokenMagic.addFiltersOnSelected([{filterType:'missing'}])", portrait), /Неизвестный фильтр/);
});

test("an infinite macro is terminated without blocking Foundry's page", async () => {
  setup();
  await assert.rejects(importTokenMagicMacro("while(true) {}", portrait, { timeout: 60 }), /Импорт остановлен/);
});

test("saved library survives reload, applies only to selected portrait and retains initial animation state", async () => {
  const { setLibrary } = setup();
  let state = { ...structuredClone(INITIAL_STATE), portraits: [newPortrait(portrait, "p"), newPortrait({id:"other",name:"Other",img:"other.png"}, "other")] };
  const store = new PortraitStore({ read: () => state, write: async (next) => { state = structuredClone(next); }, canWrite: () => true });
  const panel = new PortraitPanel(store, { saveMacro: async (name, source, params) => {
    setLibrary([{ id: "macro:dark", name, source, params }]); return "macro:dark";
  } });
  panel.render = () => {};
  panel.selectedId = "p"; panel.macroName = "Живая тьма"; panel.macroSource = source; panel.macroOpen = true;
  await panel.saveMacroDraft();
  assert.equal(panel.macroError, ""); assert.equal(panel.macroOpen, false);
  assert.equal(panel.selectedEffects.tokenmagic, "macro:dark");
  const effect = tokenMagicRegistry()["macro:dark"];
  assert.equal(effect.label, "Живая тьма"); assert.equal(effect.params.length, 6);
  await store.applyEffect({ids:["p"],kind:"tokenmagic",effectId:"macro:dark",values:{params:effect.params}});
  assert.deepEqual(state.portraits[1].tokenmagic.enabled, {});
  const reloaded = new PortraitStore({read:()=>JSON.parse(JSON.stringify(state)),canWrite:()=>true,write:async()=>{}});
  const snapshot = tokenMagicRuntimeState(reloaded.state.portraits[0].tokenmagic);
  assert.equal(snapshot.options["macro:dark"].params.at(-1).alpha, 1);
  assert.equal(snapshot.options["macro:dark"].params.at(-1).animated.alpha.active, true);
  snapshot.options["macro:dark"].params.at(-1).alpha = 0;
  assert.equal(tokenMagicRegistry()["macro:dark"].params.at(-1).alpha, 1);
});

test("failed import keeps the draft and never persists an effect", async () => {
  setup();
  let writes = 0;
  const store = new PortraitStore({read:()=>({...INITIAL_STATE,portraits:[newPortrait(portrait,"p")]}),write:async()=>{},canWrite:()=>true});
  const panel = new PortraitPanel(store,{saveMacro:async()=>{writes++;}});
  panel.render = () => {}; panel.selectedId = "p"; panel.macroOpen = true;
  panel.macroName = "Broken"; panel.macroSource = "not valid JavaScript";
  await panel.saveMacroDraft();
  assert.equal(writes, 0); assert.equal(panel.macroOpen, true); assert.equal(panel.macroSource, "not valid JavaScript");
  assert.ok(panel.macroError); assert.equal(panel.macroBusy, false);
});
