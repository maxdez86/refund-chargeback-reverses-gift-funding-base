import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  deviceClassList,
  formatList,
  getImagePolicy,
  type ImagePolicySection,
} from "@/lib/media-policy";

export type PictureSource = {
  media?: string;
  sizes?: string;
  srcSet: string;
  type?: string;
};

type ResponsivePhotoProps = Omit<
  ComponentPropsWithoutRef<"img">,
  "src" | "children"
> & {
  fallbackSrc: string;
  section: ImagePolicySection;
  sources?: readonly PictureSource[];
  overlay?: ReactNode;
};

export function ResponsivePhoto({
  alt,
  className,
  fallbackSrc,
  overlay,
  section,
  sources = [],
  ...imgProps
}: ResponsivePhotoProps) {
  const policy = getImagePolicy(section);

  return (
    <picture
      data-media-policy-section={section}
      data-media-policy-kind={policy.kind}
      data-media-policy-crop={policy.cropPolicy}
      data-media-policy-devices={deviceClassList(policy.devices)}
      data-media-policy-formats={formatList(policy.requiredFormats)}
    >
      {sources.map((source) => (
        <source
          key={`${source.type ?? "default"}:${source.media ?? "all"}:${source.srcSet}`}
          media={source.media}
          sizes={source.sizes}
          srcSet={source.srcSet}
          type={source.type}
        />
      ))}
      <img alt={alt} className={className} src={fallbackSrc} {...imgProps} />
      {overlay}
    </picture>
  );
}
