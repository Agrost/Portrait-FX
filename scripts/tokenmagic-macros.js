import { cleanTokenMagicParams } from "./tokenmagic-data.js";

// This collector runs in a disposable worker, with a portrait standing in for
// the selected token. Only captured filter data returns to the Foundry page.
export async function collectTokenMagicMacro(source, portrait = {}, presets = []) {
  const copy = (value) => structuredClone(value);
  let filters = [];
  const unsupported = () => { throw new Error("Поддерживаются только фильтры и анимации TokenMagic."); };
  const resolveParams = (value) => {
    if (typeof value === "string") value = presets.find((preset) => preset.name === value)?.params;
    if (!Array.isArray(value)) throw new Error("Макрос не передал список фильтров TokenMagic.");
    return copy(value);
  };
  const add = async (params) => {
    for (const raw of resolveParams(params)) {
      const index = filters.findIndex((item) => raw.filterId && item.filterId === raw.filterId && item.filterType === raw.filterType);
      if (index < 0) filters.push(raw);
      else filters[index] = { ...filters[index], ...raw };
    }
    if (filters.length > 64) throw new Error("В макросе больше 64 фильтров.");
    return true;
  };
  const remove = async (id) => { filters = id ? filters.filter((item) => item.filterId !== id) : []; };
  const target = {
    id: portrait.id ?? "portrait", name: portrait.name ?? "Портрет",
    x: 0, y: 0, w: 100, h: portrait.height ?? 500,
  };
  target.document = {
    id: target.id, name: target.name, isOwner: true, documentName: "Token",
    texture: { src: portrait.src ?? "" },
    getFlag: (namespace, key) => namespace === "tokenmagic" && key === "filters"
      ? copy(filters.map((params) => ({ tmFilters: { tmFilterId: params.filterId, tmParams: params } }))) : undefined,
    update: unsupported, setFlag: unsupported, unsetFlag: unsupported,
  };
  target.document.object = target;
  const hasId = (id) => filters.some((item) => item.filterId === id);
  const hasType = (type) => filters.some((item) => item.filterType === type);
  Object.assign(target, {
    TMFXaddFilters: add, TMFXaddUpdateFilters: add, TMFXupdateFilters: add,
    TMFXdeleteFilters: remove, TMFXhasFilterId: hasId, TMFXhasFilterType: hasType,
  });
  const api = {
    addFilters: (_target, params) => add(params),
    addUpdateFilters: (_target, params) => add(params),
    updateFiltersByPlaceable: (_target, params) => add(params),
    addFiltersOnSelected: add, addUpdateFiltersOnSelected: add, updateFiltersOnSelected: add,
    addFiltersOnTargeted: add, addUpdateFiltersOnTargeted: add, updateFiltersOnTargeted: add,
    deleteFilters: (_target, id) => remove(id), deleteFiltersOnSelected: remove, deleteFiltersOnTargeted: remove,
    hasFilterId: (_target, id) => hasId(id), hasFilterType: (_target, type) => hasType(type),
    getPresets: () => copy(presets), getPreset: (name) => copy(presets.find((preset) => preset.name === (name?.name ?? name))?.params ?? []),
    addPreset: (_name, params) => add(params),
  };
  const scope = {
    TokenMagic: api, token: target,
    canvas: { ready: true, tokens: { controlled: [target], placeables: [target], get: () => target } },
    game: {
      user: { id: "portrait-gm", isGM: true, targets: new Set([target]) },
      modules: { get: (id) => id === "tokenmagic" ? { active: true, api } : undefined },
      settings: { get: () => undefined, set: unsupported },
    },
    foundry: { utils: { deepClone: copy, duplicate: copy, randomID: () => Math.random().toString(36).slice(2) } },
    ui: { notifications: { info: () => {}, warn: (message) => { throw new Error(message); }, error: (message) => { throw new Error(message); } } },
    document: undefined, fetch: undefined, XMLHttpRequest: undefined, WebSocket: undefined,
    Worker: undefined, importScripts: undefined,
  };
  scope.globalThis = scope; scope.window = scope; scope.self = scope;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(scope), `"use strict";\n${source}`)(...Object.values(scope));
  if (!filters.length) throw new Error("Макрос не добавил фильтры TokenMagic. Нужен код применения эффекта.");
  return filters;
}

export async function importTokenMagicMacro(source, portrait, { api = globalThis.TokenMagic, timeout = 5000 } = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error("Добавлять макросы может только GM.");
  if (!source?.trim()) throw new Error("Вставь JavaScript-код макроса.");
  if (source.length > 65536) throw new Error("Код макроса слишком большой (максимум 64 КБ).");
  if (!api?.filterTypes) throw new Error("Включи Token Magic FX.");
  const script = `onmessage = async ({data}) => {
    try { postMessage({params: await (${collectTokenMagicMacro.toString()})(data.source, data.portrait, data.presets)}); }
    catch (error) { postMessage({error: error.name === "SyntaxError" ? "Ошибка в JavaScript-коде: " + error.message : error.message || String(error)}); }
  };`;
  const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
  let worker;
  let timer;
  try {
    worker = new Worker(url);
    const raw = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Импорт остановлен: макрос выполняется дольше 5 секунд.")), timeout);
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.params);
      worker.onerror = (event) => { event.preventDefault(); reject(new Error(event.message || "Не удалось обработать макрос.")); };
      worker.postMessage({ source, portrait: { id: portrait.id, name: portrait.name, src: portrait.src, height: portrait.height }, presets: api.getPresets?.() ?? [] });
    });
    const params = cleanTokenMagicParams(raw);
    for (const filter of params) {
      if (typeof api.filterTypes[filter.filterType] !== "function") throw new Error(`Неизвестный фильтр TokenMagic: ${filter.filterType}`);
    }
    return params;
  } finally {
    clearTimeout(timer);
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}
