# Design References - S15

## Summary

Across the eight reference sites, five cross-cutting patterns stand out and should inform the S15 wedding page. First, **art-directed display typography is treated as the hero element** — letters are spaced, fragmented, line-broken, or overlapped with imagery so the headline becomes the composition (Elyse, Assistantly, Mockit, McShannock, Duyvenvoorde). Second, **warm, restrained palettes built around a single decisive accent** (terracotta on cream at Haven, amber on bone at Duyvenvoorde, ink on parchment at McShannock) consistently feel more premium than multi-color systems. Third, **scroll choreography is patient and cinematic** — staggered reveals, parallax of layered image cards, and slow horizontal sequences carry the narrative (Elyse, Galvanite, Haven). Fourth, **horizontal carousels are signaled with peeking next-cards, dotted progress, and tactile drag affordance**, never with bare arrows alone (Haven, Elyse, Duyvenvoorde, Galvanite). Fifth, **negative space is treated as a luxury material** — every site reserves dramatic margins around its hero word, and dense modules earn their density.

## Per-Site Analysis

### McShannock Design — https://www.mcshannock.design/

**Color palette:** Quiet light system. Background `#FFFFFF`, primary ink `#364153`, secondary `#4A5565`, soft greys `#666666` / `#99A1AF`. Effectively a near-monochrome editorial palette.
**Typography:** Geist sans across the board, with extreme display sizing. H1 `~72px` set very large and word-spaced (e.g. "No    Fuss    Product    Design"), body `24px`, comfortable leading. Weight contrast does most of the work.
**Whitespace and rhythm:** Generous, editorial. Long horizontal breathing room around the hero phrase; sections separated by full-bleed image plates.
**Layout pattern:** Editorial single-column with full-width image plates and a strong horizontal headline that breaks across the viewport.
**Animation types:** Word-by-word entry, hero showreel reveal, soft cross-fades into image plates, subtle hover lifts on case study cards.
**Motion pacing:** Slow, confident, cinematic; nothing rushes the eye.
**Carousel technique:** Case study row scrolls with a snap rhythm and partial peek of the next card.
**Emotional tone:** Quiet confidence, premium consultancy calm.
**Technical signals:** Next.js + Sanity, CSS custom properties, Geist font, no flashy WebGL — restraint is the technique.
**Most transferable insight for S15:** Treat the words "Brida e Max" the way McShannock treats its display headline — wide letter/word spacing, generous margin, type as composition, not as label.

### Duyvenvoorde — https://duyvenvoorde.nl/

**Color palette:** Warm bone background `#EDE8DE`, deep ink text `#141414`, signature warm orange accent `#FF5500`, soft pink secondary `#FCA1CD` used very sparingly.
**Typography:** Roboto Condensed for body, Bricolage Grotesque for display. Massive display scale (`H1 ~180px`) with line breaks that turn a single word into a stacked composition ("Acc / ess nature's / finest").
**Whitespace and rhythm:** Editorial-magazine, asymmetric. Hero text dominates; product imagery enters from the side as collaged layers.
**Layout pattern:** Asymmetric grid with floating image cards, sticky text-slider strips, and full-bleed feature blocks.
**Animation types:** Marquee/text-slider strips moving horizontally, layered image parallax, scroll-triggered image entries from the edges.
**Motion pacing:** Mid-tempo and fluid; horizontal text marquees keep the page alive.
**Carousel technique:** Text slider acts as a continuous horizontal ticker; product rows use snap with a peek of the next item.
**Emotional tone:** Warm, natural, confidently bold — like a luxury florist's atelier.
**Technical signals:** Next.js, AVIF imagery, sticky observers, transform-based parallax. Pill-shaped buttons (`35px` radius).
**Most transferable insight for S15:** A bone/cream background with one deeply saturated warm accent feels far more premium than any pink-on-pink wedding palette. Steal the pill buttons and the warm-on-bone restraint.

### Galvanite — https://www.galvanite.io/

