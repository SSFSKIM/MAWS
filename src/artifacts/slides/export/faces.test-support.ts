// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): the faces the renderers' and exporters' suites
// draw: a Google Fonts face the engine host fetched (Lora, three files and its licence), one it refused by name (Roboto
// Slab, Apache-2.0), one with no record yet, and today's shapes (an uploaded file, an `href` with no record, a blob
// upload), whose outputs the suites pin as the pre-D19 code wrote them.
import type { DeckFace } from '../deck';

export const LORA_HREF = 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400&display=swap';
/** The canonical request the record answers (`googleRequest`: the axis tuple kept, `display` dropped). */
export const LORA_REQUEST = 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400';
export const LORA_LICENCE = 'assets/gf-lora-OFL.txt';
export const LORA_FILES = [
  { src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' },
  { src: 'assets/gf-lora-700.woff2', weight: '700', style: 'normal' },
  { src: 'assets/gf-lora-400-italic.woff2', weight: '400', style: 'italic' },
] as const;

/** Lora, fetched: the host's record of its three files and its licence. */
export const loraFace = (): DeckFace => ({ family: 'Lora', href: LORA_HREF, google: { request: LORA_REQUEST, licence: 'OFL', licenceSrc: LORA_LICENCE, files: LORA_FILES.map((file) => ({ ...file })) } });
/** Roboto Slab, refused by name (Apache-2.0). */
export const robotoSlabFace = (): DeckFace => ({ family: 'Roboto Slab', href: 'https://fonts.googleapis.com/css2?family=Roboto+Slab', google: { request: 'https://fonts.googleapis.com/css2?family=Roboto+Slab', refused: 'Apache-2.0' } });
export const ROBOTO_SLAB_REFUSAL = 'Roboto Slab is Apache-2.0 on Google Fonts; MAWS fetches only OFL faces, so it draws as its fallback; upload a font file to use it';

/** Today's shapes: an uploaded file, a Google Fonts link with no record (never fetched before D19), a blob upload. */
export const TODAYS_FACES: Record<string, DeckFace> = {
  'brand-sans': { family: 'Brand Sans', src: 'assets/brand.woff2' },
  'source-serif-4': { family: 'Source Serif 4', href: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap' },
  blob: { family: 'Blob', src: '/_blob/abc' },
};
