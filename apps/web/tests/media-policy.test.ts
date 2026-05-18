import {
  IMAGE_POLICY_BY_SECTION,
  MEDIA_DEVICE_BREAKPOINTS,
  MEDIA_DEVICE_CLASSES,
  PHOTOGRAPHIC_MEDIA_FORMATS,
} from "../src/lib/media-policy";

describe("image media policy", () => {
  it("defines the standardized device classes and breakpoints", () => {
    expect(MEDIA_DEVICE_CLASSES).toEqual(["mobile", "tablet", "desktop"]);
    expect(MEDIA_DEVICE_BREAKPOINTS).toEqual({
      mobileMax: 767,
      tabletMin: 768,
      tabletMax: 1279,
      desktopMin: 1280,
    });
  });

  it("requires avif, webp, and jpeg for app-owned photographic sections", () => {
    for (const section of ["hero", "story", "padrinhos", "presentes", "footer"] as const) {
      expect(IMAGE_POLICY_BY_SECTION[section].requiredFormats).toEqual(PHOTOGRAPHIC_MEDIA_FORMATS);
      expect(IMAGE_POLICY_BY_SECTION[section].devices).toEqual(MEDIA_DEVICE_CLASSES);
    }
  });

  it("keeps the local section external and the social image on jpeg", () => {
    expect(IMAGE_POLICY_BY_SECTION.local.kind).toBe("external-video-poster");
    expect(IMAGE_POLICY_BY_SECTION.local.requiredFormats).toEqual(PHOTOGRAPHIC_MEDIA_FORMATS);
    expect(IMAGE_POLICY_BY_SECTION.social.kind).toBe("social");
    expect(IMAGE_POLICY_BY_SECTION.social.requiredFormats).toEqual(["jpeg"]);
  });

  it("keeps icons out of the photographic conversion pipeline", () => {
    expect(IMAGE_POLICY_BY_SECTION.icons.kind).toBe("graphic");
    expect(IMAGE_POLICY_BY_SECTION.icons.requiredFormats).toEqual(["svg", "png"]);
  });

  it("marks crop strategy per section", () => {
    expect(IMAGE_POLICY_BY_SECTION.hero.cropPolicy).toBe("device-specific");
    expect(IMAGE_POLICY_BY_SECTION.footer.cropPolicy).toBe("device-specific");
    expect(IMAGE_POLICY_BY_SECTION.story.cropPolicy).toBe("shared");
    expect(IMAGE_POLICY_BY_SECTION.padrinhos.cropPolicy).toBe("shared");
    expect(IMAGE_POLICY_BY_SECTION.presentes.cropPolicy).toBe("shared");
  });
});
