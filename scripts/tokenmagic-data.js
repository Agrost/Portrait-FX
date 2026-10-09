const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const INTERNAL = new Set([
  "placeableId", "placeableType", "filterInternalId", "filterOwner", "updateId", "dummy",
  "apply", "destroy", "getPlaceable", "assignPlaceable", "calculatePadding", "filterTransform",
  "activateTransform", "handleTransform", "setTMParams", "normalizeTMParams", "preComputation",
  "anime", "targetPlaceable", "placeableImg", "boundsPadding", "currentPadding", "originalPadding",
  "rawPadding", "recalculatePadding", "uniforms", "program",
]);
const HIDDEN = new Set(["filterType", "filterId", "enabled", "rank", "zOrder", "gridPadding", "autoDestroy", "autoDisable"]);
export const COPIED_TOKEN = "copied-token";

export function tokenMagicApi() {
  return globalThis.game?.modules?.get("tokenmagic")?.active ? globalThis.TokenMagic : null;
}

export function savedTokenMagicMacros() {
  try {
    const value = globalThis.game?.settings?.get?.("fx-portraits", "tokenMagicMacros");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function safeValue(value, depth = 0) {
  if (depth > 8) throw new Error("Слишком сложные параметры TokenMagic.");
  if (value === Infinity) return "Infinity";
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => safeValue(item, depth + 1));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !UNSAFE.has(key))
      .map(([key, item]) => [key, safeValue(item, depth + 1)]));
  }
  throw new Error("Недопустимое значение параметра TokenMagic.");
}

export function cleanTokenMagicParams(params) {
  if (!Array.isArray(params) || params.length > 64) throw new Error("Ожидается набор из не более 64 фильтров TokenMagic.");
  return params.map((raw) => {
    if (!raw || typeof raw.filterType !== "string") throw new Error("Не указан тип фильтра TokenMagic.");
    const clean = safeValue(raw);
    for (const key of INTERNAL) delete clean[key];
    for (const key of Object.keys(clean.animated ?? {})) {
      if (INTERNAL.has(key) || UNSAFE.has(key) || HIDDEN.has(key)) delete clean.animated[key];
    }
    return clean;
  });
}

export function tokenMagicRegistry(state) {
  if (!tokenMagicApi()?.filterTypes) return {};
  const result = { [COPIED_TOKEN]: { label: "Эффекты с выбранного токена", params: [], tokenMagic: true } };
  for (const preset of tokenMagicApi().getPresets?.() ?? []) {
    try {
      const id = `preset:${preset.name}`;
      result[id] = { label: String(preset.name), params: cleanTokenMagicParams(preset.params), tokenMagic: true };
    } catch (error) { console.warn("FX Portraits | Invalid TokenMagic preset", preset.name, error); }
  }
  for (const macro of savedTokenMagicMacros()) {
    if (!macro?.id?.startsWith("macro:") || typeof macro.name !== "string") continue;
    try { result[macro.id] = { label: macro.name, params: cleanTokenMagicParams(macro.params), tokenMagic: true }; }
    catch { /* An invalid saved entry must not hide the other effects. */ }
  }
  for (const [id, saved] of Object.entries(state?.options ?? {})) {
    if (!UNSAFE.has(id) && !result[id] && Array.isArray(saved.params)) {
      result[id] = { label: id.replace(/^preset:/, ""), params: [], tokenMagic: true };
    }
  }
  return result;
}

export function tokenMagicDescriptor(effect, saved = {}) {
  if (!effect) return undefined;
  const params = cleanTokenMagicParams(saved.params ?? effect.params ?? []);
  const parameters = {};
  params.forEach((filter, index) => {
    for (const [property, value] of Object.entries(filter)) {
      if (HIDDEN.has(property) || INTERNAL.has(property) || value === null) continue;
      let type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : typeof value === "string" ? "text" : null;
      if (!type) continue;
      const color = /color$/i.test(property) && typeof value === "number";
      if (color) type = "color";
      const key = `tm-${index}-${property}`;
      parameters[key] = {
        type, label: `${params.length > 1 ? `${index + 1} · ` : ""}${filter.filterType}: ${property}`,
        value: color ? { value: `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, "0")}`, apply: true } : value,
        index, property, tokenMagic: true,
      };
    }
  });
  return { ...effect, params, parameters };
}

