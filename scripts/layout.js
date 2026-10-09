import { boundedNumber } from "./model.js";

export function automaticX(index, count) {
  return 100 * (index + 0.5) / Math.max(1, count);
}

export function portraitNeighbor(portraits, id, direction) {
  if (direction !== -1 && direction !== 1) return null;
  const portrait = portraits.find((item) => item.id === id);
  if (!portrait) return null;
  const group = portrait.visible ? portraits.filter((item) => item.visible) : portraits;
  return group[group.indexOf(portrait) + direction] ?? null;
}

export function displayedX(portrait, index, count, width, viewportWidth) {
  const requested = portrait.x ?? automaticX(index, count);
  const edge = Math.min(50, (width / 2 + 16) / Math.max(1, viewportWidth) * 100);
  return boundedNumber(requested, edge, 100 - edge, 50);
}

export function portraitArea(viewportWidth, viewportHeight, bottom, height, obstruction) {
  const full = { left: 0, width: viewportWidth };
  if (!obstruction || obstruction.bottom <= viewportHeight - bottom - height || obstruction.top >= viewportHeight - bottom) return full;
  if (obstruction.right <= 0 || obstruction.left >= viewportWidth) return full;
  const before = Math.max(0, Math.min(viewportWidth, obstruction.left - 16));
  const after = Math.max(0, Math.min(viewportWidth, obstruction.right + 16));
  return before >= viewportWidth - after ? { left: 0, width: before } : { left: after, width: viewportWidth - after };
}

export function screenX(portrait, index, count, width, viewportWidth, area) {
  return (area.left + displayedX(portrait, index, count, width, area.width) / 100 * area.width) / viewportWidth * 100;
}

export function localX(center, width, area) {
  return displayedX({ x: (center - area.left) / Math.max(1, area.width) * 100 }, 0, 1, width, area.width);
}

export function panelPosition(position, width, viewportWidth, viewportHeight) {
  return {
    left: boundedNumber(position.left, 8, Math.max(8, viewportWidth - width - 8), 8),
    top: boundedNumber(position.top, 8, Math.max(8, viewportHeight - 160), 85),
  };
}

export function panelSize(size, viewportWidth, availableHeight) {
  const maxWidth = Math.max(1, viewportWidth - 16);
  const maxHeight = Math.max(1, availableHeight);
  return {
    width: boundedNumber(size?.width ?? 430, Math.min(320, maxWidth), maxWidth, Math.min(430, maxWidth)),
    height: size?.height == null ? null : boundedNumber(size.height, Math.min(200, maxHeight), maxHeight, Math.min(500, maxHeight)),
  };
}
