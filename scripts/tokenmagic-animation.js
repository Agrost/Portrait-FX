// Portrait-only extension: delay is measured in animation milliseconds.
// Split a frame at each start boundary so the other properties keep animating.
export function applyAnimationDelays(anime) {
  const delays = new Map(Object.entries(anime.animated ?? {})
    .filter(([, animation]) => animation.active !== false && Number.isFinite(animation.delay) && animation.delay > 0)
    .map(([effect, animation]) => [effect, animation.delay]));
  if (!delays.size) return;
  const animate = anime.animate;
  const autoDisableCheck = anime.autoDisableCheck;
  anime.autoDisableCheck = function () {
    if (!delays.size) autoDisableCheck.call(this);
  };
  anime.animate = function (frameTime) {
    let remaining = frameTime;
    do {
      const step = delays.size ? Math.min(remaining, ...delays.values()) : remaining;
      const waiting = [...delays.keys()].map((effect) => [effect, this.animated[effect], this.animated[effect].active]);
      for (const [, animation] of waiting) animation.active = false;
      try { animate.call(this, step); }
      finally {
        for (const [effect, animation, active] of waiting) {
          animation.active = active;
          const delay = delays.get(effect) - step;
          if (delay > 0) delays.set(effect, delay);
          else delays.delete(effect);
        }
      }
      remaining -= step;
    } while (remaining > 0);
  };
}
