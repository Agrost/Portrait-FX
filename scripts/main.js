import { MODULE_ID, SETTINGS_ID, STATE_KEY, INITIAL_STATE, clone, safeRecord } from "./model.js";
import { PortraitStore } from "./store.js";
import { PortraitStage } from "./stage.js";
import { PortraitPanel } from "./panel.js";
import { ClientPortraitView } from "./client-view.js";
import { PlayerControls } from "./player-controls.js";
import { SidebarLayout } from "./sidebar-layout.js";
import { FavoriteActors } from "./favorite-actors.js";
import { createPortraitFxRuntime } from "./tokenmagic-runtime.js";
import { GmPortraitPreview } from "./gm-preview.js";
import { savedTokenMagicMacros, cleanTokenMagicParams } from "./tokenmagic-data.js";
import { viewerFxFactory } from "./fx-availability.js";

let store;
let stage;
let panel;
let view;
let playerControls;
let sidebarLayout;
let favorites;
let preview;

function clientKey() { return `${game.world?.id ?? "world"}:${game.user.id}`; }
function readClientView(value = game.settings.get(SETTINGS_ID, "clientView")) { return safeRecord(value)[clientKey()] ?? {}; }
function readFavorites(value = game.settings.get(SETTINGS_ID, "actorFavorites")) { return safeRecord(value)[clientKey()] ?? []; }
function renderWorld() {
  if (!store || !view) return;
  playerControls?.render(store.state);
  const projected = view.project(store.state, { usePositions: !game.user.isGM, useMirrors: !game.user.isGM });
  if (!game.user.isGM && playerControls) projected.bottom = Math.max(projected.bottom, playerControls.bottomInset());
  stage.render(preview ? preview.project(projected, store.state) : projected);
}

function reportError(message, error) {
  console.error(`FX Portraits | ${message}`, error);
  ui.notifications.error(message);
}

function openPanel() {
  if (!game.user.isGM) return false;
  if (!panel) {
    ui.notifications.warn("Sano’s Portrait FX ещё не готов. Дождись загрузки мира.");
    return false;
  }
  panel.open();
  return true;
}

Hooks.once("init", () => {
  game.settings.register(SETTINGS_ID, "tokenMagicMacros", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => panel?.render(),
  });
  game.settings.register(SETTINGS_ID, STATE_KEY, {
    scope: "world", config: false, type: Object, default: clone(INITIAL_STATE),
    onChange: (value) => store?.receive(value),
  });
  game.settings.register(SETTINGS_ID, "panelPosition", {
    scope: "client", config: false, type: Object, default: {},
  });
  game.settings.register(SETTINGS_ID, "panelSize", {
    scope: "client", config: false, type: Object, default: {},
  });
  game.settings.register(SETTINGS_ID, "clientView", {
    scope: "client", config: false, type: Object, default: {},
    onChange: (value) => view?.receive(readClientView(value)),
  });
  game.settings.register(SETTINGS_ID, "actorFavorites", {
    scope: "client", config: false, type: Object, default: {},
    onChange: (value) => favorites?.receive(readFavorites(value)),
  });
  game.keybindings.register(MODULE_ID, "openPanel", {
    name: "Sano’s Portrait FX: управление портретами",
    hint: "Открыть панель показа персонажей и эффектов FXMaster+.",
    editable: [{ key: "KeyP", modifiers: ["Alt"] }],
    restricted: false, onDown: () => { if (game.user.isGM) panel?.toggle(); else playerControls?.toggle(); return true; },
  });
  game.modules.get(MODULE_ID).api = { open: openPanel, close: () => panel?.close(), refresh: () => {
    if (!game.user.isGM) panel?.close();
    view?.receive(readClientView());
    favorites?.receive(readFavorites());
    renderWorld();
  } };
});

