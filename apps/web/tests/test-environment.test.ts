import { describe, expect, it } from "vitest";

describe("jsdom test environment", () => {
  it("exposes a working localStorage implementation", () => {
    expect(window.localStorage).toBeDefined();
    window.localStorage.setItem("probe", "value");
    expect(window.localStorage.getItem("probe")).toBe("value");
    window.localStorage.clear();
    expect(window.localStorage.getItem("probe")).toBeNull();
  });
});
