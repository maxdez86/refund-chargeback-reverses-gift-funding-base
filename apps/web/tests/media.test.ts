import { describe, expect, it } from "vitest";
import {
  buildDeviceImageFallbackSrc,
  buildDeviceImageSources,
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources,
  deviceImageUrl,
  mediaFileUrl,
  sharedWidthImageUrl,
} from "../src/lib/media";

describe("media helpers", () => {
  it("builds device-specific image URLs", () => {
    expect(deviceImageUrl("hero", "mobile", "avif")).toBe("/media/hero/mobile.avif");
    expect(deviceImageUrl("footer", "desktop", "jpeg")).toBe("/media/footer/desktop.jpeg");
    expect(buildDeviceImageFallbackSrc("hero")).toBe("/media/hero/desktop.jpeg");
    expect(buildDeviceImageSources("footer")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          media: "(max-width: 767px)",
          srcSet: "/media/footer/mobile.avif",
          type: "image/avif",
        }),
        expect.objectContaining({
          media: "(min-width: 1280px)",
          srcSet: "/media/footer/desktop.jpeg",
          type: "image/jpeg",
        }),
      ]),
    );
  });

  it("builds shared-width image URLs", () => {
    expect(sharedWidthImageUrl("story", "ps-eu-te-amo", 480, "avif")).toBe(
      "/media/story/ps-eu-te-amo/480.avif",
    );
    expect(sharedWidthImageUrl("presentes", "toalhas-banho", 1440, "jpeg")).toBe(
      "/media/presentes/toalhas-banho/1440.jpeg",
    );
    expect(buildSharedWidthImageFallbackSrc("padrinhos", "nilza-e-cerqueira")).toBe(
      "/media/padrinhos/nilza-e-cerqueira/960.jpeg",
    );
    expect(
      buildSharedWidthImageSources("presentes", "toalhas-banho", "(max-width: 767px) 82vw, 28vw"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sizes: "(max-width: 767px) 82vw, 28vw",
          srcSet:
            "/media/presentes/toalhas-banho/480.avif 480w, /media/presentes/toalhas-banho/960.avif 960w, /media/presentes/toalhas-banho/1440.avif 1440w",
          type: "image/avif",
        }),
      ]),
    );
  });

  it("keeps direct file URLs for videos", () => {
    expect(mediaFileUrl("story", "sob-a-luz-dos-seus-olhos.mp4")).toBe(
      "/media/story/sob-a-luz-dos-seus-olhos.mp4",
    );
  });
});
