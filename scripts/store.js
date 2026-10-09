import { clone, normalizeState, KINDS, registry } from "./model.js";
import { automaticX, portraitNeighbor } from "./layout.js";
import { randomizeTokenMagicParams, tokenMagicApi } from "./tokenmagic-data.js";

export class PortraitStore {
  constructor({ read, write, canWrite, onChange, onError }) {
    this.read = read;
    this.write = write;
    this.canWrite = canWrite;
    this.onChange = onChange;
    this.onError = onError;
    this.state = normalizeState(read());
    this.pending = Promise.resolve();
  }

  receive(value) {
    const next = normalizeState(value);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange?.(clone(this.state));
  }

  change(mutate) {
    if (!this.canWrite()) return Promise.reject(new Error("Изменять портреты может только GM."));
    const operation = this.pending.then(async () => {
      if (!this.canWrite()) throw new Error("Изменять портреты может только GM.");
      const next = normalizeState(this.read());
      await mutate(next);
      next.revision += 1;
      const result = normalizeState(next);
      await this.write(result);
      this.receive(result);
      return clone(result);
    });
    // A failed update must not prevent subsequent edits.
    this.pending = operation.catch((error) => { this.onError?.(error); });
    return operation;
  }

  editPortrait(id, mutate) {
    return this.change((state) => {
      const portrait = state.portraits.find((item) => item.id === id);
      if (portrait) mutate(portrait, state);
    });
  }

  setAllVisible(visible) {
    return this.change((state) => {
      for (const portrait of state.portraits) {
        portrait.visible = visible;
        if (visible) portrait.x = null;
      }
    });
  }

  applyEffect({ ids = null, kind, effectId, values }) {
    if (!KINDS.includes(kind) || (kind === "tokenmagic" ? !tokenMagicApi() : !registry(kind)[effectId])) return Promise.reject(new Error("Эффект недоступен."));
    const options = clone(values);
    if (kind === "tokenmagic") {
      try {
        options.params = randomizeTokenMagicParams(options.params);
        if (!options.params.length) throw new Error("В наборе нет фильтров TokenMagic.");
      } catch (error) { return Promise.reject(error); }
    }
    const targets = ids === null ? null : new Set(ids);
    return this.change((state) => {
      for (const portrait of state.portraits) {
        if (targets && !targets.has(portrait.id)) continue;
        portrait[kind].enabled[effectId] = true;
        portrait[kind].options[effectId] = clone(options);
      }
    });
  }

  removePortrait(id) {
    return this.change((state) => { state.portraits = state.portraits.filter((portrait) => portrait.id !== id); });
  }

  clearAllEffects() {
    return this.change((state) => {
      for (const portrait of state.portraits) {
        for (const kind of KINDS) portrait[kind].enabled = {};
      }
    });
  }

  swapPortrait(id, direction) {
    return this.change((state) => {
      const neighbor = portraitNeighbor(state.portraits, id, direction);
      if (!neighbor) return;
      const index = state.portraits.findIndex((portrait) => portrait.id === id);
      const neighborIndex = state.portraits.indexOf(neighbor);
      const portrait = state.portraits[index];
      // Coordinates belong to slots; the rest of the settings follow the actor.
      [portrait.x, neighbor.x] = [neighbor.x, portrait.x];
      [state.portraits[index], state.portraits[neighborIndex]] = [neighbor, portrait];
    });
  }

  arrangePortraits() {
    return this.change((state) => {
      state.positionEpoch += 1;
      for (const portrait of state.portraits) {
        if (portrait.visible) portrait.x = null;
      }
    });
  }

  reorderPortrait(id, targetId, after = false) {
    return this.change((state) => {
      const index = state.portraits.findIndex((portrait) => portrait.id === id);
      const targetIndex = state.portraits.findIndex((portrait) => portrait.id === targetId);
      if (index < 0 || targetIndex < 0 || id === targetId) return;
      const order = [...state.portraits];
      const [portrait] = order.splice(index, 1);
      const insertion = order.findIndex((item) => item.id === targetId) + Number(after);
      order.splice(insertion, 0, portrait);
      if (order.every((item, i) => item.id === state.portraits[i].id)) return;
      state.portraits = order;
      // Automatic slots make the screen follow the new roster order even after manual movement.
      for (const item of state.portraits) item.x = null;
    });
  }

  movePortrait(id, delta) {
    return this.change((state) => {
      const portrait = state.portraits.find((item) => item.id === id);
      if (!portrait) return;
      const visible = state.portraits.filter((item) => item.visible);
      const group = portrait.visible ? visible : state.portraits;
      portrait.x = (portrait.x ?? automaticX(group.findIndex((item) => item.id === id), group.length)) + delta;
    });
  }
}
