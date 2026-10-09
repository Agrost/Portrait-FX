export function viewerFxFactory() {
  const modules = globalThis.game?.modules;
  const plus = modules?.get("fxmaster-plus");
  const factory = plus?.api?.createViewerFxRuntime;
  return modules?.get("fxmaster")?.active && plus?.active && typeof factory === "function" ? factory : null;
}
