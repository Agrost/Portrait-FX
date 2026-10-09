import { escapeHtml as e } from "./model.js";

export const PICKER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></svg>';
const PEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/></svg>';
const TAG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></svg>';

export function filterPickerActors(actors, { search = "", selected = new Set(), uncategorized = false, assignments = {} } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return actors.filter((actor) => {
    const ids = assignments[actor.id] ?? [];
    return actor.name.toLocaleLowerCase().includes(query)
      && ((!selected.size && !uncategorized) || ids.some((id) => selected.has(id)) || (uncategorized && !ids.length));
  });
}

export class ActorPicker {
  constructor({ panel, categories }) {
    this.panel = panel;
    this.categories = categories;
    this.element = null;
    this.search = "";
    this.selected = new Set();
    this.uncategorized = false;
    this.actorOrder = null;
    this.assignmentActor = null;
    this.editCategoryId = null;
    this.categoryName = "";
    this.categoryBusy = false;
    this.categoryError = "";
    this.adding = new Set();
    this.position = null;
    this.size = { width: 780, height: 600 };
    this.onResize = () => this.applyGeometry();
  }

  open() {
    if (!game.user.isGM) return;
    if (!this.element) {
      this.element = document.createElement("section");
      this.element.id = "fx-portraits-actor-picker";
      this.element.setAttribute("role", "dialog");
      this.element.setAttribute("aria-label", "Выбор персонажей");
      for (const [name, callback] of Object.entries({
        click: (event) => this.onClick(event), input: (event) => this.onInput(event),
        change: (event) => this.onChange(event), submit: (event) => this.onSubmit(event),
        keydown: (event) => this.onKeyDown(event),
        pointerdown: (event) => this.startGesture(event), pointermove: (event) => this.moveGesture(event),
        pointerup: (event) => this.endGesture(event), pointercancel: (event) => this.endGesture(event),
      })) this.element.addEventListener(name, callback);
      document.body.append(this.element);
      window.addEventListener("resize", this.onResize);
    }
    this.render();
    this.element.querySelector('[data-role="picker-search"]')?.focus();
  }

  close() {
    window.removeEventListener("resize", this.onResize);
    this.element?.remove();
    this.element = null;
    this.gesture = null;
    this.actorOrder = null;
    this.assignmentActor = null;
    this.search = "";
  }

  actors() {
    const favorite = new Set(this.panel.favorites?.state ?? []);
    const actors = [...(game.actors?.contents ?? [])].sort((a, b) =>
      Number(favorite.has(b.id)) - Number(favorite.has(a.id)) || a.name.localeCompare(b.name));
    if (!this.actorOrder) this.actorOrder = actors.map((actor) => actor.id);
    const order = new Map(this.actorOrder.map((id, index) => [id, index]));
    return actors.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }

  portraitStructure() {
    return JSON.stringify(this.panel.store.state.portraits.map(({ id, actorId, name, src, visible }) => ({ id, actorId, name, src, visible })));
  }

  refreshPortraits() {
    if (this.element && (!game.user.isGM || this.renderedPortraits !== this.portraitStructure())) this.render();
  }

