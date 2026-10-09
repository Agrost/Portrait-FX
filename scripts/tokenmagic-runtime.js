import { tokenMagicApi, cleanTokenMagicParams } from "./tokenmagic-data.js";
import { applyAnimationDelays } from "./tokenmagic-animation.js";

// Use TokenMagic's actual filters and animation methods, with per-instance
// placeables and animation callbacks. Never change TokenMagic/PIXI prototypes.
export function createPortraitFxRuntime(factory, options) {
  const runtime = factory(options);
  const api = tokenMagicApi();
  if (!api?.filterTypes || !options.tokenMagic) return runtime;
  try { return attachTokenMagic(runtime, api, options); }
  catch (error) { runtime.destroy(); throw error; }
}

export function attachTokenMagic(runtime, api, options) {
  if (!runtime.app?.stage || !runtime._mediaSprite || typeof runtime._syncMediaFilters !== "function") {
    throw new Error("Эта версия FXMaster+ не предоставляет изображение для TokenMagic.");
  }
  const sprite = runtime._mediaSprite;
  const target = { x: 0, y: 0, worldTransform: new PIXI.Matrix(), _TMFXgetSprite: () => sprite };
  const entries = [];
  const originalSync = runtime._syncMediaFilters;
  const originalHas = runtime.hasActiveFilters;
  const originalDestroy = runtime.destroy;
  const id = `fxp-${foundry.utils.randomID()}`;
  let disposed = false;
  let lastTime = null;
  let ticking = false;
  let failed = null;
  const videoListeners = new Map();

  function ownFilters() { return entries.filter((entry) => entry.filter.enabled !== false).map((entry) => entry.filter); }
  runtime._syncMediaFilters = function () {
    originalSync.call(runtime);
    const tm = ownFilters();
    sprite.filters = [...(sprite.filters ?? []), ...tm];
    sprite.visible = originalHas.call(runtime) || tm.length > 0;
  };
  runtime.hasActiveFilters = () => originalHas.call(runtime) || ownFilters().length > 0;

  function destroyEntry(entry) {
    const filter = entry.filter;
    if (!filter) return;
    filter.fxpDisposed = true;
    for (const { texture, callback } of filter.fxpTextureListeners ?? []) texture.off("update", callback);
    const listener = videoListeners.get(filter);
    if (listener) { listener.source.removeEventListener("loadedmetadata", listener.callback); videoListeners.delete(filter); }
    // Filter constructors register Anime immediately; detach only our IDs.
    filter.anime?.constructor.removeAnimationByFilterId?.(filter.placeableId, filter.filterId);
    try { filter.destroy(); } catch (error) { console.warn("FX Portraits | TokenMagic filter cleanup", error); }
    if (filter.filterType === "distortion" && !filter.sprite?.destroyed) filter.sprite?.destroy({ children: true, texture: false, baseTexture: false });
  }

  function expire(entry) {
    if (disposed || entry.filter.enabled === false) return;
    entry.filter.enabled = false;
    runtime._syncMediaFilters();
    if (entries.filter((item) => item.effectId === entry.effectId).every((item) => item.filter.enabled === false)) {
      options.onFilterExpired?.(entry.effectId, "tokenmagic");
    }
  }

  function localAnimations(entry) {
    const filter = entry.filter, anime = filter.anime;
    if (!anime) return;
    anime.constructor.removeAnimationByFilterId(filter.placeableId, filter.filterId);
    anime.persistTerminatedEffect = () => {};
    anime.autoDisableCheck = () => {
      if ((filter.autoDisable || filter.autoDestroy) && Object.values(filter.animated ?? {}).every((animation) => animation.active === false)) expire(entry);
    };
    // The synchronized modes originally use canvas.app's clock. Give this
    // instance the viewer clock instead; other TokenMagic animations are intact.
    const phase = (effect) => {
      const a = anime.animated[effect];
      return (lastTime ?? 0) / a.loopDuration + a.syncShift;
    };
    const oscillate = (effect, func, chaotic = false) => {
      const a = anime.animated[effect];
      const time = phase(effect) + (chaotic ? Math.random() * a.chaosFactor : 0);
      filter[effect] = (a.val1 - a.val2) * (func(Math.PI * 2 * time) + 1) / 2 + a.val2;
    };
    anime.syncCosOscillation = (effect) => oscillate(effect, Math.cos);
    anime.syncSinOscillation = (effect) => oscillate(effect, Math.sin);
    anime.syncChaoticOscillation = (effect) => oscillate(effect, Math.cos, true);
    anime.syncColorOscillation = (effect) => {
      const a = anime.animated[effect];
      const rgb1 = anime.constructor.valueToRgb(a.val1), rgb2 = anime.constructor.valueToRgb(a.val2);
      const amount = (Math.cos(Math.PI * 2 * phase(effect)) + 1) / 2;
      filter[effect] = anime.constructor.rgbToValue(...rgb1.map((channel, index) => Math.floor((channel - rgb2[index]) * amount + rgb2[index])));
    };
    anime.syncRotation = (effect) => {
      const a = anime.animated[effect];
      const rotation = 360 * (((lastTime ?? 0) + a.syncShift) % a.loopDuration) / a.loopDuration;
      filter[effect] = a.clockWise ? rotation : 360 - rotation;
    };
    applyAnimationDelays(anime);
  }

  function tick() {
    if (disposed || failed) return;
    const now = PIXI.Ticker.shared.lastTime;
    const delta = lastTime === null ? 0 : Math.max(0, Math.min(100, now - lastTime));
    lastTime = now;
    try {
      const animationDisabled = game.settings.get("tokenmagic", "disableAnimations");
      for (const entry of entries) {
        if (entry.filter.enabled === false) continue;
        entry.filter.preComputation?.();
        if (!animationDisabled && entry.filter.animated) entry.filter.anime?.animate(delta);
      }
    } catch (error) { failed = error; options.onRuntimeError?.(error); }
  }

  function padding() {
    // Reserve additional pixels on the canvas without changing portrait size.
    const additive = game.settings.get("tokenmagic", "useAdditivePadding");
    const amount = entries.reduce((total, entry) => additive ? total + Math.max(0, Number(entry.filter.padding) || 0) : Math.max(total, Number(entry.filter.padding) || 0), 0);
    const pad = Math.ceil(Math.min(512, amount));
    runtime.app.renderer.resize(options.width + pad * 2, options.height + pad * 2);
    runtime.app.stage.position.set(pad, pad);
    Object.assign(options.canvas.style, {
      width: `${(options.width + pad * 2) / options.width * 100}%`,
      height: `${(options.height + pad * 2) / options.height * 100}%`,
      left: `${-pad / options.width * 100}%`, top: `${-pad / options.height * 100}%`,
    });
  }

  runtime.syncTokenMagic = (state) => {
    if (disposed) return;
    for (const entry of entries) destroyEntry(entry);
    entries.length = 0;
    try {
      for (const [effectId, enabled] of Object.entries(state.enabled ?? {})) {
        if (!enabled) continue;
        const params = cleanTokenMagicParams(state.options[effectId].params);
        for (const raw of params) {
          const FilterClass = api.filterTypes[raw.filterType];
          if (typeof FilterClass !== "function") throw new Error(`Неизвестный фильтр TokenMagic: ${raw.filterType}`);
          const ownedId = `${id}-${entries.length}`;
          const values = { ...raw, placeableId: id, placeableType: "Token", filterId: ownedId, enabled: raw.enabled !== false };
          for (const animation of Object.values(values.animated ?? {})) {
            if (animation.loops === "Infinity") animation.loops = Infinity;
          }
          // Resolve the image during the base constructor, not after it: sprite
          // and polymorph filters already need it while loading their textures.
          let constructingFilter;
          class PortraitFilter extends FilterClass {
            setTMParams(params) { constructingFilter = this; return super.setTMParams(params); }
            getPlaceable() { return target; }
            calculatePadding() {
              const rawPad = Math.max(0, Number(this.rawPadding) || 0);
              const gridPad = Math.max(0, (Number(this.gridPadding) || 0) - 1) * 100;
              this.boundsPadding.x = this.boundsPadding.y = Math.max(rawPad, gridPad);
              this.currentPadding = Math.max(this.originalPadding || 0, this.boundsPadding.x);
            }
            handleTransform(state) {
              if (raw.filterType !== "distortion") return super.handleTransform?.(state);
              this.sprite.position.set(sprite.x + this.position.x, sprite.y + this.position.y);
              this.sprite.skew.copyFrom(this.skew);
              this.sprite.pivot.copyFrom(this.pivot);
              this.sprite.rotation = this.rotation + (this.sticky ? sprite.rotation : 0);
              this.sprite.transform.updateTransform(runtime.app.stage.transform);
            }
            _setTargetSpriteSize() { if (!disposed && !this.fxpDisposed) super._setTargetSpriteSize(); }
            assignTexture() {
              const texture = PIXI.Texture.from(this.imagePath);
              const previous = new Set(texture.listeners?.("update") ?? []);
              this.fxpTextureListeners ??= [];
              try { return super.assignTexture(); }
              finally {
                for (const callback of texture.listeners?.("update") ?? []) {
                  if (!previous.has(callback)) this.fxpTextureListeners.push({ texture, callback });
                }
              }
            }
            _playVideo(value) {
              const source = this.tex?.baseTexture?.resource?.source;
              if (!source || source.tagName !== "VIDEO" || disposed || this.fxpDisposed) return;
              const play = () => {
                if (disposed || this.fxpDisposed) return;
                if (value) Promise.resolve(game.video.play(source, { loop: this._loop, volume: 0 })).catch((error) => console.warn("FX Portraits | TokenMagic video", error));
                else game.video.stop(source);
              };
              const previous = videoListeners.get(this);
              if (previous) previous.source.removeEventListener("loadedmetadata", previous.callback);
              if (Number.isNaN(source.duration)) {
                const callback = () => { videoListeners.delete(this); play(); };
                videoListeners.set(this, { source, callback });
                source.addEventListener("loadedmetadata", callback, { once: true });
              } else play();
            }
          }
          let filter;
          try { filter = new PortraitFilter(values); }
          catch (error) {
            // A failing constructor can leave a registered animation behind.
            for (const anime of api._getAnimeMap?.().values() ?? []) {
              if (anime.puppet.placeableId === id && anime.puppet.filterId === ownedId) destroyEntry({ filter: anime.puppet });
            }
            if (constructingFilter && !constructingFilter.fxpDisposed) destroyEntry({ filter: constructingFilter });
            throw error;
          }
          const entry = { effectId, filter };
          entries.push(entry);
          localAnimations(entry);
        }
      }
      const zOrder = game.settings.get("tokenmagic", "useZOrder");
      entries.sort((a, b) => zOrder ? (a.filter.zOrder ?? 0) - (b.filter.zOrder ?? 0) : (a.filter.rank ?? 0) - (b.filter.rank ?? 0));
      padding();
      runtime._syncMediaFilters();
      if (entries.length && !ticking) {
        PIXI.Ticker.shared.add(tick, null, PIXI.UPDATE_PRIORITY.HIGH);
        ticking = true;
      }
      if (!entries.length && ticking) { PIXI.Ticker.shared.remove(tick, null); ticking = false; }
    } catch (error) {
      for (const entry of entries) destroyEntry(entry);
      entries.length = 0;
      runtime._syncMediaFilters();
      throw error;
    }
  };
  runtime.assertTokenMagicReady = () => { if (failed) throw failed; };
  runtime.destroy = () => {
    if (disposed) return;
    disposed = true;
    if (ticking) PIXI.Ticker.shared.remove(tick, null);
    for (const entry of entries) destroyEntry(entry);
    entries.length = 0;
    runtime._syncMediaFilters = originalSync;
    runtime.hasActiveFilters = originalHas;
    originalDestroy.call(runtime);
  };
  return runtime;
}
