// Measure Foundry's sidebar itself, never floating module windows. The public
// Sidebar.element/expanded API works in v13/v14; IDs also cover initial render.
export function sidebarObstruction({ document, window, sidebar }) {
  const element = sidebar?.element;
  const root = element?.getBoundingClientRect ? element : element?.[0];
  const content = document.getElementById("sidebar-content");
  const tabs = document.getElementById("sidebar-tabs");
  const sidebarRoot = root ?? document.getElementById("sidebar");
  const candidates = sidebar?.expanded === false
    ? [tabs, sidebarRoot].filter((node) => node === tabs || node?.getBoundingClientRect().width <= 80)
    : [sidebarRoot, content, tabs];
  const bounds = [];
  for (const node of new Set(candidates.filter(Boolean))) {
    if (!node.isConnected || node.hidden || !node.getClientRects().length) continue;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.left >= window.innerWidth) continue;
    bounds.push(rect);
  }
  if (!bounds.length) return null;
  return {
    left: Math.max(0, Math.min(...bounds.map((rect) => rect.left))),
    right: Math.min(window.innerWidth, Math.max(...bounds.map((rect) => rect.right))),
    top: Math.min(...bounds.map((rect) => rect.top)),
    bottom: Math.max(...bounds.map((rect) => rect.bottom)),
  };
}

export class SidebarLayout {
  constructor(onChange) {
    this.onChange = onChange;
    this.frame = null;
    this.signature = undefined;
    this.targets = [];
    this.schedule = () => {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => { this.frame = null; this.refresh(); });
    };
    this.mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList" || this.targets.includes(record.target))) this.schedule();
    });
    this.sizes = new ResizeObserver(this.schedule);
    this.onTransition = (event) => { if (this.targets.includes(event.target)) this.schedule(); };
    this.mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    document.addEventListener("transitionend", this.onTransition, true);
    window.addEventListener("resize", this.schedule);
    this.refresh();
  }

  refresh() {
    const root = globalThis.ui?.sidebar?.element;
    const elements = [root?.getBoundingClientRect ? root : root?.[0], ...["sidebar", "sidebar-content", "sidebar-tabs"].map((id) => document.getElementById(id))].filter(Boolean);
    const targets = new Set();
    for (const element of elements) {
      for (let node = element; node; node = node.parentElement) targets.add(node);
    }
    if (targets.size !== this.targets.length || this.targets.some((node) => !targets.has(node))) {
      this.targets = [...targets];
      this.sizes.disconnect();
      this.targets.forEach((node) => this.sizes.observe(node));
    }
    const rect = sidebarObstruction({ document, window, sidebar: globalThis.ui?.sidebar });
    const signature = JSON.stringify(rect);
    if (this.signature !== signature) { this.signature = signature; this.onChange(rect); }
  }

  destroy() {
    this.mutations.disconnect();
    this.sizes.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    document.removeEventListener("transitionend", this.onTransition, true);
    window.removeEventListener("resize", this.schedule);
  }
}