  render() {
    if (!this.element) return;
    if (!game.user.isGM) { this.close(); return; }
    const active = this.element.contains(document.activeElement) ? document.activeElement : null;
    const focus = active ? { role: active.dataset.role, action: active.dataset.action,
      actorId: active.dataset.actorId, categoryId: active.dataset.categoryId, id: active.dataset.id,
      cursor: active.type === "text" || active.type === "search" ? [active.selectionStart, active.selectionEnd] : null } : null;
    const scroll = this.element.querySelector(".fxp-picker-list")?.scrollTop ?? 0;
    const categoryScroll = this.element.querySelector(".fxp-picker-categories")?.scrollTop ?? 0;
    const stripScroll = this.element.querySelector(".fxp-picker-added")?.scrollLeft ?? 0;
    const { categories, assignments } = this.categories.state;
    this.selected = new Set([...this.selected].filter((id) => categories.some((item) => item.id === id)));
    const actors = game.actors?.contents ?? [];
    this.element.innerHTML = `
      <header class="fxp-picker-header" tabindex="0"><strong>Выбор персонажей</strong><button type="button" data-action="close-picker" aria-label="Закрыть выбор персонажей">×</button></header>
      <div class="fxp-picker-added" aria-label="Уже добавленные персонажи">${this.addedMarkup()}</div>
      <div class="fxp-picker-columns">
        <aside class="fxp-picker-categories" aria-label="Категории персонажей">
          <div class="fxp-picker-section-title">Категории</div>
          <button type="button" class="fxp-picker-all ${!this.selected.size && !this.uncategorized ? "is-selected" : ""}" data-action="all-categories">Все персонажи <span>${actors.length}</span></button>
          <label class="fxp-picker-category"><input type="checkbox" data-role="filter-uncategorized" ${this.uncategorized ? "checked" : ""}>Без категории <span>${actors.filter((actor) => !assignments[actor.id]?.length).length}</span></label>
          ${categories.map((item) => `<div class="fxp-picker-category-row"><label class="fxp-picker-category"><input type="checkbox" data-role="filter-category" data-category-id="${e(item.id)}" ${this.selected.has(item.id) ? "checked" : ""}><span class="fxp-picker-category-name">${e(item.name)}</span><span>${actors.filter((actor) => assignments[actor.id]?.includes(item.id)).length}</span></label><button type="button" class="fxp-picker-icon" data-action="rename-category" data-category-id="${e(item.id)}" title="Переименовать категорию" aria-label="${e(`Переименовать: ${item.name}`)}">${PEN_ICON}</button></div>`).join("")}
          <form class="fxp-picker-category-form"><label>${this.editCategoryId ? "Переименовать категорию" : "Новая категория"}<input type="text" data-role="category-name" value="${e(this.categoryName)}" placeholder="Название" required ${this.categoryBusy ? "disabled" : ""}></label><div><button type="submit" ${this.categoryBusy ? "disabled" : ""}>${this.editCategoryId ? "Сохранить" : "Добавить"}</button>${this.editCategoryId ? '<button type="button" data-action="cancel-category">Отмена</button>' : ""}</div>${this.categoryError ? `<p class="fxp-picker-error" role="alert">${e(this.categoryError)}</p>` : ""}</form>
        </aside>
        <div class="fxp-picker-results"><input type="search" data-role="picker-search" value="${e(this.search)}" placeholder="Поиск по имени…" aria-label="Поиск в окне выбора" autocomplete="off" aria-controls="fxp-picker-list"><div id="fxp-picker-list" class="fxp-picker-list" aria-label="Персонажи">${this.listMarkup()}</div></div>
      </div><footer class="fxp-picker-footer"><span>Размер и показ — из настроек основной панели</span><button type="button" class="fxp-picker-resize" aria-label="Изменить размер окна выбора" title="Потяни угол">↘</button></footer>`;
    this.element.querySelector(".fxp-picker-list").scrollTop = scroll;
    this.element.querySelector(".fxp-picker-categories").scrollTop = categoryScroll;
    this.element.querySelector(".fxp-picker-added").scrollLeft = stripScroll;
    this.renderedPortraits = this.portraitStructure();
    this.applyGeometry();
    if (focus) {
      const target = [...this.element.querySelectorAll("button, input")].find((node) =>
        (focus.role || focus.action) && node.dataset.role === focus.role && node.dataset.action === focus.action
        && node.dataset.actorId === focus.actorId && node.dataset.categoryId === focus.categoryId && node.dataset.id === focus.id);
      target?.focus();
      if (focus.cursor) target?.setSelectionRange(...focus.cursor);
    }
  }

  addedMarkup() {
    return this.panel.store.state.portraits.map((portrait) => `<button type="button" class="fxp-picker-thumbnail ${portrait.visible ? "" : "is-hidden-portrait"}" data-action="open-added" data-id="${e(portrait.id)}" title="${e(`${portrait.name}${portrait.visible ? "" : " (скрыт)"}`)}" aria-label="${e(`Открыть настройки: ${portrait.name}`)}"><img src="${e(portrait.src)}" alt="" draggable="false"><span>${e(portrait.name)}</span></button>`).join("") || '<p class="fxp-picker-empty">Добавленных персонажей пока нет.</p>';
  }

