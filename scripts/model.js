import { tokenMagicRegistry } from "./tokenmagic-data.js";

export const MODULE_ID = "sanos-portrait-fx";
export const SETTINGS_ID = "fx-portraits";
export const STATE_KEY = "portraits";
export const INITIAL_STATE = { schemaVersion: 3, revision: 0, positionEpoch: 0, bottom: 80, portraits: [] };
export const KINDS = ["filter", "particle", "tokenmagic"];
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// These controls refer to scene objects or require a separate placement/paint editor.
export const OMITTED_PARAMETERS = new Set([
  "belowTokens", "belowTiles", "belowForeground", "aboveDarkness", "levels",
  "darknessActivationEnabled", "darknessActivationRange", "manualPlacement",
  "soundFxEnabled", "soundFxManualSoundIds", "lightSource", "movementMaskEnabled",
]);
export const CONTROL_TYPES = new Set([
  "checkbox", "boolean", "range", "number", "number-infinity", "color",
  "select", "multi-select", "text", "string", "file", "file-picker",
]);

export function clone(value) {
  return structuredClone(value);
}

export function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function effectState(value = {}) {
  const record = safeRecord(value);
  const enabled = Object.fromEntries(Object.entries(safeRecord(record.enabled))
    .filter(([key]) => !UNSAFE_KEYS.has(key)).map(([key, on]) => [key, on === true]));
  const options = Object.fromEntries(Object.entries(safeRecord(record.options))
    .filter(([key]) => !UNSAFE_KEYS.has(key)).map(([key, item]) => [key, safeRecord(item)]));
  return { enabled, options };
}

export function normalizeState(value) {
  const record = safeRecord(value);
  const ids = new Set();
  const portraits = [];
  for (const raw of Array.isArray(record.portraits) ? record.portraits : []) {
    if (!raw || typeof raw.id !== "string" || !raw.id || ids.has(raw.id)) continue;
    ids.add(raw.id);
    portraits.push({
      id: raw.id, actorId: String(raw.actorId ?? ""), name: String(raw.name ?? "Персонаж"),
      showName: raw.showName !== false,
      src: String(raw.src ?? ""), visible: raw.visible !== false && record.enabled !== false,
      height: boundedNumber(record.schemaVersion !== 3 && (raw.height === 400 || (record.schemaVersion !== 2 && raw.height === 320)) ? 500 : raw.height, 100, 700, 500),
      x: raw.x === null || raw.x === undefined ? null : boundedNumber(raw.x, 0, 100, 50),
      offsetY: boundedNumber(raw.offsetY ?? 0, -450, 450, 0),
      mirrored: raw.mirrored === true,
      filter: effectState(raw.filter), particle: effectState(raw.particle), tokenmagic: effectState(raw.tokenmagic),
    });
  }
  return {
    revision: boundedNumber(record.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    positionEpoch: Math.floor(boundedNumber(record.positionEpoch ?? 0, 0, Number.MAX_SAFE_INTEGER, 0)),
    schemaVersion: 3,
    bottom: boundedNumber(record.bottom, 0, 450, 80), portraits,
  };
}

export function newPortrait(actor, id, showName = true) {
  return {
    id, actorId: actor.id, name: actor.name, showName, src: actor.img, visible: true,
    height: 500, x: null, offsetY: 0, mirrored: false, filter: effectState(), particle: effectState(), tokenmagic: effectState(),
  };
}

export function registry(kind, state) {
  if (kind === "tokenmagic") return tokenMagicRegistry(state);
  const effects = kind === "filter" ? CONFIG.fxmaster?.filterEffects ?? {} : CONFIG.fxmaster?.particleEffects ?? {};
  return Object.fromEntries(Object.entries(effects).filter(([id]) => id.toLowerCase() !== "water"));
}

export function localize(value) {
  const text = String(value ?? "");
  return globalThis.game?.i18n?.has?.(text) ? game.i18n.localize(text) : text;
}

export function definitions(EffectClass) {
  return safeRecord(EffectClass?.parameters);
}

export function parameterValue(definition, stored) {
  const value = stored === undefined ? definition.value : stored;
  if (definition.type === "color") {
    const defaultColor = safeRecord(definition.value);
    const color = typeof value === "string" ? { value } : safeRecord(value);
    return { value: String(color.value ?? defaultColor.value ?? "#ffffff"), apply: (color.apply ?? defaultColor.apply) === true };
  }
  if (definition.type === "checkbox" || definition.type === "boolean") {
    return typeof value === "string" ? !["", "false", "0", "off"].includes(value.toLowerCase()) : !!value;
  }
  if (definition.type === "range" || definition.type === "number" || definition.type === "number-infinity") {
    if (definition.type === "number-infinity" && /^(infinity|inf|∞)$/i.test(String(value))) return "Infinity";
    const min = Number.isFinite(Number(definition.min)) ? Number(definition.min) : -Number.MAX_VALUE;
    const max = Number.isFinite(Number(definition.max)) ? Number(definition.max) : Number.MAX_VALUE;
    return boundedNumber(value, min, max, Number(definition.value) || 0);
  }
  if (definition.type === "multi-select") return Array.isArray(value) ? value.map(String) : [];
  return value === undefined ? "" : clone(value);
}

export function defaultValues(EffectClass, saved = {}) {
  return Object.fromEntries(Object.entries(definitions(EffectClass))
    .filter(([key, def]) => !UNSAFE_KEYS.has(key) && def && typeof def === "object")
    .map(([key, def]) => [key, parameterValue(def, saved[key])]));
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") return undefined;
    return item === Infinity ? "Infinity" : item;
  }));
}

// Keep FXMaster's parameter descriptors: particle effects consume wrapped values,
// and FXMaster itself expands its normalized ranges to the internal ranges.
export function runtimeOptions(EffectClass, saved) {
  const values = defaultValues(EffectClass, saved);
  const result = {};
  for (const [key, definition] of Object.entries(definitions(EffectClass))) {
    if (UNSAFE_KEYS.has(key) || !definition || typeof definition !== "object") continue;
    result[key] = { ...serializable(definition), value: values[key] };
  }
  for (const key of ["soundFxEnabled", "manualPlacement", "lightSource", "movementMaskEnabled", "darknessActivationEnabled"]) {
    if (result[key]) result[key].value = false;
  }
  for (const key of Object.keys(result)) {
    if (key.startsWith("tokenAvoidance")) result[key].value = false;
  }
  return result;
}

export function runtimeState(state, effects) {
  const enabled = {};
  const options = {};
  for (const [id, on] of Object.entries(state.enabled)) {
    if (!on || !effects[id]) continue;
    enabled[id] = true;
    options[id] = runtimeOptions(effects[id], state.options[id] ?? {});
  }
  return { enabled, options, soundFxEnabled: false };
}

export function conditionMatches(condition, values) {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.some((item) => conditionMatches(item, values));
  if (typeof condition === "function") {
    try { return !!condition({ get: (key) => values[key] }); } catch { return false; }
  }
  if (typeof condition !== "object") return true;
  return Object.entries(condition).every(([key, expected]) => values[key] === expected);
}

export function isParameterVisible(definition, values) {
  return conditionMatches(definition.showWhen, values)
    && !(definition.hideWhen && conditionMatches(definition.hideWhen, values));
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
