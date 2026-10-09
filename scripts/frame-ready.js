// The FXMaster+ viewer exposes its PIXI application. Check the public display
// tree rather than treating hasActiveFilters() as proof of a rendered frame.
function textureReady(value) {
  if (!value || typeof value !== "object" || !("baseTexture" in value)) return true;
  // FXMaster uses EMPTY for disabled masks/region fades, and Neon restores it
  // after each halo pass. PIXI's EMPTY intentionally has valid=false: it is a
  // sentinel, not an asset awaiting a load event.
  if (value === globalThis.PIXI?.Texture?.EMPTY) return true;
  return !value.destroyed && value.valid !== false && value.baseTexture?.valid !== false;
}

export function frameReady(runtime) {
  runtime.assertTokenMagicReady?.();
  const app = runtime.app;
  if (!app?.stage || !app.renderer?.render) throw new Error("FXMaster+ viewer renderer is unavailable");
  function ready(node) {
    if (node.visible === false || node.renderable === false) return true;
    if (!textureReady(node.texture)) return false;
    for (const filter of node.filters ?? []) {
      for (const uniform of Object.values(filter.uniforms ?? {})) {
        if (Array.isArray(uniform) ? !uniform.every(textureReady) : !textureReady(uniform)) return false;
      }
    }
    return (node.children ?? []).every(ready);
  }
  if (!ready(app.stage)) return false;
  app.renderer.render(app.stage);
  return true;
}