  listMarkup() {
    const { categories, assignments } = this.categories.state;
    const added = new Set(this.panel.store.state.portraits.map((portrait) => portrait.actorId));
    const actors = filterPickerActors(this.actors(), { search: this.search, selected: this.selected,
      uncategorized: this.uncategorized, assignments });
    return actors.map((actor) => {
      const favorite = this.panel.favorites?.state.includes(actor.id) ?? false;
      const assigned = assignments[actor.id] ?? [];
      const favoriteLabel = `${favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${actor.name}`;
      return `<div class="fxp-picker-actor">
        <div class="fxp-picker-actor-row"><button type="button" class="fxp-favorite ${favorite ? "is-favorite" : ""}" data-action="picker-favorite" data-actor-id="${e(actor.id)}" aria-pressed="${favorite}" aria-label="${e(favoriteLabel)}" title="${e(favoriteLabel)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z"/></svg></button>
        <button type="button" class="fxp-picker-choose" data-action="picker-add" data-actor-id="${e(actor.id)}" ${added.has(actor.id) || this.adding.has(actor.id) ? "disabled" : ""} title="${added.has(actor.id) ? "Настройки портрета — в верхней полосе" : "Добавить персонажа"}"><img src="${e(actor.img)}" alt="" loading="lazy" draggable="false"><span><strong>${e(actor.name)}</strong><small>${e(categories.filter((item) => assigned.includes(item.id)).map((item) => item.name).join(" · ") || "Без категории")}</small>${added.has(actor.id) ? '<small class="fxp-picker-added-label">Добавлен</small>' : this.adding.has(actor.id) ? '<small class="fxp-picker-added-label">Добавление…</small>' : ""}</span></button>
        <button type="button" class="fxp-picker-icon" data-action="actor-categories" data-actor-id="${e(actor.id)}" aria-expanded="${this.assignmentActor === actor.id}" title="Назначить категории" aria-label="${e(`Категории: ${actor.name}`)}">${TAG_ICON}</button></div>
        ${this.assignmentActor === actor.id ? `<div class="fxp-picker-assignments" aria-label="${e(`Категории: ${actor.name}`)}">${categories.map((item) => `<label><input type="checkbox" data-role="assign-category" data-actor-id="${e(actor.id)}" data-category-id="${e(item.id)}" ${assigned.includes(item.id) ? "checked" : ""}>${e(item.name)}</label>`).join("") || '<p class="fxp-picker-empty">Создай категорию слева.</p>'}</div>` : ""}
      </div>`;
    }).join("") || '<p class="fxp-picker-empty">Персонажи не найдены.</p>';
  }

  updateList() {
    const list = this.element?.querySelector(".fxp-picker-list");
    if (list) list.innerHTML = this.listMarkup();
  }

  updateFavorites() {
    for (const button of this.element?.querySelectorAll('[data-action="picker-favorite"]') ?? []) {
      const favorite = this.panel.favorites?.state.includes(button.dataset.actorId) ?? false;
      const actor = game.actors?.get(button.dataset.actorId);
      const label = `${favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${actor?.name ?? "Персонаж"}`;
      button.classList.toggle("is-favorite", favorite);
      button.setAttribute("aria-pressed", String(favorite));
      button.setAttribute("aria-label", label); button.title = label;
    }
  }

  onInput(event) {
    if (event.target.dataset.role === "picker-search") { this.search = event.target.value; this.updateList(); }
    if (event.target.dataset.role === "category-name") this.categoryName = event.target.value;
  }