export function tokenMagicEditedParams(descriptor, values) {
  const params = cleanTokenMagicParams(descriptor.params);
  for (const [key, definition] of Object.entries(descriptor.parameters)) {
    const value = values[key];
    params[definition.index][definition.property] = definition.type === "color" ? parseInt(value.value.slice(1), 16) : value;
  }
  return { params };
}

export function tokenMagicRuntimeState(state = {}) {
  if (!tokenMagicApi()?.filterTypes) return { enabled: {}, options: {} };
  const effects = tokenMagicRegistry(state);
  const enabled = {}, options = {};
  for (const [id, on] of Object.entries(state.enabled ?? {})) {
    if (!on || !effects[id]) continue;
    const params = cleanTokenMagicParams(state.options?.[id]?.params ?? effects[id].params);
    if (!params.length) continue;
    enabled[id] = true;
    options[id] = { params };
  }
  return { enabled, options };
}

export function selectedTokenMagicParams() {
  const tokens = globalThis.canvas?.tokens?.controlled ?? [];
  if (tokens.length !== 1) throw new Error("Выбери ровно один токен на сцене.");
  const flags = tokens[0].document.getFlag("tokenmagic", "filters") ?? [];
  const params = cleanTokenMagicParams(flags.map((flag) => flag.tmFilters.tmParams));
  if (!params.length) throw new Error("У выбранного токена нет эффектов TokenMagic.");
  return params;
}

// Resolve randomized values once on the GM, so all clients receive the same
// snapshot. Constructors alone do not apply TokenMagic's randomized descriptor.
export function randomizeTokenMagicParams(raw, random = Math.random) {
  const params = cleanTokenMagicParams(raw);
  for (const filter of params) {
    const randomized = filter.randomized;
    if (!randomized || randomized.active === false) continue;
    for (const [property, options] of Object.entries(randomized)) {
      if (property === "active" || INTERNAL.has(property) || UNSAFE.has(property) || !options || options.active === false) continue;
      let value;
      const list = Array.isArray(options) ? options : options.list;
      if (list?.length) value = list[Math.floor(random() * list.length)];
      else if (typeof options.val1 === "boolean") value = random() > 0.5;
      else if (options.color && options.type !== "any") {
        const amount = random();
        const first = typeof options.val1 === "string" ? parseInt(options.val1.replace("#", ""), 16) : options.val1;
        const second = typeof options.val2 === "string" ? parseInt(options.val2.replace("#", ""), 16) : options.val2;
        value = [16, 8, 0].reduce((color, shift) => color | (Math.round(((first >> shift & 255) * (1 - amount)) + (second >> shift & 255) * amount) << shift), 0);
      } else {
        const min = Math.min(options.val1, options.val2), max = Math.max(options.val1, options.val2);
        const step = Number(options.step ?? 1);
        if (![min, max, step].every(Number.isFinite) || step <= 0) throw new Error("Некорректный диапазон случайного параметра TokenMagic.");
        value = Number((min + Math.floor(random() * (Math.floor((max - min) / step) + 1)) * step).toPrecision(12));
      }
      const set = (path) => {
        const parts = path.split(".");
        if (parts.some((key) => UNSAFE.has(key) || INTERNAL.has(key))) throw new Error("Недопустимый случайный параметр TokenMagic.");
        let target = filter;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = value;
      };
      set(property);
      if (typeof options.link === "string") set(options.link);
    }
    // Store the chosen values; future edits/reloads should not roll them again.
    filter.randomized = { ...randomized, active: false };
  }
  return params;
}
