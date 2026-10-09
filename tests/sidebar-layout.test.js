import test from "node:test";
import assert from "node:assert/strict";
import { sidebarObstruction } from "../scripts/sidebar-layout.js";

function fixture() {
  const nodes = new Map();
  const add = (id, left, width, extra = {}) => {
    const node = { isConnected: true, hidden: false, style: { display: "block", visibility: "visible" },
      getClientRects: () => [1], getBoundingClientRect: () => ({ left, right: left + width, width, top: 0, bottom: 720, height: 720 }), ...extra };
    nodes.set(id, node); return node;
  };
  const document = { getElementById: (id) => nodes.get(id) ?? null };
  const window = { innerWidth: 1280, getComputedStyle: (node) => node.style };
  return { add, measure: (sidebar) => sidebarObstruction({ document, window, sidebar }) };
}

test("expanded Foundry sidebar includes its content and external tab strip", () => {
  const { add, measure } = fixture();
  const root = add("sidebar", 980, 300);
  add("sidebar-tabs", 940, 40);
  assert.deepEqual(measure({ element: root, expanded: true }), { left: 940, right: 1280, top: 0, bottom: 720 });
});

test("collapsed sidebar releases the content area but keeps visible tab strip", () => {
  const { add, measure } = fixture();
  const root = add("sidebar", 980, 300);
  add("sidebar-content", 980, 300);
  add("sidebar-tabs", 1240, 40);
  assert.deepEqual(measure({ element: root, expanded: false }), { left: 1240, right: 1280, top: 0, bottom: 720 });
});

test("hidden, detached and offscreen sidebar nodes reserve no space", () => {
  const { add, measure } = fixture();
  const root = add("sidebar", 980, 300, { hidden: true });
  add("sidebar-content", 980, 300, { isConnected: false });
  add("sidebar-tabs", 1280, 40);
  assert.equal(measure({ element: root, expanded: true }), null);
  root.hidden = false; root.style.visibility = "hidden";
  assert.equal(measure({ element: root, expanded: true }), null);
});

test("initial sidebar render can be measured by DOM IDs without an application", () => {
  const { add, measure } = fixture();
  add("sidebar-content", 970, 300);
  assert.deepEqual(measure(), { left: 970, right: 1270, top: 0, bottom: 720 });
});

test("FX Portraits floating window never reserves portrait space", () => {
  const { add, measure } = fixture();
  add("fx-portraits-panel", 800, 430);
  assert.equal(measure(), null);
  add("sidebar", 1240, 40);
  assert.deepEqual(measure({ expanded: false }), { left: 1240, right: 1280, top: 0, bottom: 720 });
});