  onChange(event) {
    if (!game.user.isGM) return;
    const input = event.target;
    const { role, categoryId, actorId } = input.dataset;
    if (role === "filter-category") {
      if (input.checked) this.selected.add(categoryId); else this.selected.delete(categoryId);
      this.render();
    }
    if (role === "filter-uncategorized") { this.uncategorized = input.checked; this.render(); }
    if (role === "assign-category" && game.actors?.get(actorId)) {
      this.panel.run(this.categories.assign(actorId, categoryId, input.checked).catch(() => this.render()));
    }
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!game.user.isGM || this.categoryBusy) return;
    this.categoryBusy = true; this.categoryError = "";
    const id = this.editCategoryId ?? foundry.utils.randomID();
    const name = this.categoryName;
    this.render();
    try {
      await this.categories.save(id, name);
      this.categoryName = ""; this.editCategoryId = null;
    } catch (error) { this.categoryError = error.message; }
    finally { this.categoryBusy = false; this.render(); }
  }

  onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !this.element.contains(button)) return;
    if (button.dataset.action === "close-picker") { this.close(); return; }
    if (!game.user.isGM) return;
    const { action, actorId, categoryId } = button.dataset;
    if (action === "picker-add") {
      if (this.adding.has(actorId) || this.panel.store.state.portraits.some((portrait) => portrait.actorId === actorId)) return;
      this.adding.add(actorId);
      const finish = () => { this.adding.delete(actorId); this.render(); };
      const operation = this.panel.addActor(actorId);
      if (operation) { this.render(); operation.then(finish, finish); }
      else finish();
    }
    if (action === "picker-favorite" && game.actors?.get(actorId)) this.panel.run(this.panel.favorites?.toggle(actorId));
    if (action === "open-added") this.panel.openPortrait(button.dataset.id);
    if (action === "actor-categories") { this.assignmentActor = this.assignmentActor === actorId ? null : actorId; this.render(); }
    if (action === "all-categories") { this.selected.clear(); this.uncategorized = false; this.render(); }
    if (action === "rename-category" && !this.categoryBusy) {
      this.editCategoryId = categoryId;
      this.categoryName = this.categories.state.categories.find((item) => item.id === categoryId)?.name ?? "";
      this.categoryError = ""; this.render(); this.element.querySelector('[data-role="category-name"]')?.focus();
    }
    if (action === "cancel-category" && !this.categoryBusy) {
      this.editCategoryId = null; this.categoryName = ""; this.categoryError = ""; this.render();
    }
  }

  onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.target.closest(".fxp-picker-results") && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      const options = [...this.element.querySelectorAll('[data-action="picker-add"]:not(:disabled)')];
      const id = event.target.closest('[data-actor-id]')?.dataset.actorId;
      const index = options.findIndex((option) => option.dataset.actorId === id);
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1)
        : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      event.preventDefault(); options[next]?.focus(); return;
    }
    if (event.target.closest(".fxp-picker-resize") && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      this.size.width += event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
      this.size.height += event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0;
      this.applyGeometry();
    }
  }

  applyGeometry() {
    if (!this.element) return;
    const width = Math.min(Math.max(480, this.size.width), Math.max(1, window.innerWidth - 16));
    const height = Math.min(Math.max(320, this.size.height), Math.max(1, window.innerHeight - 16));
    this.position ??= { left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2 };
    this.position.left = Math.max(8, Math.min(this.position.left, window.innerWidth - width - 8));
    this.position.top = Math.max(8, Math.min(this.position.top, window.innerHeight - height - 8));
    Object.assign(this.element.style, { width: `${width}px`, height: `${height}px`, left: `${this.position.left}px`, top: `${this.position.top}px` });
  }

  startGesture(event) {
    if (event.button !== 0 || event.target.closest("button, input") && !event.target.closest(".fxp-picker-resize")) return;
    const resize = !!event.target.closest(".fxp-picker-resize");
    if (!resize && !event.target.closest(".fxp-picker-header")) return;
    event.preventDefault();
    const rect = this.element.getBoundingClientRect();
    this.gesture = { pointerId: event.pointerId, resize, x: event.clientX, y: event.clientY,
      left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    this.element.setPointerCapture(event.pointerId);
  }

  moveGesture(event) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!event.buttons) { this.endGesture(event); return; }
    if (gesture.resize) this.size = { width: gesture.width + event.clientX - gesture.x, height: gesture.height + event.clientY - gesture.y };
    else this.position = { left: gesture.left + event.clientX - gesture.x, top: gesture.top + event.clientY - gesture.y };
    this.applyGeometry();
  }

  endGesture(event) {
    if (this.gesture?.pointerId !== event.pointerId) return;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    this.gesture = null;
  }
}
