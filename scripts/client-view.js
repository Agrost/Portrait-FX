import { clone, safeRecord, boundedNumber } from "./model.js";
import { automaticX } from "./layout.js";

export function normalizeClientView(value) {
  const record = safeRecord(value);
  const positions = Object.fromEntries(Object.entries(safeRecord(record.positions))
    .filter(([id, x]) => !["__proto__", "prototype", "constructor"].includes(id) && typeof x === "number" && Number.isFinite(x))
    .map(([id, x]) => [id, boundedNumber(x, 0, 100, 50)]));
  const mirrors = Object.fromEntries(Object.entries(safeRecord(record.mirrors))
    .filter(([id, mirrored]) => !["__proto__", "prototype", "constructor"].includes(id) && typeof mirrored === "boolean"));
  const positionEpoch = Math.floor(boundedNumber(record.positionEpoch ?? 0, 0, Number.MAX_SAFE_INTEGER, 0));
  return { hidden: record.hidden === true, positions, mirrors, positionEpoch };
}

// This controller reads/writes client settings only. The shared portrait state
// is projected into a local view, never mutated by a player's actions.
export class ClientPortraitView {
  constructor({ read, write, onChange, onError }) {
    this.read = read;
    this.write = write;
    this.onChange = onChange;
    this.onError = onError;
    this.state = normalizeClientView(read());
    this.pending = Promise.resolve();
  }

  receive(value) {
    const next = normalizeClientView(value);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange?.();
  }

  change(mutate) {
    const operation = this.pending.then(async () => {
      const next = normalizeClientView(this.read());
      mutate(next);
      await this.write(clone(next));
      this.receive(next);
    });
    this.pending = operation.catch((error) => this.onError?.(error));
    return operation;
  }

  toggleHidden() { return this.change((next) => { next.hidden = !next.hidden; }); }
  setPosition(id, x, positionEpoch = this.state.positionEpoch) {
    return this.change((next) => {
      this.syncPositionEpoch(next, positionEpoch);
      next.positions[id] = boundedNumber(x, 0, 100, 50);
    });
  }
  resetPositions() { return this.change((next) => { next.positions = {}; }); }

  syncPositionEpoch(next, positionEpoch) {
    if (next.positionEpoch === positionEpoch) return;
    next.positions = {};
    next.positionEpoch = positionEpoch;
  }

  flipPortrait(world, id) {
    return this.change((next) => {
      const portrait = world.portraits.find((item) => item.id === id && item.visible);
      if (!portrait) return;
      next.mirrors[id] = !(next.mirrors[id] ?? portrait.mirrored);
    });
  }

  movePortrait(world, id, delta) {
    return this.change((next) => {
      this.syncPositionEpoch(next, world.positionEpoch ?? 0);
      const visible = world.portraits.filter((item) => item.visible);
      const index = visible.findIndex((item) => item.id === id);
      if (index < 0) return;
      const x = next.positions[id] ?? visible[index].x ?? automaticX(index, visible.length);
      next.positions[id] = boundedNumber(x + delta, 0, 100, 50);
    });
  }

  project(world, { usePositions = true, useMirrors = true } = {}) {
    const result = clone(world);
    const currentPositions = this.state.positionEpoch === (world.positionEpoch ?? 0);
    for (const portrait of result.portraits) {
      if (this.state.hidden) portrait.visible = false;
      if (usePositions && currentPositions && Object.hasOwn(this.state.positions, portrait.id)) portrait.x = this.state.positions[portrait.id];
      if (useMirrors && Object.hasOwn(this.state.mirrors, portrait.id)) portrait.mirrored = this.state.mirrors[portrait.id];
    }
    return result;
  }
}
