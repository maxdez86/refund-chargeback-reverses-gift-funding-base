import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE,
  isProductionStage,
  resourceName,
  resolveStage,
  stageNamePrefix
} from "../src";

describe("@brimax/config", () => {
  it("defaults to prod when no stage is provided", () => {
    expect(resolveStage(undefined)).toBe(DEFAULT_STAGE);
  });

  it("keeps production names bare", () => {
    expect(isProductionStage("prod")).toBe(true);
    expect(stageNamePrefix("prod")).toBe("");
    expect(resourceName("brimax-wedding", "prod")).toBe("brimax-wedding");
  });

  it("adds a dev prefix only for dev", () => {
    expect(isProductionStage("dev")).toBe(false);
    expect(stageNamePrefix("dev")).toBe("dev-");
    expect(resourceName("brimax-wedding", "dev")).toBe("dev-brimax-wedding");
  });
});
