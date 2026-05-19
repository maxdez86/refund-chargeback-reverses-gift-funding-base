import {
  type MediaDeviceClass,
  type PhotographicMediaFormat,
} from "@/lib/media-policy";

export const MEDIA_BUCKET = import.meta.env.VITE_MEDIA_BUCKET as string | undefined;

export type DeviceImageSection = "hero" | "footer";
export type SharedWidthImageSection = "story" | "padrinhos" | "presentes";
export type SharedWidthVariant = 480 | 960 | 1440;

type ResponsiveSource = {
  media?: string;
  sizes?: string;
  srcSet: string;
  type?: string;
};

const MIME_TYPE_BY_FORMAT: Record<PhotographicMediaFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

const SHARED_WIDTH_VARIANTS: readonly SharedWidthVariant[] = [480, 960, 1440];
const PHOTOGRAPHIC_FORMATS: readonly PhotographicMediaFormat[] = ["avif", "webp", "jpeg"];
const DEVICE_MEDIA_QUERIES: Record<MediaDeviceClass, string> = {
  mobile: "(max-width: 767px)",
  tablet: "(min-width: 768px) and (max-width: 1279px)",
  desktop: "(min-width: 1280px)",
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

export function buildDeviceImageSources(section: DeviceImageSection): ResponsiveSource[] {
  return (["mobile", "tablet", "desktop"] as const).flatMap((device) =>
    PHOTOGRAPHIC_FORMATS.map((format) => ({
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
): ResponsiveSource[] {
  return PHOTOGRAPHIC_FORMATS.map((format) => ({
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
