export function normalizeFavorites(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((id) => typeof id === "string" && id.length > 0))];
}

export class FavoriteActors {
  constructor({ read, write, canWrite, onChange, onError }) {
    Object.assign(this, { read, write, canWrite, onChange, onError });
    this.state = normalizeFavorites(read());
    this.pending = Promise.resolve();
  }

  receive(value) {
    const next = normalizeFavorites(value);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange?.();
  }

  toggle(id) {
    if (!this.canWrite()) return Promise.reject(new Error("Избранное доступно только GM."));
    if (typeof id !== "string" || !id) return Promise.reject(new Error("Персонаж не выбран."));
    const operation = this.pending.then(async () => {
      if (!this.canWrite()) throw new Error("Избранное доступно только GM.");
      const current = normalizeFavorites(this.read());
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      await this.write([...next]);
      this.receive(next);
    });
    this.pending = operation.catch((error) => this.onError?.(error));
    return operation;
  }
}
