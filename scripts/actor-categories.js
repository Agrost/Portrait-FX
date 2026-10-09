import { safeRecord } from "./model.js";

export function normalizeCategories(value) {
  const source = safeRecord(value);
  const seen = new Set();
  const categories = (Array.isArray(source.categories) ? source.categories : []).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id) || typeof item.name !== "string" || !item.name.trim()) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name.trim() }];
  });
  const assignments = Object.fromEntries(Object.entries(safeRecord(source.assignments)).flatMap(([id, ids]) => {
    const valid = [...new Set((Array.isArray(ids) ? ids : []).filter((category) => seen.has(category)))];
    return valid.length ? [[id, valid]] : [];
  }));
  return { categories, assignments };
}

export class ActorCategories {
  constructor({ read, write, canWrite, onChange, onError }) {
    Object.assign(this, { read, write, canWrite, onChange, onError });
    this.state = normalizeCategories(read());
    this.pending = Promise.resolve();
  }

  receive(value) {
    const next = normalizeCategories(value);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange?.();
  }

  change(mutate) {
    const operation = this.pending.then(async () => {
      if (!this.canWrite()) throw new Error("Изменять категории может только GM.");
      const next = normalizeCategories(this.read());
      mutate(next);
      const result = normalizeCategories(next);
      await this.write(result);
      this.receive(result);
    });
    this.pending = operation.catch((error) => this.onError?.(error));
    return operation;
  }

  save(id, name) {
    return this.change((state) => {
      const clean = typeof name === "string" ? name.trim() : "";
      if (!id || !clean) throw new Error("Укажи название категории.");
      if (state.categories.some((item) => item.id !== id && item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
        throw new Error("Категория с таким названием уже есть.");
      }
      const existing = state.categories.find((item) => item.id === id);
      if (existing) existing.name = clean;
      else state.categories.push({ id, name: clean });
    });
  }

  assign(actorId, categoryId, enabled) {
    return this.change((state) => {
      if (!actorId || !state.categories.some((item) => item.id === categoryId)) throw new Error("Категория недоступна.");
      const ids = state.assignments[actorId] ?? [];
      state.assignments[actorId] = enabled ? [...new Set([...ids, categoryId])] : ids.filter((id) => id !== categoryId);
    });
  }
}
