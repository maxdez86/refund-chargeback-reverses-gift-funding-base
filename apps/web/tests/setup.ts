import "@testing-library/jest-dom/vitest";

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: IntersectionObserverMock,
});

Object.defineProperty(window.URL, "createObjectURL", {
  writable: true,
  value: () => "blob:mock-url",
});

Object.defineProperty(window.URL, "revokeObjectURL", {
  writable: true,
  value: () => {},
});

Object.defineProperty(navigator, "clipboard", {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});
