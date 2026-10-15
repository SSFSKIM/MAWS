// The canon's frames (D14 §4, Decision Log 17): canon is agent-written HTML, untrusted content that §1 puts in frames,
// so each layout, component and the document sample renders in a sandboxed `srcdoc` frame (no scripts, no same origin)
// with `tokens.css` inlined and a policy that loads nothing but inline styles and the system's own assets: images and
// faces from the asset scheme `ArtifactHost.assetUrl` names. Every asset reference is rewritten through it first.
import { assetUrlOf, rewriteCssUrls, type AssetUrl } from '../assets';
import { PRESENTATION_ATTRS } from '../canon';

/** The CSP source of the URLs `toUrl` makes: their origin, or their scheme (`maws-artifact:`) for an opaque one. */
export function assetSource(toUrl: AssetUrl): string | null {
  try {
    const url = new URL(toUrl('assets/probe'));
    return url.origin && url.origin !== 'null' ? url.origin : url.protocol;
  } catch {
    return null;
  }
}

/** The frame's policy: inline styles, and images and faces from the asset source only. */
export function frameCsp(source: string | null): string {
  const assets = source ?? "'none'";
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${assets}; font-src ${assets}`;
}

const URL_ATTRS = ['src', 'href', 'poster', 'xlink:href', 'background', 'data'];

/**
 * Canon HTML with each asset reference loading through `toUrl`, its fragment kept (an SVG `<use>`'s symbol, a paint
 * server's id): URL attributes, `srcset`, `style`, the SVG presentation attributes whose values are CSS (`fill`,
 * `filter`, `mask`, …, the ones the canon check reads as declarations) and `<style>` blocks.
 */
export function rewriteHtmlAssets(html: string, toUrl: AssetUrl): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const asset = (value: string) => assetUrlOf(value, toUrl);
  for (const element of doc.body.querySelectorAll('*')) {
    for (const name of URL_ATTRS) {
      const value = element.getAttribute(name);
      const url = value === null ? null : asset(value);
      if (url) element.setAttribute(name, url);
    }
    const srcset = element.getAttribute('srcset');
    if (srcset !== null) {
      element.setAttribute(
        'srcset',
        srcset
          .split(',')
          .map((candidate) => {
            const [url = '', ...descriptor] = candidate.trim().split(/\s+/);
            return [asset(url) ?? url, ...descriptor].join(' ');
          })
          .join(', '),
      );
    }
    for (const name of ['style', ...PRESENTATION_ATTRS]) {
      const value = element.getAttribute(name);
      if (value !== null) element.setAttribute(name, rewriteCssUrls(value, toUrl));
    }
    if (element.tagName === 'STYLE') element.textContent = rewriteCssUrls(element.textContent ?? '', toUrl);
  }
  return doc.body.innerHTML;
}

/** Style text made safe to stand inside a `<style>` element of an HTML source. */
const styleText = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1');
const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** A whole frame document: the policy, the styles in order, the body. */
export function frameDocument(parts: { csp: string; styles: readonly string[]; body: string }): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${attr(parts.csp)}">`,
    ...parts.styles.filter(Boolean).map((css) => `<style>${styleText(css)}</style>`),
    `</head><body>${parts.body}</body></html>`,
  ].join('');
}
