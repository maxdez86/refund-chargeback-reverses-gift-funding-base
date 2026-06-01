import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";

function makeRect(top: number): DOMRect {
  return {
    top,
    bottom: top + 100,
    left: 0,
    right: 0,
    width: 0,
    height: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function addTarget(id = "target") {
  const el = document.createElement("section");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

describe("scrollToAnchor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("scrolls to the target's absolute position minus the offset", () => {
    const el = addTarget();
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(makeRect(1000));
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const cancel = scrollToAnchor("#target");

    // 1000 (top) + 0 (pageYOffset in jsdom) - 80 (default offset)
    expect(scrollSpy).toHaveBeenCalledWith({ top: 920, behavior: "smooth" });
    cancel();
  });

  it("re-snaps when layout shifts the target down after the initial scroll", () => {
    const el = addTarget();
    let top = 1000;
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => makeRect(top));
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const cancel = scrollToAnchor("#target");
    expect(scrollSpy).toHaveBeenLastCalledWith({ top: 920, behavior: "smooth" });

    // Simulate content above the target growing (e.g. a lazy image loads),
    // which pushes the absolute target position down by 300px.
    top = 1300;
    vi.advanceTimersByTime(100); // one settle tick

    expect(scrollSpy).toHaveBeenLastCalledWith({ top: 1220, behavior: "auto" });
    cancel();
  });

  it("does not re-scroll while the target stays put (within tolerance)", () => {
    const el = addTarget();
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(makeRect(1000));
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    scrollToAnchor("#target");
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // Several stable ticks should early-exit without issuing more scrolls.
    vi.advanceTimersByTime(1000);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("stops correcting once the user scrolls with the wheel", () => {
    const el = addTarget();
    let top = 1000;
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => makeRect(top));
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    scrollToAnchor("#target");
    const callCount = scrollSpy.mock.calls.length;

    window.dispatchEvent(new Event("wheel"));

    // The target now moves, but correction must not fire after the interrupt.
    top = 5000;
    vi.advanceTimersByTime(1000);
    expect(scrollSpy.mock.calls.length).toBe(callCount);
  });

  it("stops correcting once the user touches the screen", () => {
    const el = addTarget();
    let top = 1000;
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => makeRect(top));
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    scrollToAnchor("#target");
    const callCount = scrollSpy.mock.calls.length;

    window.dispatchEvent(new Event("touchstart"));

    top = 5000;
    vi.advanceTimersByTime(1000);
    expect(scrollSpy.mock.calls.length).toBe(callCount);
  });

  it("no-ops on an invalid selector (e.g. payment hashes) without throwing", () => {
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const cancel = scrollToAnchor("#paymentId=abc&paymentStatus=success");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(() => cancel()).not.toThrow();
  });

  it("no-ops when the target element is missing", () => {
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const cancel = scrollToAnchor("#does-not-exist");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(() => cancel()).not.toThrow();
  });
});