**Color palette:** Deep navy `#0C1329` / `#111933` field with a single high-voltage yellow accent `#FFD400`, warm white type. High-contrast dark editorial.
**Typography:** DM Sans body with Nordt Slim display. Body trim (`~15.6px`), H1 `~66px` — restrained for a dark site.
**Whitespace and rhythm:** Tight but organized; sections feel modular, with clear horizontal rules and tabbed content groupings.
**Layout pattern:** Tab-switched modules, stacked feature blocks, animated illustration set-pieces (rocket smoke).
**Animation types:** Layered AVIF illustration sequences, tabbed view-transitions, scroll reveals on stat blocks.
**Motion pacing:** Punchy and product-y; faster than McShannock, slower than Mockit.
**Carousel technique:** Tabbed image swap (Design / Develop / Launch) acts as a non-scroll "carousel" — useful for the Local/Padrinhos toggle thinking.
**Emotional tone:** Confident, energized, but premium.
**Technical signals:** Webflow, AVIF stacking, layered transforms, custom properties.
**Most transferable insight for S15:** A single saturated accent on a calm field reads as luxury when used sparingly — apply that logic to one hero accent (e.g. terracotta or champagne brass) used only on CTAs and the headline ampersand.

### Elyse Residence — https://elyse-residence-dev.webflow.io/

**Color palette:** Deep forest/charcoal background `#121717` with a primary green `#254441`, warm off-whites and ivory accents. Quiet sky-blue link tone `#3898EC` reserved for interactivity.
**Typography:** Inter body, Fragment Serif for display, Fragment Glare as poster face. Hero "E    l    y    s    e" rendered at extreme letter-spacing — almost an architectural wordmark. H2 `~76px`.
**Whitespace and rhythm:** Cathedral-like; words are spaced into the air. Stat blocks are vertically stacked with massive numerals.
**Layout pattern:** Long vertical scroll, vertical-stacked words at hero, horizontally scrolling residence cards mid-page, full-bleed AVIF interiors.
**Animation types:** Hero letter reveal with extreme tracking, vertical word stack pinning, horizontal scroll-jacking for the "livings" gallery, smooth image parallax.
**Motion pacing:** Slow, cinematic, hospitality-grade.
**Carousel technique:** A horizontal-pinned section of residence cards that scroll sideways as the page scrolls vertically — the gold standard pattern for storytelling carousels. Pill buttons at full radius (`100000px`).
**Emotional tone:** Sanctuary, hush, elegance, "step inside".
**Technical signals:** Webflow, IntersectionObserver scroll triggers, transform parallax, AVIF imagery.
**Most transferable insight for S15:** The horizontally pinned scroll gallery is the most emotionally cinematic carousel pattern in the set — perfect for "Nossa História" and "Pré-Wedding". The extreme letter-spacing on the hero word is also directly transferable to "Brida e Max".

### Voxr — https://www.voxr.ai/

**Color palette:** White field with vivid violet `#AB00FF`, deeper purple `#7F34A4`, soft lavender wash `#DDBBF1`. High saturation, modern SaaS.
**Typography:** DM Sans throughout, very large H1 `~96px`. Confident weight contrast.
**Whitespace and rhythm:** Modular SaaS rhythm with feature grids and stat blocks; less editorial than the rest.
**Layout pattern:** Standard hero → features grid → stats → process → CTA. Familiar pattern, very tight execution.
**Animation types:** Stat counters, fade-up reveals on cards, hover lifts.
**Motion pacing:** Crisp and energetic.
**Carousel technique:** Minimal — relies on grid layouts rather than carousels.
**Emotional tone:** Fast, modern, confident, slightly cool.
**Technical signals:** Webflow, AVIF, simple transform animations.
**Most transferable insight for S15:** Mostly an *anti-reference* — its high-saturation SaaS look is exactly the "startup template" trap to avoid. Useful as a calibration: if S15 starts feeling like Voxr, pull back into Haven/McShannock territory. The clean stat-block pattern *is* worth borrowing for the countdown numerals.

### Mockit — https://www.mockit.design/