Hooks.once("ready", () => {
  const factory = viewerFxFactory();
  stage = new PortraitStage({
    runtimeFactory: factory ? (options) => createPortraitFxRuntime(factory, options) : null, reportError,
    canMove: () => true,
    canOpenPortrait: () => game.user.isGM,
    onOpenPortrait: (id) => panel?.openPortrait(id),
    onPositionChange: (id, x) => {
      const operation = game.user.isGM ? store.editPortrait(id, (portrait) => { portrait.x = x; }) : view.setPosition(id, x);
      operation.catch(() => {});
    },
    onFilterExpired: (portraitId, effectId, kind = "filter") => {
      if (game.user.isGM) store?.editPortrait(portraitId, (portrait) => {
        portrait[kind].enabled[effectId] = false;
      }).catch(() => {});
    },
  });
  view = new ClientPortraitView({
    read: () => readClientView(),
    write: (next) => game.settings.set(SETTINGS_ID, "clientView", {
      ...safeRecord(game.settings.get(SETTINGS_ID, "clientView")), [clientKey()]: next,
    }),
    onChange: renderWorld,
    onError: (error) => reportError("Не удалось сохранить расположение портретов на этом экране.", error),
  });
  preview = new GmPortraitPreview({
    isGM: () => game.user.isGM,
    onChange: () => { renderWorld(); panel?.render(); },
  });
  store = new PortraitStore({
    read: () => game.settings.get(SETTINGS_ID, STATE_KEY),
    write: (state) => game.settings.set(SETTINGS_ID, STATE_KEY, state),
    canWrite: () => game.user.isGM,
    onChange: () => { renderWorld(); panel?.render(); },
    onError: (error) => reportError("Не удалось сохранить настройки портретов.", error),
  });
  playerControls = new PlayerControls(view, { isGM: () => game.user.isGM });
  favorites = new FavoriteActors({
    read: () => readFavorites(),
    write: (next) => game.settings.set(SETTINGS_ID, "actorFavorites", {
      ...safeRecord(game.settings.get(SETTINGS_ID, "actorFavorites")), [clientKey()]: next,
    }),
    canWrite: () => game.user.isGM,
    onChange: () => panel?.updateFavoriteButtons(),
    onError: (error) => reportError("Не удалось сохранить избранных персонажей.", error),
  });
  panel = new PortraitPanel(store, {
    effectsAvailable: !!factory,
    favorites, preview,
    saveMacro: async (name, source, params) => {
      if (!game.user.isGM) throw new Error("Добавлять макросы может только GM.");
      if (savedTokenMagicMacros().some((macro) => macro.name === name)) throw new Error("Макрос с таким названием уже сохранён. Выбери другое название.");
      const macro = { id: `macro:${foundry.utils.randomID()}`, name, source, params: cleanTokenMagicParams(params) };
      await game.settings.set(SETTINGS_ID, "tokenMagicMacros", [...savedTokenMagicMacros(), macro]);
      return macro.id;
    },
    readPosition: () => game.settings.get(SETTINGS_ID, "panelPosition"),
    savePosition: (position) => game.settings.set(SETTINGS_ID, "panelPosition", position),
    readSize: () => game.settings.get(SETTINGS_ID, "panelSize"),
    saveSize: (size) => game.settings.set(SETTINGS_ID, "panelSize", size ?? {}),
    getPortraitHeight: (id) => {
      const card = stage.cards.get(id);
      return card ? parseFloat(card.media.style.height) : null;
    },
  });
  sidebarLayout = new SidebarLayout((rect) => { stage.setObstruction(rect); panel.updateHeightHint(); });
  renderWorld();
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM || !controls.tokens?.tools) return;
  controls.tokens.tools.fxPortraits = {
    name: "fxPortraits", title: "Sano’s Portrait FX: портреты и эффекты", icon: "fas fa-images",
    order: 90, button: true, visible: true,
    onChange: (_event, active) => { if (active !== false) panel?.toggle(); },
  };
});

for (const hook of ["createActor", "deleteActor"]) Hooks.on(hook, () => panel?.render());
window.addEventListener("resize", renderWorld);
for (const hook of ["collapseSidebar", "renderSidebar"]) Hooks.on(hook, () => sidebarLayout?.schedule());

window.addEventListener("beforeunload", () => { sidebarLayout?.destroy(); panel?.close(); playerControls?.destroy(); stage?.destroy(); });
