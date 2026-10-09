import {
  KINDS, OMITTED_PARAMETERS, CONTROL_TYPES, registry, localize, definitions,
  defaultValues, parameterValue, isParameterVisible, escapeHtml as e, newPortrait, clone,
} from "./model.js";
import { panelPosition, panelSize, portraitNeighbor } from "./layout.js";
import { tokenMagicApi, tokenMagicDescriptor, tokenMagicEditedParams, selectedTokenMagicParams, COPIED_TOKEN } from "./tokenmagic-data.js";
import { importTokenMagicMacro } from "./tokenmagic-macros.js";
import { HEIGHT_PRESETS, normalizeHeightPresets } from "./height-presets.js";
import { rosterInsertionIndex } from "./roster-layout.js";
import { ActorPicker, PICKER_ICON } from "./actor-picker.js";

function choices(definition) {
  let source = definition.choices ?? definition.options ?? {};
  if (typeof source === "function") {
    try { source = source(); } catch { source = {}; }
  }
  if (Array.isArray(source)) {
    return source.map((item) => typeof item === "object"
      ? [item.value ?? item.id, item.label ?? item.name ?? item.value ?? item.id]
      : [item, item]);
  }
  return Object.entries(source ?? {}).map(([value, label]) => [value, label?.label ?? label]);
}

function optionMarkup(definition, value) {
  const selected = new Set((Array.isArray(value) ? value : [value]).map(String));
  return choices(definition).map(([key, label]) =>
    `<option value="${e(key)}" ${selected.has(String(key)) ? "selected" : ""}>${e(localize(label))}</option>`).join("");
}

function inputMarkup(key, definition, value) {
  const name = `name="${e(key)}"`;
  if (["checkbox", "boolean"].includes(definition.type)) {
    return `<input type="checkbox" ${name} ${value ? "checked" : ""}>`;
  }
  if (definition.type === "color") {
    const color = /^#[0-9a-f]{6}$/i.test(value.value) ? value.value : "#ffffff";
    return `<span class="fxp-color"><input type="color" ${name} value="${e(color)}">${definition.tokenMagic ? "" : `<label><input type="checkbox" data-color-apply="${e(key)}" ${value.apply ? "checked" : ""}>Применять</label>`}</span>`;
  }
  if (["range", "number"].includes(definition.type)) {
    const bounds = ["min", "max", "step"].filter((item) => definition[item] !== undefined)
      .map((item) => `${item}="${e(definition[item])}"`).join(" ");
    const step = definition.step === undefined ? 'step="any"' : "";
    const number = `<input type="number" ${name} value="${e(value)}" ${bounds} ${step}>`;
    return definition.type === "range"
      ? `<span class="fxp-range"><input type="range" data-range="${e(key)}" value="${e(value)}" ${bounds}>${number}</span>` : number;
  }
  if (["select", "multi-select"].includes(definition.type)) {
    return `<select ${name} ${definition.type === "multi-select" ? "multiple" : ""}>${optionMarkup(definition, value)}</select>`;
  }
  return `<input type="text" ${name} value="${e(value)}">`;
}

export class PortraitPanel {
  constructor(store, { readPosition = () => null, savePosition = () => {}, readSize = () => null, saveSize = () => {}, getPortraitHeight = () => null, readHeightPresets = () => ({}), onAppearancePreview = () => {}, favorites = null, categories = null, preview = null, saveMacro = null, importMacro = importTokenMagicMacro, effectsAvailable = true } = {}) {
    this.store = store;
    this.effectsAvailable = effectsAvailable;
    this.selectedId = null;
    this.kind = "filter";
    this.selectedEffects = { filter: "", particle: "", tokenmagic: "" };
    this.element = null;
    this.addName = true;
    this.addHidden = false;
    this.readHeightPresets = readHeightPresets;
    this.addHeightPreset = "normal";
    this.addHeight = normalizeHeightPresets(readHeightPresets()).normal;
    this.selectedActorId = "";
    this.actorSearch = "";
    this.favorites = favorites;
    this.picker = categories ? new ActorPicker({ panel: this, categories }) : null;
    this.preview = preview;
    this.saveMacro = saveMacro;
    this.importMacro = importMacro;
    this.macroOpen = false;
    this.macroName = "";
    this.macroSource = "";
    this.macroBusy = false;
    this.macroError = "";
    this.actorOrder = null;
    this.collapsed = false;
    this.appearanceOpen = false;
    this.effectsOpen = false;
    this.rosterDragId = null;
    this.appearanceDrafts = new Map();
    this.appearanceEdits = new Map();
    this.appearanceTimer = null;
    this.onAppearancePreview = onAppearancePreview;
    this.renamingId = null;
    this.renameValue = "";
    this.position = readPosition();
    this.savePosition = savePosition;
    this.size = readSize();
    this.saveSize = saveSize;
    this.getPortraitHeight = getPortraitHeight;
    this.resizing = null;
    this.drag = null;
    this.liveEdit = null;
    this.liveTimer = null;
    this.renderedParameterContext = "";
    this.renderedStructure = "";
    this.onResize = () => this.applyPosition();
  }

  toggle() {
    if (!game.user.isGM) return;
    if (this.element) this.close();
    else this.open();
  }

  openPortrait(id) {
    if (!game.user.isGM || !this.store.state.portraits.some((portrait) => portrait.id === id)) return;
    this.flushLiveEffect();
    this.flushAppearance();
    this.selectedId = id;
    this.collapsed = false;
    this.renamingId = null;
    this.open();
    this.element.querySelector(".fxp-panel-body").scrollTop = 0;
  }

