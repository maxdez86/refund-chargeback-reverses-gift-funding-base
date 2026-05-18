export const MEDIA_DEVICE_CLASSES = ["mobile", "tablet", "desktop"] as const;
export const PHOTOGRAPHIC_MEDIA_FORMATS = ["avif", "webp", "jpeg"] as const;
export const GRAPHIC_MEDIA_FORMATS = ["svg", "png"] as const;

export type MediaDeviceClass = (typeof MEDIA_DEVICE_CLASSES)[number];
export type PhotographicMediaFormat = (typeof PHOTOGRAPHIC_MEDIA_FORMATS)[number];
export type GraphicMediaFormat = (typeof GRAPHIC_MEDIA_FORMATS)[number];

export const MEDIA_DEVICE_BREAKPOINTS = {
  mobileMax: 767,
  tabletMin: 768,
  tabletMax: 1279,
  desktopMin: 1280,
} as const;

type PhotographicSectionPolicy = {
  kind: "photographic";
  devices: readonly MediaDeviceClass[];
  cropPolicy: "shared" | "device-specific";
  requiredFormats: readonly PhotographicMediaFormat[];
};

type ExternalVideoPosterPolicy = {
  kind: "external-video-poster";
  devices: readonly MediaDeviceClass[];
  cropPolicy: "shared" | "device-specific";
  requiredFormats: readonly PhotographicMediaFormat[];
};

type SocialImagePolicy = {
  kind: "social";
  devices: readonly [];
  cropPolicy: "shared";
  requiredFormats: readonly ["jpeg"];
};

type GraphicSectionPolicy = {
  kind: "graphic";
  devices: readonly [];
  cropPolicy: "shared";
  requiredFormats: readonly GraphicMediaFormat[];
};

export type MediaSectionPolicy =
  | PhotographicSectionPolicy
  | ExternalVideoPosterPolicy
  | SocialImagePolicy
  | GraphicSectionPolicy;

export const IMAGE_POLICY_BY_SECTION = {
  hero: {
    kind: "photographic",
    devices: MEDIA_DEVICE_CLASSES,
    cropPolicy: "device-specific",
    requiredFormats: PHOTOGRAPHIC_MEDIA_FORMATS,
  },
  story: {
    kind: "photographic",
    devices: MEDIA_DEVICE_CLASSES,
    cropPolicy: "shared",
    requiredFormats: PHOTOGRAPHIC_MEDIA_FORMATS,
  },
  local: {
    kind: "external-video-poster",
    devices: MEDIA_DEVICE_CLASSES,
    cropPolicy: "shared",
    requiredFormats: PHOTOGRAPHIC_MEDIA_FORMATS,
  },
  padrinhos: {
    kind: "photographic",
    devices: MEDIA_DEVICE_CLASSES,
    cropPolicy: "shared",
    requiredFormats: PHOTOGRAPHIC_MEDIA_FORMATS,
  },
  presentes: {
    kind: "photographic",
    devices: MEDIA_DEVICE_CLASSES,
    cropPolicy: "shared",
    requiredFormats: PHOTOGRAPHIC_MEDIA_FORMATS,
  },
  footer: {
    kind: "photographic",
    devices: MEDIA_DEVICE_CLASSES,
    cropPolicy: "device-specific",
    requiredFormats: PHOTOGRAPHIC_MEDIA_FORMATS,
  },
  social: {
    kind: "social",
    devices: [],
    cropPolicy: "shared",
    requiredFormats: ["jpeg"],
  },
  icons: {
    kind: "graphic",
    devices: [],
    cropPolicy: "shared",
    requiredFormats: GRAPHIC_MEDIA_FORMATS,
  },
} as const satisfies Record<string, MediaSectionPolicy>;

export type ImagePolicySection = keyof typeof IMAGE_POLICY_BY_SECTION;

export function getImagePolicy(section: ImagePolicySection): MediaSectionPolicy {
  return IMAGE_POLICY_BY_SECTION[section];
}

export function formatList(formats: readonly string[]): string {
  return formats.join(",");
}

export function deviceClassList(devices: readonly string[]): string {
  return devices.join(",");
}
