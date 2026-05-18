export const MEDIA_BUCKET = import.meta.env.VITE_MEDIA_BUCKET as string | undefined;

export type MediaSection = "story" | "padrinhos" | "presentes" | "hero_footer";

export function mediaUrl(section: MediaSection, file: string): string {
  return `/media/${section}/${encodeURIComponent(file)}`;
}

if (import.meta.env.DEV && !MEDIA_BUCKET) {
  console.warn(
    "[media] VITE_MEDIA_BUCKET is not set in apps/web/.env. CloudFront /media/* still routes correctly in deployed environments, but the env var keeps the bucket name in sync with infra tooling.",
  );
}
