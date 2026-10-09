import { escapeHtml as e } from "./model.js";

export class PlayerControls {
  constructor(view, { isGM }) {
    this.view = view;
    this.isGM = isGM;
    this.pointerInside = false;
    this.keyboardInput = false;
    this.keyboardFocused = false;
    this.selectedId = null;
    this.element = document.createElement("section");
    this.element.id = "fx-portraits-player-controls";
    this.element.setAttribute("aria-label", "Мои портреты");
    document.body.append(this.element);
    this.element.addEventListener("change", (event) => {
      if (event.target.dataset.role === "portrait") { this.selectedId = event.target.value; this.render(this.world); }
    });
    this.element.addEventListener("click", (event) => this.onClick(event));
    this.element.addEventListener("pointerenter", () => { this.pointerInside = true; this.updateReveal(); });
    this.element.addEventListener("pointerleave", () => { this.pointerInside = false; this.updateReveal(); });
    this.element.addEventListener("pointerdown", () => { this.keyboardInput = false; this.keyboardFocused = false; });
    this.element.addEventListener("focusin", () => {
      this.keyboardFocused = this.keyboardInput;
      this.updateReveal();
    });
    this.element.addEventListener("focusout", (event) => {
      if (!this.element.contains(event.relatedTarget)) { this.keyboardFocused = false; this.updateReveal(); }
    });
    this.onKeyDown = (event) => {
      if (["Tab", "Enter", " ", "ArrowUp", "ArrowDown"].includes(event.key)) this.keyboardInput = true;
      if (event.key === "Escape" && this.element.contains(event.target)) {
        this.keyboardFocused = false;
        event.target.blur();
        this.updateReveal();
      }
    };
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  toggle() {
    if (this.isGM() || !this.world) return;
    if (this.keyboardFocused) {
      this.keyboardFocused = false;
      if (this.element.contains(document.activeElement)) document.activeElement.blur();
    } else {
      this.keyboardInput = true;
      this.keyboardFocused = true;
      this.element.querySelector('[data-action="reveal"]')?.focus();
    }
    this.updateReveal();
  }

  updateReveal() {
    const revealed = this.pointerInside || this.keyboardFocused;
    this.element.classList.toggle("is-revealed", revealed);
    this.element.querySelector('[data-action="reveal"]')?.setAttribute("aria-expanded", String(revealed));
    const actions = this.element.querySelector(".fxp-player-main");
    if (actions) actions.inert = !revealed;
  }

  bottomInset() {
    // Reserve a stable height, so hovering the tray never moves portraits.
    return this.element.hidden ? 0 : this.element.offsetHeight + 8;
  }

  render(world) {
    if (!world) return;
    this.world = world;
    this.element.hidden = this.isGM();
    const visible = world.portraits.filter((item) => item.visible);
    if (!visible.some((item) => item.id === this.selectedId)) this.selectedId = visible[0]?.id ?? null;
    const disabled = !visible.length || this.view.state.hidden;
    const focused = this.element.contains(document.activeElement) ? document.activeElement.dataset : null;
    const keyboardFocused = this.keyboardFocused;
    const selected = visible.find((portrait) => portrait.id === this.selectedId);
    const mirrored = selected ? this.view.project(world).portraits.find((portrait) => portrait.id === selected.id)?.mirrored : false;
    this.element.innerHTML = `<button type="button" class="fxp-player-handle" data-action="reveal" aria-controls="fxp-player-actions" title="Наведи курсор, чтобы раскрыть. Alt+P — открыть с клавиатуры">Портреты <span aria-hidden="true">⌃</span></button>
    <div class="fxp-player-main" id="fxp-player-actions">
      <button type="button" data-action="visibility" title="Только на моём экране" ${visible.length ? "" : "disabled"}>${this.view.state.hidden ? "Показать портреты" : "Скрыть портреты"}</button>
      <select data-role="portrait" aria-label="Портрет для переворота" ${disabled ? "disabled" : ""}>${visible.length ? visible.map((portrait, index) => `<option value="${e(portrait.id)}" ${portrait.id === this.selectedId ? "selected" : ""}>${e(portrait.showName ? portrait.name : `Портрет ${index + 1}`)}</option>`).join("") : '<option>Нет портретов</option>'}</select>
      <button type="button" data-action="flip" aria-pressed="${!!mirrored}" title="Перевернуть выбранный портрет только на моём экране" ${disabled ? "disabled" : ""}>Перевернуть</button>
      <button type="button" data-action="reset" title="Вернуть положения всех портретов, заданные GM" ${Object.keys(this.view.state.positions).length ? "" : "disabled"}>Сбросить положение</button>
    </div>`;
    this.keyboardFocused = keyboardFocused;
    this.updateReveal();
    if (focused) this.element.querySelector(focused.action ? `[data-action="${focused.action}"]` : '[data-role="portrait"]')?.focus();
  }

  onClick(event) {
    if (this.isGM()) return;
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === "reveal") {
      if (this.keyboardInput) this.toggle();
      return;
    }
    let operation;
    if (action === "visibility") operation = this.view.toggleHidden();
    else if (action === "flip") operation = this.view.flipPortrait(this.world, this.selectedId);
    else if (action === "reset") operation = this.view.resetPositions();
    operation?.catch(() => {});
  }

  destroy() { document.removeEventListener("keydown", this.onKeyDown, true); this.element.remove(); }
}
