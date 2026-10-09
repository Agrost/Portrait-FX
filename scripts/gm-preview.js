import { clone } from "./model.js";

// Session-only visibility for one hidden portrait. Nothing here writes settings
// or changes the shared state received by other clients.
export class GmPortraitPreview {
  constructor({ isGM = () => false, onChange } = {}) {
    this.isGM = isGM;
    this.onChange = onChange;
    this.id = null;
  }

  isActive(world, id) {
    return this.isGM() && this.id === id && world.portraits.some((portrait) => portrait.id === id && !portrait.visible);
  }

  toggle(world, id) {
    if (!this.isGM() || !world.portraits.some((portrait) => portrait.id === id && !portrait.visible)) return;
    this.id = this.id === id ? null : id;
    this.onChange?.();
  }

  project(local, world = local) {
    const result = clone(local);
    if (!this.isActive(world, this.id)) { this.id = null; return result; }
    const portrait = result.portraits.find((item) => item.id === this.id);
    if (portrait) portrait.visible = true;
    return result;
  }
}
