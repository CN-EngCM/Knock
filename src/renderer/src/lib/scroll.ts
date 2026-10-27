/** Shared scroll-behavior helpers used by MessageScroller and the virtualization hooks. */

/** True when the user's OS/browser requests reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Downgrades "smooth" to "auto" when reduced motion is requested; other values pass through. */
export function resolveScrollBehavior(behavior?: ScrollBehavior): ScrollBehavior {
  return behavior === "smooth" && !prefersReducedMotion() ? "smooth" : "auto"
}
