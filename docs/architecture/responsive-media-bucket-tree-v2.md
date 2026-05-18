# Responsive Media Bucket Tree v2

Source-of-truth image tree for the next media-bucket migration. This document is image-only and intentionally does not change runtime code. Convert and upload assets to S3 first; then update the application to consume this structure.

## Goals

- Normalize all bucket keys to lowercase kebab-case.
- Use `avif`, `webp`, and `jpeg` for photographic assets.
- Reserve `png` for transparency-only exceptions.
- Use device-specific crops only where composition changes across devices.
- Use shared-crop width variants for card and portrait sections.

## Naming Rules

- Top-level folders: lowercase kebab-case.
- Asset slugs: lowercase kebab-case.
- Extensions: lowercase only.
- Forbidden: spaces, underscores, uppercase letters, camera filenames.
- Accents are ASCII-folded:
  - `á à ã â` -> `a`
  - `é ê` -> `e`
  - `í` -> `i`
  - `ó ô õ` -> `o`
  - `ú` -> `u`
  - `ç` -> `c`
- Multi-person names join with `-e-`.
  - `Kelly e Sá` -> `kelly-e-sa`
  - `Cristiane e Juliano` -> `cristiane-e-juliano`

Canonical photographic fallback extension:

- `jpeg`

Transparent fallback extension:

- `png`

## Top-Level Tree

```text
hero/
footer/
story/
padrinhos/
presentes/
social/
```

Videos are out of scope for this migration. When video cleanup happens later, prefer:

```text
story-videos/
```

## Variant Strategy

### Device-Specific Crop Sections

Use this pattern for sections that need different crops by device:

```text
{section}/{device}.{format}
```

Sections:

- `hero`
- `footer`

Devices:

- `mobile`
- `tablet`
- `desktop`

Formats:

- `avif`
- `webp`
- `jpeg`

### Shared-Crop Width Sections

Use this pattern for sections where the same crop is reused across breakpoints:

```text
{section}/{slug}/{width}.{format}
```

Sections:

- `story`
- `padrinhos`
- `presentes`

Widths:

- `480`
- `960`
- `1440`

Formats:

- `avif`
- `webp`
- `jpeg`

Transparent exception:

- `presentes/purificador-agua/*` may use `png` instead of `jpeg` only if transparency must remain.

## Concrete Tree

### Hero

```text
hero/
  mobile.avif
  mobile.webp
  mobile.jpeg
  tablet.avif
  tablet.webp
  tablet.jpeg
  desktop.avif
  desktop.webp
  desktop.jpeg
```

### Footer

```text
footer/
  mobile.avif
  mobile.webp
  mobile.jpeg
  tablet.avif
  tablet.webp
  tablet.jpeg
  desktop.avif
  desktop.webp
  desktop.jpeg
```

### Story

```text
story/
  amor-na-pratica/
  memorias-de-um-inverno/
  ps-eu-te-amo/
  viva-paixoes-comigo/
```

Each story slug folder must contain:

```text
480.avif
480.webp
480.jpeg
960.avif
960.webp
960.jpeg
1440.avif
1440.webp
1440.jpeg
```

### Padrinhos

```text
padrinhos/
  alice/
  ana-clara/
  carlinhos/
  cristiane-e-juliano/
  drielly/
  kelly-e-sa/
  lila-e-welton/
  luiza/
  nilza-e-cerqueira/
  raquel/
  tami-e-marcos/
```

Each padrinhos slug folder must contain:

```text
480.avif
480.webp
480.jpeg
960.avif
960.webp
960.jpeg
1440.avif
1440.webp
1440.jpeg
```

### Presentes

```text
presentes/
  4-toalhas-banho/
  armario-cozinha/
  aspirador/
  balde-retratil/
  batedeira/
  cama/
  edredom-king/
  escorredor-louca/
  fogao/
  geladeira-brastemp/
  guarda-roupa/
  jogo-ferramentas/
  jogo-pratos/
  jogo-talheres/
  jogo-xicaras/
  kit-toalhas-rosto/
  lava-loucas/
  lava-seca/
  liquidificador/
  mesa-jantar/
  microondas/
  processador/
  purificador-agua/
  sofa/
  steamer/
  travesseiros/
```

Each presentes slug folder must contain:

```text
480.avif
480.webp
480.jpeg
960.avif
960.webp
960.jpeg
1440.avif
1440.webp
1440.jpeg
```

Exception for `purificador-agua` if transparency remains required:

```text
480.avif
480.webp
480.png
960.avif
960.webp
960.png
1440.avif
1440.webp
1440.png
```

### Social

```text
social/
  opengraph.jpeg
```

## Later Contract Changes

These are intentionally deferred until after assets are uploaded:

- `hero` and `footer` URLs become section + device + format based.
- `story`, `padrinhos`, and `presentes` URLs become section + slug + width + format based.
- `gift.image` becomes slug-only instead of filename-with-extension.
- Seed data, contracts, admin tooling, and persisted gift rows need a coordinated migration.
- `apps/web/src/lib/media.ts` will need a variant-aware URL builder instead of the current single-filename helper.

## Validation Checklist

- `hero/` contains exactly 9 files.
- `footer/` contains exactly 9 files.
- Each `story/`, `padrinhos/`, and `presentes/` slug folder contains the exact expected width/format set.
- `social/` contains exactly `opengraph.jpeg`.
- No file uses `.jpg`.
- No filename contains spaces.
- No filename contains uppercase letters.
- No placeholder assets exist in the new tree.
- No legacy runtime folders remain part of the future code path:
  - `hero_footer/`
  - `presentes/gifts/`
  - `presentes/padrinhos/`

For an exact machine-readable upload list, use [responsive-media-bucket-tree-v2.manifest.json](/home/maxreis86/consulting/brimax-life/docs/architecture/responsive-media-bucket-tree-v2.manifest.json:1).
