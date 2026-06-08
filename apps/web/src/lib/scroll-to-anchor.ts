type ScrollToAnchorOptions = {
  /** Pixels subtracted from the target's top — matches section[id] scroll-margin-top (index.css). */
  offset?: number;
  /** Smooth-scroll for the initial jump; corrections always snap instantly. */
  behavior?: ScrollBehavior;
  /** If set, history.replaceState to this hash once the initial scroll is issued. */
  updateHash?: string;
  /** How long (ms) to keep re-correcting for layout shift above the target. */
  settleMs?: number;
};

const DEFAULT_OFFSET = 80;
const DEFAULT_SETTLE_MS = 2500;
const TICK_MS = 100;
const TOLERANCE_PX = 2;
const STABLE_TICKS = 3;

// Keys that scroll the page — if the user presses one mid-settle, stop fighting them.
const INTERRUPT_KEYS = new Set([
  " ",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
]);

const noop = () => {};

/**
 * Scroll to an anchor (a `section[id]` or any Element) and keep it pinned while
 * the page settles. Returns a cancel function for effect cleanup / re-entry.
 *
 * Correctness idea: we target the *absolute document position*
 * (`rect.top + pageYOffset - offset`), not a viewport-relative one. Our own
 * smooth-scroll progress therefore never changes the target — only layout shift
 * *above* the anchor does, which is exactly what the settle loop re-corrects for.
 * That fixes the "first scroll lands short while content above lazy-loads" bug.
 */
export function scrollToAnchor(
  target: string | Element,
  opts: ScrollToAnchorOptions = {}
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return noop;
  }
  const win = window;
  const doc = document;

  let resolved: Element | null;
  if (typeof target === "string") {
    try {
      resolved = doc.querySelector(target);
    } catch {
      // Non-anchor hashes (e.g. "#paymentId=...") aren't valid selectors — no-op.
      return noop;
    }
  } else {
    resolved = target;
  }
  if (!resolved) return noop;
  const element = resolved;

  const offset = opts.offset ?? DEFAULT_OFFSET;
  const behavior = opts.behavior ?? "smooth";
  const settleMs = opts.settleMs ?? DEFAULT_SETTLE_MS;

  const measure = () =>
    element.getBoundingClientRect().top + win.pageYOffset - offset;

  let desiredY = measure();
  win.scrollTo({ top: desiredY, behavior });

  if (opts.updateHash) {
    try {
      win.history.replaceState(null, "", opts.updateHash);
    } catch {
      /* ignore history errors (e.g. sandboxed environments) */
    }
  }

  let timer: number | null = null;
  let cancelled = false;
  let stableTicks = 0;
  let elapsed = 0;

  const onInterrupt = () => cancel();
  const onKeyDown = (event: KeyboardEvent) => {
    if (INTERRUPT_KEYS.has(event.key)) cancel();
  };

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    if (timer !== null) {
      win.clearTimeout(timer);
      timer = null;
    }
    win.removeEventListener("wheel", onInterrupt);
    win.removeEventListener("touchstart", onInterrupt);
    win.removeEventListener("keydown", onKeyDown);
  }

  const tick = () => {
    if (cancelled) return;
    const nextY = measure();
    if (Math.abs(nextY - desiredY) > TOLERANCE_PX) {
      desiredY = nextY;
      win.scrollTo({ top: desiredY, behavior: "auto" });
      stableTicks = 0;
    } else {
      stableTicks += 1;
    }
    elapsed += TICK_MS;
    if (stableTicks >= STABLE_TICKS || elapsed >= settleMs) {
      cancel();
      return;
    }
    timer = win.setTimeout(tick, TICK_MS);
  };

  win.addEventListener("wheel", onInterrupt, { passive: true });
  win.addEventListener("touchstart", onInterrupt, { passive: true });
  win.addEventListener("keydown", onKeyDown);
  timer = win.setTimeout(tick, TICK_MS);

  return cancel;
}