  open() {
    if (!game.user.isGM) return;
    if (!this.element) {
      this.element = document.createElement("section");
      this.element.id = "fx-portraits-panel";
      this.element.setAttribute("aria-label", "Управление портретами");
      this.element.addEventListener("click", (event) => this.onClick(event));
      this.element.addEventListener("contextmenu", (event) => this.onContextMenu(event));
      this.element.addEventListener("dblclick", (event) => this.onDoubleClick(event));
      this.element.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.rosterPointer?.moved) {
          event.preventDefault(); this.endDrag({ pointerId: this.rosterPointer.pointerId }, true); return;
        }
        if (this.onActorKeyDown(event)) return;
        if (event.target.matches(".fxp-resize-handle") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const rect = this.element.getBoundingClientRect();
          this.size = { width: rect.width + (event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0), height: rect.height + (event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0) };
          this.applyPosition(); this.persistSize(); return;
        }
        if (event.target.matches(".fxp-panel-header") && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          this.toggleCollapsed();
        }
      });
      this.element.addEventListener("change", (event) => this.onChange(event));
      this.element.addEventListener("input", (event) => this.onInput(event));
      this.element.addEventListener("submit", (event) => {
        event.preventDefault();
        if (event.target.dataset.role === "rename") this.saveName();
        if (event.target.dataset.role === "macro") this.run(this.saveMacroDraft());
      });
      this.element.addEventListener("pointerdown", (event) => this.startDrag(event));
      this.element.addEventListener("pointermove", (event) => this.moveDrag(event));
      this.element.addEventListener("pointerup", (event) => this.endDrag(event));
      this.element.addEventListener("pointercancel", (event) => this.endDrag(event, true));
      document.body.append(this.element);
      window.addEventListener("resize", this.onResize);
    }
    this.render();
  }

  close() {
    this.flushLiveEffect();
    this.flushAppearance();
    this.drag = null;
    this.rosterDropPending = false;
    this.clearRosterDrag();
    this.resizing = null;
    window.removeEventListener("resize", this.onResize);
    this.element?.remove();
    this.element = null;
    this.renamingId = null;
    this.actorOrder = null;
    this.actorSearch = "";
    this.appearanceOpen = false;
    this.effectsOpen = false;
    this.macroOpen = false;
  }

  render() {
    this.picker?.refreshPortraits();
    if (!this.element) return;
    // A pending effect save must not detach the name currently being dragged.
    if (this.rosterDragId) { this.rosterRenderPending = true; return; }
    const current = this.currentPortrait();
    if (current && this.renderedAppearanceStructure === this.appearanceStructure()
      && this.element.contains(document.activeElement) && document.activeElement.closest('[data-role="appearance"]')) {
      this.updateHeightHint();
      return;
    }
    const structure = JSON.stringify({ bottom: this.store.state.bottom, preview: this.preview?.id, portraits: this.store.state.portraits.map(({ filter, particle, ...portrait }) => portrait) });
    if (current && this.renderedStructure === structure && this.renderedParameterContext === this.parameterContext()
      && this.element.contains(document.activeElement) && document.activeElement.closest('[data-role="parameters"]')) {
      // A save must not replace a slider under the pointer or interrupt typing.
      this.updateEffectStatus(current);
      this.updateHeightHint();
      return;
    }
    const scroll = this.element.querySelector(".fxp-panel-body")?.scrollTop ?? 0;
    const searchFocused = document.activeElement?.dataset?.role === "actor-search" && this.element.contains(document.activeElement);
    const searchCursor = searchFocused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const focusedActor = this.element.contains(document.activeElement) ? document.activeElement?.closest('.fxp-actor-options [data-actor-id]') : null;
    const actorFocus = focusedActor ? { id: focusedActor.dataset.actorId, action: focusedActor.dataset.action } : null;
    const actorScroll = this.element.querySelector(".fxp-actor-options")?.scrollTop ?? 0;
    const state = this.store.state;
    if (!state.portraits.some((item) => item.id === this.selectedId)) this.selectedId = state.portraits[0]?.id ?? null;
    const portrait = state.portraits.find((item) => item.id === this.selectedId);
    if (this.renamingId !== this.selectedId) this.renamingId = null;
    const actors = this.actorsForPicker(game.actors?.contents ?? []);
    this.element.innerHTML = `
      <header class="fxp-panel-header" tabindex="0" title="Перетащи меню за заголовок. Двойной клик — свернуть/развернуть"><strong><i class="fas fa-images"></i> Sano’s Portrait FX</strong><button type="button" data-action="close" aria-label="Закрыть" title="Закрыть">×</button></header>
      <div class="fxp-panel-body" ${this.collapsed ? "hidden" : ""}>
        <div class="fxp-actor-list"><div class="fxp-actor-search-row"><input type="search" class="fxp-actor-search" data-role="actor-search" aria-label="Поиск персонажей" aria-controls="fxp-actor-options" placeholder="Поиск по имени…" autocomplete="off" value="${e(this.actorSearch)}"><button type="button" data-action="open-picker" aria-label="Открыть окно выбора персонажей" title="Выбор персонажей">${PICKER_ICON}</button></div><div id="fxp-actor-options" class="fxp-actor-options" role="listbox" aria-label="Персонажи">${this.actorOptionsMarkup(actors)}</div></div>
        <div class="fxp-add-options"><label class="fxp-add-name"><input type="checkbox" data-role="add-name" ${this.addName ? "checked" : ""}>Добавлять с именем</label><label class="fxp-add-name"><input type="checkbox" data-role="add-hidden" ${this.addHidden ? "checked" : ""}>Добавлять скрытым</label>${this.addHeightMarkup()}</div>
        <div class="fxp-global"><button type="button" data-action="hide-all">Скрыть все</button><button type="button" data-action="show-all">Показать все</button><label>Снизу <input type="number" data-role="bottom" min="0" max="450" step="10" value="${state.bottom}"> px</label></div>
        <button type="button" class="fxp-arrange" data-action="arrange" title="Сбросить ручное положение показанных портретов">Распределить равномерно</button>
        <div class="fxp-roster" aria-label="Список портретов">${state.portraits.map((item) => `
          <button type="button" data-action="select" data-id="${e(item.id)}" title="Перетащи имя — изменить порядок. Двойной клик — скрыть/показать. Правый клик — убрать портрет" class="${item.id === this.selectedId ? "is-selected" : ""}" aria-pressed="${item.id === this.selectedId}"><span>${item.visible ? "●" : "○"}</span> ${e(item.name)}</button>`).join("") || '<p class="fxp-empty">Добавь персонажа, чтобы показать его портрет игрокам.</p>'}</div>
        <div class="fxp-editor">${portrait ? this.portraitMarkup(portrait) : ""}</div>
      </div><footer class="fxp-panel-footer" ${this.collapsed ? "hidden" : ""}><button type="button" class="fxp-resize-handle" aria-label="Изменить размер окна" title="Потяни угол. Двойной клик — стандартный размер">↘</button></footer>`;
    this.element.classList.toggle("is-collapsed", this.collapsed);
    this.renderedParameterContext = this.parameterContext();
    this.renderedStructure = structure;
    this.renderedAppearanceStructure = this.appearanceStructure();
    this.refreshConditions();
    this.element.querySelector(".fxp-panel-body").scrollTop = scroll;
    this.applyPosition();
    this.element.querySelector(".fxp-actor-options").scrollTop = actorScroll;
    if (searchFocused) {
      const input = this.element.querySelector('[data-role="actor-search"]');
      input.focus(); input.setSelectionRange(...searchCursor);
    } else if (actorFocus) {
      [...this.element.querySelectorAll('.fxp-actor-options [data-actor-id]')]
        .find((button) => button.dataset.actorId === actorFocus.id && button.dataset.action === actorFocus.action)?.focus();
    }
  }

  addHeightMarkup() {
    const presets = normalizeHeightPresets(this.readHeightPresets());
    if (this.addHeightPreset !== "custom") this.addHeight = presets[this.addHeightPreset];
    return `<label class="fxp-add-height">Размер<select data-role="add-height-preset" aria-label="Размер при добавлении">${HEIGHT_PRESETS.map(({ id, label }) => `<option value="${id}" ${this.addHeightPreset === id ? "selected" : ""}>${label} (${presets[id]})</option>`).join("")}<option value="custom" ${this.addHeightPreset === "custom" ? "selected" : ""}>Свой</option></select></label><label class="fxp-add-height" data-role="custom-height" ${this.addHeightPreset === "custom" ? "" : "hidden"}>Высота, px<input type="number" data-role="add-height" aria-label="Своя высота при добавлении, px" min="100" max="700" step="1" value="${e(this.addHeight)}"></label>`;
  }

  startRosterDrag(event, button = event.target.closest('.fxp-roster [data-action="select"]')) {
    if (!game.user.isGM || !button || !this.element.contains(button)) return;
    this.flushLiveEffect();
    this.rosterDragId = button.dataset.id;
    this.rosterPreviewOrder = [...this.element.querySelectorAll('.fxp-roster [data-action="select"]')].map((item) => item.dataset.id);
    button.classList.add("is-roster-dragging");
    this.captureRosterLayout();
  }

  rosterDropTarget(event) {
    const roster = this.element?.querySelector(".fxp-roster");
    if (!game.user.isGM || !this.rosterDragId || !roster || !this.rosterBoxes) return null;
    const rect = roster.getBoundingClientRect();
    const x = event.clientX, y = event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < rect.left - 8 || x > rect.right + 8
      || y < rect.top - 8 || y > rect.bottom + 8) return null;
    const dx = rect.left - this.rosterOrigin.left, dy = rect.top - this.rosterOrigin.top;
    const boxes = this.rosterBoxes.map((box) => ({ ...box,
      left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy,
    }));
    const source = boxes.find((box) => box.id === this.rosterDragId);
    const ids = this.rosterPreviewOrder.filter((id) => id !== this.rosterDragId);
    const inPlaceholder = source && x >= source.left && x <= source.right && y >= source.top && y <= source.bottom;
    const index = inPlaceholder ? this.rosterPreviewOrder.indexOf(this.rosterDragId)
      : rosterInsertionIndex(ids.map((id) => boxes.find((box) => box.id === id)), x, y);
    const order = [...ids]; order.splice(index, 0, this.rosterDragId);
    return { order, targetId: ids[index] ?? ids.at(-1), after: index === ids.length };
  }

  overRosterDrag(event) {
    const target = this.rosterDropTarget(event);
    if (!target) return;
    event.preventDefault();
    this.previewRosterOrder(target.order);
  }

  dropRosterDrag(event) {
    const target = this.rosterDropTarget(event);
    if (target) {
      event.preventDefault();
      if (target.targetId) {
        this.rosterDropPending = true;
        const finish = () => { this.rosterDropPending = false; this.clearRosterDrag(); };
        this.run(this.store.reorderPortrait(this.rosterDragId, target.targetId, target.after).then(finish, finish));
        return;
      }
    }
    this.clearRosterDrag();
  }

  captureRosterLayout() {
    const roster = this.element.querySelector(".fxp-roster");
    this.rosterOrigin = roster.getBoundingClientRect();
    this.rosterBoxes = [...roster.querySelectorAll('[data-action="select"]')].map((button) => {
      const { left, right, top, bottom } = button.getBoundingClientRect();
      return { id: button.dataset.id, left, right, top, bottom };
    });
  }

  previewRosterOrder(order) {
    if (order.every((id, i) => id === this.rosterPreviewOrder[i])) return;
    const buttons = [...this.element.querySelectorAll('.fxp-roster [data-action="select"]')];
    const before = new Map(buttons.map((button) => [button.dataset.id, button.getBoundingClientRect()]));
    for (const button of buttons) {
      for (const animation of button.getAnimations?.() ?? []) animation.cancel();
      button.style.order = String(order.indexOf(button.dataset.id));
    }
    this.rosterPreviewOrder = order;
    this.captureRosterLayout();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const button of buttons) {
      if (button.dataset.id === this.rosterDragId) continue;
      const old = before.get(button.dataset.id), next = button.getBoundingClientRect();
      const dx = old.left - next.left, dy = old.top - next.top;
      if (dx || dy) button.animate?.([
        { transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" },
      ], { duration: 140, easing: "ease-out" });
    }
  }

  clearRosterDrag() {
    this.rosterGhost?.remove(); this.rosterGhost = null;
    this.rosterPointer = null;
    this.rosterDragId = null;
    this.rosterPreviewOrder = null;
    this.rosterBoxes = null;
    for (const button of this.element?.querySelectorAll?.('.fxp-roster [data-action="select"]') ?? []) {
      button.style.order = "";
      for (const animation of button.getAnimations?.() ?? []) animation.cancel();
      button.classList.remove("is-roster-dragging");
    }
    if (this.rosterRenderPending) { this.rosterRenderPending = false; this.render(); }
  }

  onActorKeyDown(event) {
    if (!event.target.closest(".fxp-actor-options, .fxp-actor-search") || !["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return false;
    event.preventDefault();
    if (event.key === "Escape") { this.element.querySelector('[data-role="actor-search"]')?.focus(); return true; }
    const options = [...this.element.querySelectorAll('[data-action="choose-actor"]')];
    const actorId = event.target.closest('[data-actor-id]')?.dataset.actorId;
    const index = options.findIndex((option) => option.dataset.actorId === actorId);
    const next = index < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
    return true;
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    this.element.classList.toggle("is-collapsed", this.collapsed);
    this.element.querySelector(".fxp-panel-body").hidden = this.collapsed;
    this.element.querySelector(".fxp-panel-footer").hidden = this.collapsed;
    this.applyPosition();
  }

  actorsForPicker(actors) {
    const favorites = new Set(this.favorites?.state ?? []);
    const sorted = [...actors].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || a.name.localeCompare(b.name));
    // Keep the list stable while this menu is open; close() resets the order.
    if (!this.actorOrder) this.actorOrder = sorted.map((actor) => actor.id);
    const order = new Map(this.actorOrder.map((id, index) => [id, index]));
    return sorted.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }

  actorOptionsMarkup(actors) {
    const query = this.actorSearch.trim().toLocaleLowerCase();
    const filtered = actors.filter((actor) => actor.name.toLocaleLowerCase().includes(query));
    return filtered.map((actor) => this.actorOptionMarkup(actor)).join("")
      || `<p class="fxp-empty">${query ? "Персонажи не найдены." : "Нет доступных персонажей."}</p>`;
  }

  updateActorOptions() {
    const list = this.element?.querySelector("#fxp-actor-options");
    if (list) list.innerHTML = this.actorOptionsMarkup(this.actorsForPicker(game.actors?.contents ?? []));
  }

  selectPortrait(id) {
    if (!this.store.state.portraits.some((portrait) => portrait.id === id) || this.selectedId === id) return;
    this.flushAppearance();
    this.selectedId = id;
    this.renamingId = null;
    const editor = this.element?.querySelector(".fxp-editor");
    if (!editor || !this.element.querySelectorAll) { this.render(); return; }
    // Keep roster buttons attached: replacing the first click's target prevents
    // the browser from recognizing a double click on an unselected portrait.
    for (const button of this.element.querySelectorAll('[data-action="select"]')) {
      const selected = button.dataset.id === id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    editor.innerHTML = this.portraitMarkup(this.currentPortrait());
    this.renderedParameterContext = this.parameterContext();
    this.renderedAppearanceStructure = this.appearanceStructure();
    this.refreshConditions(); this.updateHeightHint(); this.applyPosition();
  }

  onDoubleClick(event) {
    if (!game.user.isGM) return;
    if (event.target.closest(".fxp-resize-handle")) { this.size = null; this.applyPosition(); this.persistSize(); return; }
    if (event.target.closest(".fxp-panel-header") && !event.target.closest("button")) { this.toggleCollapsed(); return; }
    const button = event.target.closest('.fxp-roster [data-action="select"]');
    if (!button || !this.element.contains(button) || !this.store.state.portraits.some((portrait) => portrait.id === button.dataset.id)) return;
    event.preventDefault();
    this.flushLiveEffect();
    this.run(this.store.editPortrait(button.dataset.id, (portrait) => { portrait.visible = !portrait.visible; }));
  }

  actorOptionMarkup(actor) {
    const favorite = this.favorites?.state.includes(actor.id) ?? false;
    const label = `${favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${actor.name}`;
    return `<div class="fxp-actor-row" role="presentation"><button type="button" class="fxp-favorite ${favorite ? "is-favorite" : ""}" data-action="favorite" data-actor-id="${e(actor.id)}" aria-pressed="${favorite}" aria-label="${e(label)}" title="${e(label)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2.8 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z"/></svg></button><button type="button" class="fxp-actor-option" role="option" tabindex="-1" title="Добавить персонажа" aria-selected="${actor.id === this.selectedActorId}" data-action="choose-actor" data-actor-id="${e(actor.id)}"><img src="${e(actor.img)}" alt="" loading="lazy" draggable="false"><span class="fxp-actor-name">${e(actor.name)}</span></button></div>`;
  }

  updateFavoriteButtons() {
    this.picker?.updateFavorites();
    for (const button of this.element?.querySelectorAll('[data-action="favorite"]') ?? []) {
      const favorite = this.favorites?.state.includes(button.dataset.actorId) ?? false;
      const actor = game.actors?.get(button.dataset.actorId);
      const label = `${favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${actor?.name ?? "Персонаж"}`;
      button.classList.toggle("is-favorite", favorite);
      button.setAttribute("aria-pressed", String(favorite));
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  }

  applyPosition() {
    if (!this.element) return;
    const requestedSize = panelSize(this.size, window.innerWidth, window.innerHeight - 16);
    this.element.style.width = `${requestedSize.width}px`;
    this.element.style.height = this.collapsed || requestedSize.height === null ? "auto" : `${requestedSize.height}px`;
    const rect = this.element.getBoundingClientRect();
    const requested = this.position?.left !== undefined && this.position?.top !== undefined
      ? this.position : { left: rect.left, top: rect.top };
    this.position = panelPosition(requested, rect.width, window.innerWidth, window.innerHeight);
    this.element.style.left = `${this.position.left}px`;
    this.element.style.top = `${this.position.top}px`;
    this.element.style.right = "auto";
    this.element.style.maxHeight = `${Math.max(100, window.innerHeight - this.position.top - 8)}px`;
    const displayedSize = panelSize(requestedSize, window.innerWidth, window.innerHeight - this.position.top - 8);
    if (!this.collapsed && displayedSize.height !== null) this.element.style.height = `${displayedSize.height}px`;
    this.updateHeightHint();
  }

  updateHeightHint() {
    const info = this.element?.querySelector('[data-role="actual-height"]');
    const height = this.getPortraitHeight(this.selectedId);
    if (info) info.textContent = height === null ? "" : `На этом экране: ${Math.round(height)} px`;
  }

  persistSize() {
    Promise.resolve(this.saveSize(this.size)).then(() => this.savePosition({ ...this.position }))
      .catch((error) => console.warn("FX Portraits | Menu size could not be saved", error));
  }

  startDrag(event) {
    const rosterButton = event.target.closest('.fxp-roster [data-action="select"]');
    if (event.button === 0 && game.user.isGM && rosterButton) {
      if (this.rosterDropPending) return;
      const rect = rosterButton.getBoundingClientRect();
      this.rosterPointer = { pointerId: event.pointerId, button: rosterButton,
        x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top, width: rect.width, height: rect.height, moved: false };
      return;
    }
    if (event.button === 0 && event.target.closest(".fxp-resize-handle")) {
      const rect = this.element.getBoundingClientRect();
      this.resizing = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, size: this.size, position: { ...this.position }, moved: false };
      return;
    }
    if (event.button !== 0 || !event.target.closest(".fxp-panel-header") || event.target.closest("button")) return;
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, position: { ...this.position }, moved: false };
  }

  moveDrag(event) {
    const pointer = this.rosterPointer;
    if (pointer?.pointerId === event.pointerId) {
      if (event.buttons === 0) { this.endDrag(event, true); return; }
      if (!pointer.moved) {
        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 5) return;
        pointer.moved = true;
        this.startRosterDrag(event, pointer.button);
        this.element.setPointerCapture(event.pointerId);
        this.rosterGhost = pointer.button.cloneNode(true);
        this.rosterGhost.className = "fxp-roster-ghost";
        this.rosterGhost.setAttribute("aria-hidden", "true"); this.rosterGhost.tabIndex = -1;
        this.rosterGhost.style.width = `${pointer.width}px`;
        this.rosterGhost.style.height = `${pointer.height}px`;
        document.body.append(this.rosterGhost);
      }
      this.rosterGhost.style.left = `${event.clientX - pointer.offsetX}px`;
      this.rosterGhost.style.top = `${event.clientY - pointer.offsetY}px`;
      this.overRosterDrag(event);
      return;
    }
    if (this.resizing?.pointerId === event.pointerId) {
      const resize = this.resizing;
      if (!resize.moved) {
        if (Math.hypot(event.clientX - resize.x, event.clientY - resize.y) < 3) return;
        resize.moved = true;
        this.element.setPointerCapture(event.pointerId);
        this.element.classList.add("is-resizing");
      }
      this.size = panelSize({ width: resize.width + event.clientX - resize.x, height: resize.height + event.clientY - resize.y }, window.innerWidth, window.innerHeight - this.position.top - 8);
      this.applyPosition(); return;
    }
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (!this.drag.moved) {
      if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) < 3) return;
      // Capture only real drags: immediate capture retargets the subsequent
      // clicks to the panel and prevents header double-clicks from reaching it.
      this.drag.moved = true;
      this.element.setPointerCapture(event.pointerId);
      this.element.classList.add("is-dragging");
    }
    this.position = {
      left: this.drag.position.left + event.clientX - this.drag.x,
      top: this.drag.position.top + event.clientY - this.drag.y,
    };
    this.applyPosition();
  }

  endDrag(event, cancelled = false) {
    if (this.rosterPointer?.pointerId === event.pointerId) {
      const moved = this.rosterPointer.moved;
      this.rosterPointer = null;
      if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
      if (moved) {
        this.suppressRosterClick = true;
        setTimeout(() => { this.suppressRosterClick = false; }, 0);
        if (cancelled) this.clearRosterDrag(); else this.dropRosterDrag(event);
      }
      return;
    }
    if (this.resizing?.pointerId === event.pointerId) {
      const resize = this.resizing;
      this.resizing = null;
      this.element.classList.remove("is-resizing");
      if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
      if (!resize.moved) return;
      if (cancelled) { this.size = resize.size; this.position = resize.position; this.applyPosition(); }
      else this.persistSize();
      return;
    }
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    this.element.classList.remove("is-dragging");
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    if (!drag.moved) return;
    if (cancelled) {
      this.position = drag.position;
      this.applyPosition();
    } else {
      Promise.resolve(this.savePosition({ ...this.position })).catch((error) => console.warn("FX Portraits | Menu position could not be saved", error));
    }
  }

  portraitMarkup(portrait) {
    const appearance = this.appearanceDrafts.get(portrait.id) ?? portrait;
    const effects = Object.entries(this.effectRegistry()).sort((a, b) => localize(a[1].label ?? a[0]).localeCompare(localize(b[1].label ?? b[0])));
    if (!effects.some(([id]) => id === this.selectedEffects[this.kind])) {
      this.selectedEffects[this.kind] = effects.find(([id]) => portrait[this.kind].enabled[id])?.[0] ?? effects[0]?.[0] ?? "";
    }
    const effectId = this.selectedEffects[this.kind];
    const EffectClass = this.effectDefinition();
    const values = defaultValues(EffectClass, portrait[this.kind].options[effectId]);
    const active = !!portrait[this.kind].enabled[effectId];
    const rows = Object.entries(definitions(EffectClass)).filter(([key, def]) =>
      def && CONTROL_TYPES.has(def.type) && !OMITTED_PARAMETERS.has(key) && !key.startsWith("tokenAvoidance"));
    return `
      <div class="fxp-portrait-actions">
        <button type="button" data-action="mirror" aria-pressed="${portrait.mirrored}" title="Отразить портрет">Отразить</button>
        <button type="button" data-action="left" title="Поменять местами с левым" aria-label="Поменять местами с левым" ${portraitNeighbor(this.store.state.portraits, portrait.id, -1) ? "" : "disabled"}>←</button>
        <button type="button" data-action="right" title="Поменять местами с правым" aria-label="Поменять местами с правым" ${portraitNeighbor(this.store.state.portraits, portrait.id, 1) ? "" : "disabled"}>→</button>
        <button type="button" data-action="remove" class="fxp-danger">Убрать</button>
      </div>
      ${this.previewMarkup(portrait)}
      <div class="fxp-name-actions">
        <button type="button" data-action="toggle-name">${portrait.showName ? "Скрыть имя" : "Показать имя"}</button>
        <button type="button" data-action="rename" aria-expanded="${this.renamingId === portrait.id}">Изменить имя</button>
      </div>
      ${this.renamingId === portrait.id ? `<form class="fxp-rename" data-role="rename"><label>Новое имя<input name="newName" type="text" value="${e(this.renameValue)}" maxlength="200"></label><div><button type="submit">Сохранить имя</button><button type="button" data-action="cancel-rename">Отмена</button></div></form>` : ""}
      <div class="fxp-appearance"><button type="button" data-action="appearance-toggle" class="${this.appearanceOpen ? "is-selected" : ""}" aria-expanded="${this.appearanceOpen}" aria-controls="fxp-appearance-form">Изображение и размер</button>
        <form id="fxp-appearance-form" data-role="appearance" ${this.appearanceOpen ? "" : "hidden"}>
          <label>Высота, px <output data-value-for="height">${appearance.height}</output><input name="height" aria-label="Высота, px" type="range" min="100" max="700" step="1" value="${appearance.height}"></label>
          <p class="fxp-hint" data-role="actual-height"></p>
          <label>Смещение по высоте, px <output data-value-for="offsetY">${appearance.offsetY ?? 0}</output><input name="offsetY" aria-label="Смещение по высоте, px" type="range" min="-450" max="450" step="1" value="${appearance.offsetY ?? 0}"></label>
        </form>
      </div>
      <button type="button" class="fxp-effects-toggle ${this.effectsOpen ? "is-selected" : ""}" data-action="effects-toggle" aria-expanded="${this.effectsOpen}" aria-controls="fxp-effects">Эффекты</button>
      <div id="fxp-effects" ${this.effectsOpen ? "" : "hidden"}>
      <nav class="fxp-tabs" aria-label="Тип эффектов">${KINDS.map((kind) => `<button type="button" data-action="kind" data-kind="${kind}" class="${kind === this.kind ? "is-selected" : ""}" aria-pressed="${kind === this.kind}">${kind === "filter" ? "Filter Effects" : kind === "particle" ? "Particle Effects" : "TokenMagic"}</button>`).join("")}</nav>
      ${this.kind === "tokenmagic" ? `<button type="button" data-action="copy-token" ${this.effectsAvailable && tokenMagicApi() ? "" : "disabled"}>Взять эффекты выбранного токена</button><p class="fxp-hint">Выбери один токен на сцене для копирования его эффектов. Копия сохраняется отдельно для этого портрета.</p>` : ""}
      ${this.kind === "tokenmagic" ? this.macroMarkup() : ""}
      <select data-role="effect" aria-label="Эффект">${effects.map(([id, cls]) => `<option value="${e(id)}" ${id === effectId ? "selected" : ""}>${portrait[this.kind].enabled[id] ? "● " : ""}${e(localize(cls.label ?? id))}</option>`).join("")}</select>
      <div class="fxp-active" aria-label="Активные эффекты">${this.effectStatusMarkup(portrait)}</div>
      ${EffectClass ? `<div class="fxp-effect-actions"><button type="button" data-action="toggle-effect" aria-pressed="${active}">${active ? "Выключить эффект" : "Включить эффект"}</button>${this.kind === "tokenmagic" && effectId === COPIED_TOKEN ? "" : '<button type="button" data-action="defaults">Стандартные настройки</button>'}</div>
      <form data-role="parameters">${rows.map(([key, def]) => `<div class="fxp-param" data-key="${e(key)}"><label for="fxp-param-${e(key)}" title="${e(localize(def.tooltip ?? ""))}">${e(localize(def.label ?? key))}</label>${inputMarkup(key, def, values[key])}</div>`).join("") || '<p class="fxp-empty">У этого эффекта нет доступных параметров.</p>'}</form>
      <button type="button" data-action="apply-all" class="fxp-primary">Применить эффект ко всем</button>
      <p class="fxp-hint">Параметры применяются автоматически. Кнопка включает выбранный эффект с этими параметрами у всех добавленных портретов, включая скрытые.${this.kind === "tokenmagic" ? " Параметры с анимацией продолжают изменяться согласно пресету; редактор анимаций пока не добавлен." : ""}</p>` : `<p class="fxp-empty">${!this.effectsAvailable ? "Портреты работают без эффектов. Для эффектов установи и включи FXMaster 8.3.6+ и FXMaster+ 1.1.14+. Сохранённые настройки эффектов остаются в мире." : this.kind === "tokenmagic" ? "Включи совместимый с твоей версией Foundry Token Magic FX для работы с этими эффектами." : "Нет доступных эффектов. Проверь FXMaster и FXMaster+."}</p>`}
      <button type="button" data-action="clear" class="fxp-clear">Снять все эффекты с персонажа</button>
      <button type="button" class="fxp-clear" data-action="clear-all" title="Отключить FXMaster+ и TokenMagic у всех портретов, включая скрытые">Снять эффекты со всех</button></div>`;
  }

  previewMarkup(portrait) {
    if (!this.preview || !game.user.isGM || portrait.visible) return "";
    const active = this.preview.isActive(this.store.state, portrait.id);
    return `<div class="fxp-preview"><button type="button" data-action="preview" class="${active ? "is-selected" : ""}" aria-pressed="${active}">Предпросмотр GM</button>
      <p class="fxp-hint">${active ? "Портрет виден только тебе. Настрой его и нажми «Показать», когда он будет готов." : "Посмотри и настрой скрытый портрет у себя перед показом игрокам."}</p></div>`;
  }

  macroMarkup() {
    if (!game.user.isGM || !this.saveMacro) return "";
    return `<button type="button" data-action="add-macro" aria-expanded="${this.macroOpen}" ${!this.effectsAvailable || !tokenMagicApi() || this.macroBusy ? "disabled" : ""}>Добавить макрос</button>
      ${this.macroOpen ? `<form class="fxp-macro" data-role="macro">
        <label>Название<input type="text" data-role="macro-name" value="${e(this.macroName)}" maxlength="120" required ${this.macroBusy ? "disabled" : ""}></label>
        <label>JavaScript-код<textarea data-role="macro-source" rows="9" maxlength="65536" spellcheck="false" required ${this.macroBusy ? "disabled" : ""}>${e(this.macroSource)}</textarea></label>
        <p class="fxp-hint">Вставь макрос TokenMagic, который добавляет фильтры выделенному токену. Сохранённый эффект можно включать на портрете без токена.</p>
        ${this.macroError ? `<p class="fxp-macro-error" role="alert">${e(this.macroError)}</p>` : ""}
        <div class="fxp-effect-actions"><button type="submit" ${this.macroBusy ? "disabled" : ""}>${this.macroBusy ? "Сохранение…" : "Сохранить макрос"}</button><button type="button" data-action="cancel-macro" ${this.macroBusy ? "disabled" : ""}>Отмена</button></div>
      </form>` : ""}`;
  }

  async saveMacroDraft() {
    if (!game.user.isGM || this.macroBusy || !this.saveMacro) return;
    const name = this.macroName.trim();
    const source = this.macroSource.trim();
    const portrait = this.currentPortrait();
    if (!name || !source || !portrait) {
      this.macroError = "Введи название и JavaScript-код макроса.";
      this.render(); return;
    }
    this.flushLiveEffect();
    this.macroBusy = true; this.macroError = ""; this.render();
    try {
      const params = await this.importMacro(source, portrait);
      const id = await this.saveMacro(name.slice(0, 120), source, params);
      this.kind = "tokenmagic";
      this.selectedEffects.tokenmagic = id;
      this.macroOpen = false; this.macroName = ""; this.macroSource = "";
    } catch (error) { this.macroError = error.message || "Не удалось добавить макрос."; }
    finally { this.macroBusy = false; this.render(); }
  }

  currentPortrait() {
    return this.store.state.portraits.find((item) => item.id === this.selectedId);
  }

  effectRegistry(kind = this.kind) { return this.effectsAvailable ? registry(kind, this.currentPortrait()?.[kind]) : {}; }

  effectDefinition() {
    const effectId = this.selectedEffects[this.kind];
    const effect = this.effectRegistry()[effectId];
    return this.kind === "tokenmagic" ? tokenMagicDescriptor(effect, this.currentPortrait()?.tokenmagic.options[effectId]) : effect;
  }

  parameterContext() { return JSON.stringify([this.selectedId, this.kind, this.selectedEffects[this.kind]]); }

  effectStatusMarkup(portrait) {
    if (!this.effectsAvailable) return '<span>Эффекты недоступны</span>';
    return KINDS.flatMap((kind) => Object.entries(portrait[kind]?.enabled ?? {}).filter(([id, on]) => on && registry(kind, portrait[kind])[id])
      .map(([id]) => `<button type="button" data-action="active" data-kind="${kind}" data-effect="${e(id)}">${kind === "filter" ? "◈" : kind === "particle" ? "✦" : "✧"} ${e(localize(registry(kind, portrait[kind])[id].label ?? id))}</button>`)).join("") || '<span>Эффекты выключены</span>';
  }

  updateEffectStatus(portrait) {
    const effectId = this.selectedEffects[this.kind];
    const active = !!portrait[this.kind].enabled[effectId];
    const toggle = this.element.querySelector('[data-action="toggle-effect"]');
    if (toggle) { toggle.textContent = active ? "Выключить эффект" : "Включить эффект"; toggle.setAttribute("aria-pressed", String(active)); }
    const status = this.element.querySelector(".fxp-active");
    if (status) status.innerHTML = this.effectStatusMarkup(portrait);
    for (const option of this.element.querySelector('[data-role="effect"]')?.options ?? []) {
      option.textContent = `${portrait[this.kind].enabled[option.value] ? "● " : ""}${localize(this.effectRegistry()[option.value]?.label ?? option.value)}`;
    }
  }

  parametersValid() {
    const form = this.element?.querySelector('[data-role="parameters"]');
    return ![...(form?.elements ?? [])].some((input) => input.type === "number" && (input.value === "" || !input.validity.valid));
  }

  scheduleLiveEffect() {
    if (!this.currentPortrait() || !this.effectRegistry()[this.selectedEffects[this.kind]]) return;
    if (!this.parametersValid()) return;
    this.liveEdit = { ids: [this.selectedId], kind: this.kind, effectId: this.selectedEffects[this.kind], values: this.readValues() };
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => this.flushLiveEffect(), 120);
  }

  flushLiveEffect() {
    clearTimeout(this.liveTimer);
    this.liveTimer = null;
    const edit = this.liveEdit;
    this.liveEdit = null;
    if (edit) this.run(this.store.applyEffect(edit));
  }

  appearanceStructure() {
    return JSON.stringify({ selectedId: this.selectedId, bottom: this.store.state.bottom,
      portraits: this.store.state.portraits.map(({ filter, particle, tokenmagic, height, offsetY, ...portrait }) =>
        portrait.id === this.selectedId ? portrait : { ...portrait, height, offsetY }),
    });
  }

  projectAppearance(world) {
    if (!game.user.isGM || !this.appearanceDrafts.size) return world;
    const projected = clone(world);
    for (const portrait of projected.portraits) {
      const draft = this.appearanceDrafts.get(portrait.id);
      if (draft) Object.assign(portrait, draft);
    }
    return projected;
  }

  changeAppearance(input) {
    const portrait = this.currentPortrait();
    if (!game.user.isGM || !portrait || !["height", "offsetY"].includes(input.name)) return;
    const value = Number(input.value);
    const [min, max] = input.name === "height" ? [100, 700] : [-450, 450];
    if (input.value === "" || !Number.isFinite(value) || value < min || value > max) return;
    const prior = this.appearanceDrafts.get(portrait.id) ?? portrait;
    const draft = { height: prior.height, offsetY: prior.offsetY ?? 0, [input.name]: value };
    this.appearanceDrafts.set(portrait.id, draft);
    this.appearanceEdits.set(portrait.id, draft);
    const output = this.element.querySelector(`[data-value-for="${input.name}"]`);
    if (output) output.textContent = input.value;
    this.onAppearancePreview();
    this.updateHeightHint();
    if (this.appearanceTimer === null) this.appearanceTimer = setTimeout(() => this.flushAppearance(), 60);
  }

  flushAppearance() {
    clearTimeout(this.appearanceTimer);
    this.appearanceTimer = null;
    const edits = [...this.appearanceEdits];
    this.appearanceEdits.clear();
    for (const [id, draft] of edits) {
      const settle = () => {
        if (this.appearanceDrafts.get(id) !== draft) return;
        this.appearanceDrafts.delete(id);
        this.onAppearancePreview();
      };
      this.run(this.store.editPortrait(id, (portrait) => { Object.assign(portrait, draft); }).then(settle, settle));
    }
  }

  onContextMenu(event) {
    if (!game.user.isGM) return;
    const button = event.target.closest('[data-action="select"], [data-action="choose-actor"]');
    if (!button || !this.element.contains(button)) return;
    const id = button.dataset.id ?? this.store.state.portraits.find((portrait) => portrait.actorId === button.dataset.actorId)?.id;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    this.flushLiveEffect();
    this.run(this.store.removePortrait(id));
  }

  saveName() {
    const id = this.renamingId;
    const name = this.renameValue.trim();
    if (!id || !name) { ui.notifications.warn("Введи имя персонажа."); return; }
    this.run(this.store.editPortrait(id, (portrait) => { portrait.name = name; }).then(() => {
      if (this.renamingId === id) this.renamingId = null;
      this.render();
    }));
  }

  readValues() {
    const portrait = this.currentPortrait();
    const effectId = this.selectedEffects[this.kind];
    const EffectClass = this.effectDefinition();
    const values = defaultValues(EffectClass, portrait?.[this.kind].options[effectId]);
    const form = this.element?.querySelector('[data-role="parameters"]');
    for (const [key, definition] of Object.entries(definitions(EffectClass))) {
      const input = form?.elements.namedItem(key);
      if (!input) continue;
      let value = input.value;
      if (["checkbox", "boolean"].includes(definition.type)) value = input.checked;
      else if (definition.type === "multi-select") value = [...input.selectedOptions].map((option) => option.value);
      else if (definition.type === "color") {
        const apply = [...form.querySelectorAll("[data-color-apply]")].find((element) => element.dataset.colorApply === key);
        value = { value: input.value, apply: definition.tokenMagic || apply?.checked === true };
      }
      values[key] = parameterValue(definition, value);
    }
    return this.kind === "tokenmagic" ? tokenMagicEditedParams(EffectClass, values) : values;
  }

  refreshConditions() {
    const values = this.readValues();
    const defs = definitions(this.effectDefinition());
    for (const row of this.element?.querySelectorAll(".fxp-param") ?? []) {
      const input = row.querySelector("[name]");
      if (input) input.id = `fxp-param-${row.dataset.key}`;
      row.hidden = !isParameterVisible(defs[row.dataset.key], values);
    }
  }

  onInput(event) {
    const input = event.target;
    if (input.dataset.role === "macro-name") { this.macroName = input.value; return; }
    if (input.dataset.role === "macro-source") { this.macroSource = input.value; return; }
    if (input.dataset.role === "actor-search") { this.actorSearch = input.value; this.updateActorOptions(); return; }
    if (input.closest('[data-role="appearance"]')) {
      this.changeAppearance(input);
      return;
    }
    if (input.dataset.role === "add-height") this.addHeight = input.value;
    if (input.closest('[data-role="rename"]')) this.renameValue = input.value;
    if (input.dataset.range) {
      const number = this.element.querySelector('[data-role="parameters"]').elements.namedItem(input.dataset.range);
      if (number) number.value = input.value;
    } else if (input.type === "number" && input.name) {
      const range = [...this.element.querySelectorAll("[data-range]")].find((item) => item.dataset.range === input.name);
      if (range) range.value = input.value;
    }
    if (input.closest('[data-role="parameters"]')) { this.refreshConditions(); this.scheduleLiveEffect(); }
  }

  onChange(event) {
    const input = event.target;
    if (input.closest?.('[data-role="appearance"]')) {
      this.changeAppearance(input); this.flushAppearance(); return;
    }
    if (input.dataset.role === "effect") {
      this.flushLiveEffect();
      this.selectedEffects[this.kind] = input.value;
      this.render();
    } else if (input.dataset.role === "add-name") {
      this.addName = input.checked;
    } else if (input.dataset.role === "add-hidden") {
      this.addHidden = input.checked;
    } else if (input.dataset.role === "add-height-preset") {
      if (![...HEIGHT_PRESETS.map(({ id }) => id), "custom"].includes(input.value)) return;
      this.addHeightPreset = input.value;
      if (input.value !== "custom") this.addHeight = normalizeHeightPresets(this.readHeightPresets())[input.value];
      const custom = this.element.querySelector('[data-role="custom-height"]');
      if (custom) custom.hidden = input.value !== "custom";
      const height = this.element.querySelector('[data-role="add-height"]');
      if (height) { height.value = this.addHeight; if (input.value === "custom") height.focus(); }
      this.applyPosition();
    } else if (input.dataset.role === "add-height") {
      this.addHeight = input.value;
    } else if (input.dataset.role === "bottom") {
      const value = input.value;
      this.run(this.store.change((state) => { state.bottom = Number(value); }));
    } else if (input.closest('[data-role="parameters"]')) {
      this.refreshConditions(); this.scheduleLiveEffect(); this.flushLiveEffect();
    }
  }

  run(promise) {
    // The store reports write failures once, while this catches the returned operation.
    promise?.catch?.(() => {});
  }

  addActor(actorId) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const height = Number(this.addHeight);
    if (this.addHeight === "" || !Number.isFinite(height) || height < 100 || height > 700) {
      ui.notifications.warn("Укажи высоту от 100 до 700 px."); return;
    }
    const id = foundry.utils.randomID();
    const showName = this.addName;
    const visible = !this.addHidden;
    this.selectedActorId = actor.id;
    this.selectedId = id;
    const operation = this.store.change((state) => {
      const existing = state.portraits.find((item) => item.actorId === actor.id);
      if (existing) { existing.visible = true; existing.showName = showName; existing.height = height; this.selectedId = existing.id; }
      else state.portraits.push({ ...newPortrait(actor, id, showName), height, visible });
    });
    this.run(operation);
    return operation;
  }

  onClick(event) {
    if (this.suppressRosterClick) { this.suppressRosterClick = false; return; }
    const button = event.target.closest("[data-action]");
    if (!button || !this.element.contains(button)) return;
    const action = button.dataset.action;
    if (action === "open-picker") { this.picker?.open(); return; }
    if (action === "add-macro" || action === "cancel-macro") {
      if (!game.user.isGM || this.macroBusy) return;
      this.macroOpen = action === "add-macro" && !this.macroOpen;
      this.macroError = ""; this.render();
      if (this.macroOpen) this.element.querySelector('[data-role="macro-name"]')?.focus();
      return;
    }
    this.flushLiveEffect();
    this.flushAppearance();
    if (action === "favorite") {
      if (game.user.isGM && game.actors?.get(button.dataset.actorId)) this.run(this.favorites?.toggle(button.dataset.actorId));
      return;
    }
    if (action === "choose-actor") {
      if (game.user.isGM) this.addActor(button.dataset.actorId);
      return;
    }
    if (action === "close") { this.close(); return; }
    if (action === "preview") {
      if (game.user.isGM) this.preview?.toggle(this.store.state, this.selectedId);
      return;
    }
    if (action === "hide-all" || action === "show-all") {
      this.run(this.store.setAllVisible(action === "show-all"));
      return;
    }
    if (action === "arrange") {
      this.run(this.store.arrangePortraits());
      return;
    }
    if (action === "clear-all") {
      this.run(this.store.clearAllEffects());
      return;
    }
    if (action === "select") { this.selectPortrait(button.dataset.id); return; }
    if (action === "appearance-toggle") {
      this.appearanceOpen = !this.appearanceOpen;
      const form = this.element.querySelector('[data-role="appearance"]');
      if (form) form.hidden = !this.appearanceOpen;
      button.setAttribute("aria-expanded", String(this.appearanceOpen));
      button.classList.toggle("is-selected", this.appearanceOpen);
      this.applyPosition();
      return;
    }
    if (action === "effects-toggle") {
      this.effectsOpen = !this.effectsOpen;
      const block = this.element.querySelector("#fxp-effects");
      if (block) block.hidden = !this.effectsOpen;
      button.setAttribute("aria-expanded", String(this.effectsOpen));
      button.classList.toggle("is-selected", this.effectsOpen);
      this.applyPosition();
      return;
    }
    if (action === "rename") {
      if (this.renamingId === this.selectedId) {
        this.renamingId = null; this.renameValue = ""; this.render(); return;
      }
      this.renamingId = this.selectedId;
      this.renameValue = this.currentPortrait()?.name ?? "";
      this.render();
      this.element.querySelector('[name="newName"]')?.focus();
      return;
    }
    if (action === "cancel-rename") { this.renamingId = null; this.render(); return; }
    if (action === "kind" || action === "active") {
      this.kind = button.dataset.kind;
      if (action === "active") this.selectedEffects[this.kind] = button.dataset.effect;
      this.render();
      return;
    }
    const id = this.selectedId;
    const kind = this.kind;
    const effectId = this.selectedEffects[kind];
    if (action === "copy-token") {
      try {
        const params = selectedTokenMagicParams();
        this.selectedEffects.tokenmagic = COPIED_TOKEN;
        this.run(this.store.applyEffect({ ids: [id], kind: "tokenmagic", effectId: COPIED_TOKEN, values: { params } }));
      } catch (error) { ui.notifications.warn(error.message); }
    } else if (action === "visibility") this.run(this.store.editPortrait(id, (portrait) => { portrait.visible = !portrait.visible; }));
    else if (action === "toggle-name") this.run(this.store.editPortrait(id, (portrait) => { portrait.showName = !portrait.showName; }));
    else if (action === "mirror") this.run(this.store.editPortrait(id, (portrait) => { portrait.mirrored = !portrait.mirrored; }));
    else if (action === "remove") this.run(this.store.removePortrait(id));
    else if (action === "left" || action === "right") {
      this.run(this.store.swapPortrait(id, action === "left" ? -1 : 1));
    } else if (action === "clear") {
      this.run(this.store.editPortrait(id, (portrait) => {
        portrait.filter.enabled = {};
        portrait.particle.enabled = {};
        portrait.tokenmagic.enabled = {};
      }));
    } else if (action === "defaults") {
      this.run(this.store.editPortrait(id, (portrait) => { portrait[kind].options[effectId] = {}; }));
    } else if (action === "apply-all") {
      if (!this.parametersValid()) { ui.notifications.warn("Проверь значения параметров эффекта."); return; }
      this.run(this.store.applyEffect({ kind, effectId, values: this.readValues() }));
    } else if (action === "toggle-effect") {
      if (!this.parametersValid()) { ui.notifications.warn("Проверь значения параметров эффекта."); return; }
      const values = this.readValues();
      if (kind === "tokenmagic" && !values.params.length) { ui.notifications.warn("Сначала скопируй эффекты с выбранного токена."); return; }
      if (kind === "tokenmagic" && !this.currentPortrait().tokenmagic.enabled[effectId]) {
        this.run(this.store.applyEffect({ ids: [id], kind, effectId, values }));
        return;
      }
      this.run(this.store.editPortrait(id, (portrait) => {
        portrait[kind].options[effectId] = values;
        portrait[kind].enabled[effectId] = !portrait[kind].enabled[effectId];
      }));
    }
  }
}
