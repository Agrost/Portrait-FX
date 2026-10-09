// Coordinates refer to the final flex layout, rather than a moving animation frame.
export function rosterInsertionIndex(items, x, y) {
  if (!items.length) return 0;
  const rows = [];
  for (const item of items) {
    let row = rows.find((candidate) => item.top < candidate.bottom && item.bottom > candidate.top);
    if (!row) { row = { top: item.top, bottom: item.bottom, items: [] }; rows.push(row); }
    row.items.push(item);
    row.top = Math.min(row.top, item.top); row.bottom = Math.max(row.bottom, item.bottom);
  }
  rows.sort((a, b) => a.top - b.top);
  const row = rows.reduce((closest, candidate) =>
    Math.abs(y - (candidate.top + candidate.bottom) / 2) < Math.abs(y - (closest.top + closest.bottom) / 2)
      ? candidate : closest);
  const ordered = rows.flatMap((candidate) => candidate.items.sort((a, b) => a.left - b.left));
  const next = row.items.find((item) => x < (item.left + item.right) / 2);
  return next ? ordered.indexOf(next) : ordered.indexOf(row.items.at(-1)) + 1;
}
