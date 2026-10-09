import { boundedNumber } from "./model.js";

export const HEIGHT_PRESETS = [
  { id: "small", key: "smallHeight", label: "Маленький", value: 450 },
  { id: "normal", key: "normalHeight", label: "Обычный", value: 500 },
  { id: "large", key: "largeHeight", label: "Большой", value: 560 },
];

export function normalizeHeightPresets(values = {}) {
  return Object.fromEntries(HEIGHT_PRESETS.map(({ id, value }) =>
    [id, boundedNumber(values?.[id] ?? value, 100, 700, value)]));
}
