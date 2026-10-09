import { registry, runtimeState, escapeHtml } from "./model.js";
import { portraitArea, screenX, localX } from "./layout.js";
import { frameReady } from "./frame-ready.js";
import { tokenMagicRuntimeState } from "./tokenmagic-data.js";

export class PortraitStage {
  constructor({ runtimeFactory, reportError, onFilterExpired, canMove = () => false, onPositionChange, canOpenPortrait = () => false, onOpenPortrait }) {
    this.runtimeFactory = runtimeFactory;
    this.reportError = reportError;
    this.onFilterExpired = onFilterExpired;
    this.canMove = canMove;
    this.onPositionChange = onPositionChange;
    this.canOpenPortrait = canOpenPortrait;
    this.onOpenPortrait = onOpenPortrait;
    this.drag = null;
    this.cards = new Map();
    this.element = document.createElement("section");
    this.element.id = "fx-portraits-stage";
    this.element.setAttribute("aria-label", "Портреты персонажей");
    document.body.append(this.element);
    this.element.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.element.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.element.addEventListener("pointerup", (event) => this.endDrag(event));
    this.element.addEventListener("pointercancel", (event) => this.endDrag(event, true));
    this.element.addEventListener("dblclick", (event) => this.openPortrait(event));
    this.onPointerUp = (event) => this.endDrag(event);
    window.addEventListener("pointerup", this.onPointerUp);
    this.resizeTimer = null;
    this.onResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => { if (this.state) this.render(this.state); }, 180);
    };
    window.addEventListener("resize", this.onResize);
  }

  render(state) {
    this.state = state;
    this.element.style.bottom = `${state.bottom}px`;
    const visible = state.portraits.filter((item) => item.visible);
    const ids = new Set(visible.map((item) => item.id));
    for (const [id, card] of this.cards) {
      if (!ids.has(id)) { this.release(card); this.cards.delete(id); }
    }
    this.element.hidden = visible.length === 0;
    for (const portrait of visible) {
      let card = this.cards.get(portrait.id);
      if (card && card.src !== portrait.src) {
        this.release(card);
        this.cards.delete(portrait.id);
        card = null;
      }
      if (!card) {
        card = this.create(portrait);
        this.cards.set(portrait.id, card);
      }
      card.portrait = portrait;
      card.label.textContent = portrait.showName ? portrait.name.trim() || "Персонаж" : "";
      card.label.hidden = !portrait.showName;
      card.image.alt = portrait.showName ? portrait.name : "Портрет персонажа";
      card.element.dataset.portraitId = portrait.id;
      card.element.classList.toggle("fxp-draggable", this.canMove());
      card.art.style.transform = portrait.mirrored ? "scaleX(-1)" : "";
      this.element.append(card.element);
      if (card.image.complete && card.image.naturalWidth > 0) this.update(card, visible.length);
    }
  }

  setObstruction(obstruction) {
    if (JSON.stringify(this.obstruction) === JSON.stringify(obstruction)) return;
    this.obstruction = obstruction;
    if (this.state) this.render(this.state);
  }

  availableArea() {
    const height = Math.max(0, ...(this.state?.portraits.filter((item) => item.visible).map((item) => item.height) ?? [500]));
    return portraitArea(window.innerWidth, window.innerHeight, this.state?.bottom ?? 80, height, this.obstruction);
  }

  create(portrait) {
    const element = document.createElement("figure");
    element.className = "fxp-portrait";
    element.innerHTML = `<div class="fxp-media"><div class="fxp-art"><img alt="${escapeHtml(portrait.showName ? portrait.name : "Портрет персонажа")}" draggable="false"><canvas aria-hidden="true"></canvas></div><div class="fxp-name"></div></div>`;
    const card = {
      element, media: element.querySelector(".fxp-media"), art: element.querySelector(".fxp-art"), image: element.querySelector("img"),
      canvas: element.querySelector("canvas"), label: element.querySelector(".fxp-name"),
      src: portrait.src, portrait, runtime: null, pending: null, size: "", signature: "", disposed: false,
    };
    card.image.onload = () => {
      if (!card.disposed) this.update(card, this.cards.size);
    };
    card.image.onerror = () => {
      if (card.disposed) return;
      if (card.portrait.showName) card.label.textContent = `${card.portrait.name} — изображение недоступно`;
      card.element.classList.add("fxp-load-error");
    };
    card.image.src = portrait.src;
    return card;
  }

  update(card, count) {
    const ratio = card.image.naturalWidth / card.image.naturalHeight;
    const maxHeight = Math.max(1, window.innerHeight - (this.state?.bottom ?? 80) - 24);
    const height = Math.max(1, Math.round(Math.min(card.portrait.height, maxHeight, window.innerWidth / ratio)));
    const width = Math.max(1, Math.round(height * ratio));
    const area = this.availableArea();
    // Keep rendering resolution stable when Foundry's sidebar changes. Only
    // CSS display size changes, so the sidebar does not rebuild FX runtimes.
    // Fit the default 500px portrait into its slot. Manual size is then scaled
    // relative to that stable reference, rather than capped at the slot width.
    // Thus increasing height remains visible beside an expanded sidebar.
    const referenceWidth = Math.min(500, maxHeight) * ratio;
    const requestedWidth = card.portrait.height * ratio;
    const scale = Math.min(1, Math.max(1, area.width / Math.max(1, count) - 32) / referenceWidth,
      maxHeight / card.portrait.height, Math.max(1, area.width - 32) / requestedWidth);
    const displayWidth = requestedWidth * scale;
    card.media.style.width = `${displayWidth}px`;
    card.media.style.height = `${card.portrait.height * scale}px`;
    if (card.element) card.element.style.width = `${displayWidth}px`;
    if (card.element && this.drag?.id !== card.portrait.id) {
      const group = this.state?.portraits.filter((item) => item.visible) ?? [card.portrait];
      const index = Math.max(0, group.findIndex((item) => item.id === card.portrait.id));
      card.element.style.left = `${screenX(card.portrait, index, count, displayWidth, window.innerWidth, area)}%`;
    }
    if (typeof this.runtimeFactory !== "function") {
      this.stopRuntime(card);
      return;
    }
    const filters = runtimeState(card.portrait.filter, registry("filter"));
    const particles = runtimeState(card.portrait.particle, registry("particle"));
    let tokenmagic;
    try { tokenmagic = tokenMagicRuntimeState(card.portrait.tokenmagic); }
    catch (error) {
      const signature = JSON.stringify(card.portrait.tokenmagic);
      if (card.failedTokenMagic !== signature) this.reportError(`Не удалось прочитать эффекты TokenMagic для «${card.portrait.name}».`, error);
      card.failedTokenMagic = signature;
      return;
    }
    card.failedTokenMagic = null;
    const active = Object.keys(filters.enabled).length + Object.keys(particles.enabled).length + Object.keys(tokenmagic.enabled).length > 0;
    if (!active) {
      this.stopRuntime(card);
      return;
    }
    const size = `${width}x${height}`;
    const signature = JSON.stringify({ filters, particles, tokenmagic });
    const key = `${size}:${signature}`;
    if (card.pending?.key === key) return;
    this.cancelPending(card);
    if (card.runtime && card.size === size && card.signature === signature) return;
    if (card.failedSignature === key) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.hidden = true;
    (card.art ?? card.media).append(canvas);
    const pending = { canvas, runtime: null, key, signature, size, frame: null, started: performance.now(), rendered: false };
    card.pending = pending;
    try {
      pending.runtime = this.runtimeFactory({
        canvas, width, height, resolution: 1, media: card.image,
        tokenMagic: Object.keys(tokenmagic.enabled).length > 0,
        onRuntimeError: (error) => {
          if (card.disposed) return;
          if (card.pending === pending) this.failRuntime(card, pending, error);
          else if (card.runtime === pending.runtime) this.reportError(`Анимация TokenMagic для «${card.portrait.name}» остановлена из-за ошибки.`, error);
        },
        onFilterExpired: (effectId, kind = "filter") => {
          if (card.disposed) return;
          const current = card.runtime === pending.runtime && !card.pending;
          if (!current && card.pending !== pending) return;
          if (current) card.image.style.visibility = card.runtime.hasActiveFilters() ? "hidden" : "";
          if (kind === "filter") this.onFilterExpired?.(card.portrait.id, effectId);
          else this.onFilterExpired?.(card.portrait.id, effectId, kind);
        },
      });
      pending.runtime.sync(particles);
      pending.runtime.syncFilters(filters);
      if (Object.keys(tokenmagic.enabled).length) {
        if (!pending.runtime.syncTokenMagic) throw new Error("TokenMagic недоступен в обработчике портрета.");
        pending.runtime.syncTokenMagic(tokenmagic);
      }
      const prepare = () => {
        if (card.disposed || card.pending !== pending) return;
        try {
          if (performance.now() - pending.started > 30000) throw new Error("FXMaster+ frame preparation timed out");
          if (frameReady(pending.runtime)) {
            // Give the browser a frame to finish GPU work before revealing the
            // replacement. Until then the original/live previous canvas stays.
            if (pending.rendered) { this.commitRuntime(card, pending); return; }
            pending.rendered = true;
          } else pending.rendered = false;
          pending.frame = requestAnimationFrame(prepare);
        } catch (error) { this.failRuntime(card, pending, error); }
      };
      pending.frame = requestAnimationFrame(prepare);
    } catch (error) {
      this.failRuntime(card, pending, error);
    }
  }

  commitRuntime(card, pending) {
    const previous = card.runtime;
    const previousCanvas = card.canvas;
    card.pending = null;
    card.runtime = pending.runtime;
    card.canvas = pending.canvas;
    card.size = pending.size;
    card.signature = pending.signature;
    card.failedSignature = null;
    card.canvas.hidden = false;
    card.image.style.visibility = card.runtime.hasActiveFilters() ? "hidden" : "";
    this.destroyRuntime(previous);
    previousCanvas.remove();
  }

  failRuntime(card, pending, error) {
    if (card.pending !== pending) return;
    this.cancelPending(card);
    if (!card.runtime) card.image.style.visibility = "";
    card.failedSignature = pending.key;
    this.reportError(`Не удалось применить эффекты к «${card.portrait.name}». Предыдущее изображение сохранено.`, error);
  }

  destroyRuntime(runtime) {
    try { runtime?.destroy(); } catch (error) { console.warn("FX Portraits | Cleanup failed", error); }
  }

  cancelPending(card) {
    const pending = card.pending;
    if (!pending) return;
    card.pending = null;
    if (pending.frame !== null) cancelAnimationFrame(pending.frame);
    this.destroyRuntime(pending.runtime);
    pending.canvas.remove();
  }

  stopRuntime(card) {
    this.cancelPending(card);
    if (card.runtime) {
      this.destroyRuntime(card.runtime);
      // FXMaster+ destroys its PIXI view with removeView=true. Always create a
      // fresh canvas, otherwise re-enabling filters would hide the image while
      // rendering into a detached/destroyed WebGL view.
      card.canvas.remove();
      card.canvas = document.createElement("canvas");
      card.canvas.setAttribute("aria-hidden", "true");
      (card.art ?? card.media).append(card.canvas);
    }
    card.runtime = null;
    card.signature = "";
    card.size = "";
    card.failedSignature = null;
    card.image.style.visibility = "";
    card.canvas.hidden = true;
  }

  release(card) {
    if (this.drag?.id === card.portrait.id) this.endDrag({ pointerId: this.drag.pointerId }, true);
    card.disposed = true;
    card.image.onload = null;
    card.image.onerror = null;
    this.stopRuntime(card);
    card.element.remove();
  }

  startDrag(event) {
    if (!this.canMove() || event.button !== 0) return;
    const element = event.target.closest(".fxp-portrait");
    const card = this.cards.get(element?.dataset.portraitId);
    if (!card) return;
    const rect = element.getBoundingClientRect();
    const area = this.availableArea();
    const center = rect.left + rect.width / 2;
    this.drag = {
      id: card.portrait.id, pointerId: event.pointerId, startPointer: event.clientX,
      startCenter: center, area,
      startX: localX(center, rect.width, area),
      width: rect.width, x: localX(center, rect.width, area),
      moved: false,
    };
  }

  moveDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const card = this.cards.get(this.drag.id);
    if (!card) return;
    if (!this.drag.moved) {
      if (Math.abs(event.clientX - this.drag.startPointer) < 3) return;
      this.drag.moved = true;
      this.element.setPointerCapture(event.pointerId);
      card.element.classList.add("is-dragging");
    }
    const center = this.drag.startCenter + event.clientX - this.drag.startPointer;
    this.drag.x = localX(center, this.drag.width, this.drag.area);
    card.element.style.left = `${screenX({ x: this.drag.x }, 0, 1, this.drag.width, window.innerWidth, this.drag.area)}%`;
  }

  endDrag(event, cancelled = false) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    const card = this.cards.get(drag.id);
    card?.element.classList.remove("is-dragging");
    if (this.element.hasPointerCapture(drag.pointerId)) this.element.releasePointerCapture(drag.pointerId);
    if (!cancelled && drag.moved && Math.abs(drag.x - drag.startX) > 0.01) {
      this.onPositionChange?.(drag.id, drag.x);
    } else if (card) {
      card.element.style.left = `${screenX({ x: drag.startX }, 0, 1, drag.width, window.innerWidth, drag.area)}%`;
    }
  }

  openPortrait(event) {
    if (!this.canOpenPortrait()) return;
    const id = event.target.closest(".fxp-portrait")?.dataset.portraitId;
    if (!this.cards.has(id)) return;
    event.preventDefault();
    this.onOpenPortrait?.(id);
  }

  destroy() {
    clearTimeout(this.resizeTimer);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointerup", this.onPointerUp);
    for (const card of this.cards.values()) this.release(card);
    this.cards.clear();
    this.element.remove();
  }
}
