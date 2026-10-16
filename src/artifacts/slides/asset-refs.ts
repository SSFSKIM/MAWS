// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D6, D7, D12; the final review's A13 and A14): where a
// slide names an uploaded asset (`assets/<name>`): a picture's `src`, and a style's `url(…)` (a section's or an
// element's `background`, the picture fill `background-clip:text` draws glyphs with). Every exporter and the mirror
// carry the same set, so a picture named in CSS travels like one named by `src`. Styles here are canonical (the loader's
// `url(<ref>)`, unquoted). Portable.
import type { ElementIR, SlideIR } from './ir';

const URL = /url\(([^)\s]*)\)/g;
const isUpload = (ref: string) => ref.startsWith('assets/');

/** The uploaded assets a style value names, in order. */
export function styleAssetRefs(value: string): string[] {
  return [...value.matchAll(URL)].map((m) => m[1]!).filter(isUpload);
}

/** A style value with each uploaded asset's `url(<ref>)` replaced by `to(ref)` (a whole `url(…)`), or kept when it answers null. */
export function mapStyleAssets(value: string, to: (ref: string) => string | null): string {
  return value.replace(URL, (whole, ref: string) => (isUpload(ref) ? (to(ref) ?? whole) : whole));
}

/** A style map with `mapStyleAssets` applied to each value. */
export function mapStyleMapAssets(style: Readonly<Record<string, string>>, to: (ref: string) => string | null): Record<string, string> {
  return Object.fromEntries(Object.entries(style).map(([k, v]) => [k, mapStyleAssets(v, to)]));
}

/** Every uploaded asset a slide draws: its pictures' sources and its styles' urls (the section's included). */
export function slideAssetRefs(slide: Pick<SlideIR, 'style' | 'children'>): string[] {
  const refs = new Set<string>();
  const ofStyle = (style: Readonly<Record<string, string>>) => Object.values(style).forEach((v) => styleAssetRefs(v).forEach((ref) => refs.add(ref)));
  const walk = (els: ElementIR[]) => {
    for (const el of els) {
      if (el.tag === 'img' && el.attrs.src !== undefined && isUpload(el.attrs.src)) refs.add(el.attrs.src);
      ofStyle(el.style);
      walk(el.children);
    }
  };
  ofStyle(slide.style);
  walk(slide.children);
  return [...refs];
}
