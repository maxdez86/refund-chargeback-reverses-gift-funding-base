import {
  MEDIA_DEVICE_BREAKPOINTS,
  MEDIA_DEVICE_CLASSES,
  PHOTOGRAPHIC_MEDIA_FORMATS,
  type MediaDeviceClass,
  type PhotographicMediaFormat,
} from "@/lib/media-policy";
import type { PictureSource } from "@/components/ResponsivePhoto";

export const MEDIA_BUCKET = import.meta.env.VITE_MEDIA_BUCKET as string | undefined;

export type DeviceImageSection = "hero" | "footer";
export type SharedWidthImageSection = "story" | "padrinhos" | "presentes";
export type SharedWidthVariant = 480 | 960 | 1440;

const MIME_TYPE_BY_FORMAT: Record<PhotographicMediaFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

export const SHARED_WIDTH_VARIANTS: readonly SharedWidthVariant[] = [480, 960, 1440];
const DEVICE_MEDIA_QUERIES: Record<MediaDeviceClass, string> = {
  mobile: `(max-width: ${MEDIA_DEVICE_BREAKPOINTS.mobileMax}px)`,
  tablet: `(min-width: ${MEDIA_DEVICE_BREAKPOINTS.tabletMin}px) and (max-width: ${MEDIA_DEVICE_BREAKPOINTS.tabletMax}px)`,
  desktop: `(min-width: ${MEDIA_DEVICE_BREAKPOINTS.desktopMin}px)`,
};

export function mediaFileUrl(section: string, file: string): string {
  return `/media/${section}/${encodeURIComponent(file)}`;
}

export function deviceImageUrl(
  section: DeviceImageSection,
  device: MediaDeviceClass,
  format: PhotographicMediaFormat,
): string {
  return mediaFileUrl(section, `${device}.${format}`);
}

export function sharedWidthImageUrl(
  section: SharedWidthImageSection,
  slug: string,
  width: SharedWidthVariant,
  format: PhotographicMediaFormat,
): string {
  return `/media/${section}/${encodeURIComponent(slug)}/${width}.${format}`;
}

export function buildDeviceImageSources(section: DeviceImageSection): PictureSource[] {
  return MEDIA_DEVICE_CLASSES.flatMap((device) =>
    PHOTOGRAPHIC_MEDIA_FORMATS.map((format) => ({
      media: DEVICE_MEDIA_QUERIES[device],
      srcSet: deviceImageUrl(section, device, format),
      type: MIME_TYPE_BY_FORMAT[format],
    })),
  );
}

export function buildDeviceImageFallbackSrc(section: DeviceImageSection): string {
  return deviceImageUrl(section, "desktop", "jpeg");
}

export function buildSharedWidthImageSources(
  section: SharedWidthImageSection,
  slug: string,
  sizes: string,
): PictureSource[] {
  return PHOTOGRAPHIC_MEDIA_FORMATS.map((format) => ({
    sizes,
    srcSet: SHARED_WIDTH_VARIANTS.map(
      (width) => `${sharedWidthImageUrl(section, slug, width, format)} ${width}w`,
    ).join(", "),
    type: MIME_TYPE_BY_FORMAT[format],
  }));
}

export function buildSharedWidthImageFallbackSrc(
  section: SharedWidthImageSection,
  slug: string,
): string {
  return sharedWidthImageUrl(section, slug, 960, "jpeg");
}

if (import.meta.env.DEV && !MEDIA_BUCKET) {
  console.warn(
    "[media] VITE_MEDIA_BUCKET is not set in apps/web/.env. CloudFront /media/* still routes correctly in deployed environments, but the env var keeps the bucket name in sync with infra tooling.",
  );
}