**Color palette:** Near-black field `#080808` with a single hot orange accent `#FF4F1A`. Two-color brutalist confidence.
**Typography:** Bebas Neue display (huge condensed caps, `~144px`) + Bricolage Grotesque body. Tiny body (`~11.5px`) intentionally — type as poster.
**Whitespace and rhythm:** Tight, declarative, poster-like. Headlines run edge-to-edge.
**Layout pattern:** Posterized hero, three-step blocks, large device imagery, no fluff.
**Animation types:** Display headline entry, simple hover scaling on device mocks.
**Motion pacing:** Direct, punchy.
**Carousel technique:** Device-grid rather than a true carousel.
**Emotional tone:** Confident, no-nonsense, slightly brash.
**Technical signals:** Vite/React stack signals, simple transforms.
**Most transferable insight for S15:** The two-color discipline (one ink, one accent) is a useful constraint — even a wedding site benefits from limiting the palette to one warm accent against a calm base.

### Assistantly — https://www.assistantly.com/

**Color palette:** Soft neutral background `#F9F9F9`, deep blue primary `#13139C`, electric blue accent `#4141FC`, warm grey body text.
**Typography:** Manrope throughout. Display H1 `~128px`, set as letter-by-letter scroll with each glyph occupying its own line ("S c a l e   F a s t e r"). Body `20px`.
**Whitespace and rhythm:** Long-scroll editorial with gigantic letterforms unfurling vertically through the viewport.
**Layout pattern:** Vertical letter-stack hero, then floating collage of small image cards orbiting the type.
**Animation types:** Scroll-pinned letter reveals (each letter pinned briefly as it enters), floating image cards drifting in 2D space, hover lifts.
**Motion pacing:** Patient at the hero, then quickens.
**Carousel technique:** The letter-by-letter vertical reveal *is* the carousel — content moves through a fixed frame.
**Emotional tone:** Playful-premium, energetic but composed.
**Technical signals:** Webflow, scroll-pin mechanics, transform-based collage.
**Most transferable insight for S15:** The scroll-pinned letter reveal of "Brida e Max" — letting the name unfurl as the user scrolls — is a transferable wow moment for the hero, provided it degrades gracefully on `prefers-reduced-motion` and on slow phones.

### Haven Annecy — https://haven-annecy.fr/en

**Color palette:** Cream/blush background `#FFFAF7`, deep cocoa text `#2B1A12`, signature warm terracotta `#C1643B`, soft pink-blush secondary `#EFDACC`. The most directly transferable palette in the set.
**Typography:** PF DinText Pro body + "With Hearty" script display. Script display used very sparingly for emotional accents — the rest is a clean humanist sans.
**Whitespace and rhythm:** Warm, generous, food-magazine. Round photos, generous gutters, pill buttons (`30px` radius).
**Layout pattern:** Editorial brunch-magazine — large hero photo, alternating text/image rows, photo grids, square food shots.
**Animation types:** Soft fades on photo entries, hover rotations on round photos, gentle marquee on news strips.
**Motion pacing:** Calm, breakfast-light, unhurried.
**Carousel technique:** Square photo carousel with peeking next item and dotted progress; circular photo cards with subtle rotation.
**Emotional tone:** Warm, hospitable, sun-through-the-window. The closest emotional sibling to a wedding site in the set.
**Technical signals:** Drupal (less framework signal), CSS-based animation, WebP/AVIF imagery, plain HTML semantics.
**Most transferable insight for S15:** This is the **single most directly transferable site**. Its cream + cocoa + terracotta palette, its pill buttons, its round/square photo carousel rhythm, and its hospitable typography pairing (clean sans + occasional script accent) map almost 1:1 onto a warm Brazilian wedding site. Treat Haven as the anchor reference; treat the others as secondary inspiration.

## Distilled Creative Brief for S15

This is the actionable brief subsequent steps should read first.

### Animation and motion techniques to adopt

1. **Scroll-pinned hero word reveal** (Assistantly + Elyse): "Brida e Max" enters with extreme letter-spacing closing in, or unfurls letter-by-letter as the user scrolls the first viewport. Must degrade to a single fade for `prefers-reduced-motion` and for low-power devices.
2. **Horizontally pinned carousel sections** (Elyse): "Nossa História" and "Pré-Wedding" should ideally use a horizontally pinned scroll-jack on desktop where vertical scroll drives horizontal motion through a row of cards; on mobile, fall back to native horizontal snap with peek + dots. Never use scroll-jack on mobile — it breaks WhatsApp browsers.
3. **Layered image parallax with edge-entries** (Duyvenvoorde + McShannock): couple photos enter from the side as floating cards on scroll, rotate 1–3°, never more.
4. **Marquee text strip** (Duyvenvoorde) used once as a section divider — e.g. "06 · 12 · 2026 · São Paulo · Brida e Max" looping slowly between Hero and Countdown.
5. **Patient cross-section staggered reveals** (Haven + McShannock): every section's children fade-up with a 60–80ms stagger; nothing pops, nothing bounces.

### Color strategy observations

1. **Anchor on Haven's palette logic**: warm cream/blush field (`~#FFFAF7`/`#F7F1EA`), deep cocoa or ink text (`~#2B1A12`/`#1F1A17`), one decisive warm accent — terracotta `~#C1643B` or champagne brass `~#B0884A` — used only on primary CTAs, the hero ampersand, active dots, and key links.
2. **Two-color discipline** (Mockit + Galvanite): the wedding site should read as essentially two colors (deep ink on warm cream) plus one accent. Resist adding a second accent. Soft blush `~#EFDACC` is allowed only as a quiet secondary surface for cards.
3. **Avoid the high-saturation SaaS purples/blues** (Voxr) and avoid dense Webflow-y dark editorial (Galvanite) — both conflict with the warm pt-BR wedding tone.

### Typography and spacing choices

1. **Display + body pairing** like Haven and Elyse: a refined editorial serif (e.g. Fraunces, Cormorant, or PP Editorial) for the couple name and section titles, paired with a clean humanist sans (e.g. Plus Jakarta Sans, Manrope, or Inter) for body and UI. Reserve a script/italic flourish for the ampersand only — never run paragraphs of script.
2. **Extreme display sizing on mobile** (Elyse + Assistantly): the couple name should consume most of the first viewport. Don't be afraid of `clamp(56px, 14vw, 180px)` for the headline.
3. **Generous, editorial whitespace** (McShannock + Elyse): sections breathe with `min-h-[80vh]` framing on desktop; on mobile, give each section enough room that it feels intentional, not crowded.

### Carousel behavior worth emulating

- **Always show a peek** of the next card (Haven, Elyse, Duyvenvoorde) so swipe is discovered visually.
- **Dotted progress + draggable** (Haven). Arrows are secondary on desktop, hidden on mobile.
- **Snap with momentum**, not free scroll. Tactile drag with rubber-band at edges.
- **Subtle rotation (1–3°) on photo cards** (Haven) when they enter the viewport — gives the polaroid/scrapbook feel without being twee.
- **Active-card emphasis**: the centered card sits at full saturation; peeking neighbors are dimmed `~60%` opacity.

### Patterns to explicitly avoid (would conflict with the warm pt-BR wedding tone)

- **High-saturation SaaS palettes** (Voxr violet, Galvanite electric yellow) — too cold/corporate.
- **Brutalist all-caps black-and-orange poster aesthetic** (Mockit) — too aggressive for a wedding.
- **Scroll-jacking on mobile** — breaks WhatsApp in-app browsers, frustrates older guests.
- **Tabbed feature switchers** (Galvanite) — too product-marketing for an emotional wedding narrative.
- **Stacked "S c a l e" letter columns** (Assistantly) used for *every* heading — stunning once at the hero, exhausting if repeated.
- **Dense agency case-study grids** (McShannock) — wrong density for a wedding RSVP audience.
- **Floating emoji collages** (Assistantly) — explicitly forbidden by Step 01's no-emoji rule.

### Anchor reference

When in doubt, reference **Haven Annecy** for palette, hospitality, and rhythm; **Elyse Residence** for cinematic carousel choreography and hero typography; **Duyvenvoorde** for the warm-on-bone editorial confidence; **McShannock** for restraint and whitespace discipline. Treat the remaining four sites as calibration — useful for what *not* to do.
