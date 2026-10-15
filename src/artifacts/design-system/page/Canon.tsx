// D14 §4, the canon rendered in the system: each layout as a 1920×1080 slide scaled to the page's width, each component
// on the system's ground, and `components/document.css` applied to a fixed sample document. Each renders in its own
// sandboxed frame (frame.ts); a change of the system rewrites the frames' sources.
import { useLayoutEffect, useRef, useState } from 'react';
import { fontFaceCss, rewriteCssUrls, type AssetUrl } from '../assets';
import { canonKind, DOCUMENT_CSS_PATH } from '../canon';
import { generateTokensCss } from '../css';
import type { TokenSet } from '../tokens';
import { assetSource, frameCsp, frameDocument, rewriteHtmlAssets } from './frame';

const SLIDE = { width: 1920, height: 1080 };
const BASE = 'html, body { margin: 0; }';
const SLIDE_BASE = `body { width: ${SLIDE.width}px; height: ${SLIDE.height}px; overflow: hidden; } body > section { width: ${SLIDE.width}px; height: ${SLIDE.height}px; box-sizing: border-box; overflow: hidden; }`;
const COMPONENT_BASE = 'body { padding: 24px; background: var(--ds-color-bg); }';

// A US high-school handout (the product's frame, the spec's Decision Log 6), in the blocks B's editor writes.
export const SAMPLE_DOCUMENT = `<article class="ds-doc">
<h1>Lab 4: Does air have mass?</h1>
<p>AP Chemistry, Period 2 · Due Friday, October 23</p>
<h2>Purpose</h2>
<p>Measure the mass of a volume of air and compare it with the value the <strong>ideal gas law</strong> predicts. Record every reading in the table below, with its <em>unit</em>.</p>
<blockquote>Write what you observed before you write what it means.</blockquote>
<h3>Materials</h3>
<ul><li>A sealed 2 L bottle and a hand pump</li><li>A balance reading to 0.01 g</li><li>A thermometer</li></ul>
<ol><li>Weigh the empty bottle.</li><li>Pump in twenty strokes and weigh it again.</li></ol>
<div data-callout-tone="warn"><p>Wear goggles while the bottle is under pressure.</p></div>
<div data-callout-tone="info"><p>Use <code>PV = nRT</code> with R = 0.0821 L·atm/(mol·K).</p></div>
<table><thead><tr><th>Reading</th><th>Mass (g)</th></tr></thead><tbody><tr><td>Empty</td><td>51.32</td></tr><tr><td>After 20 strokes</td><td>52.07</td></tr></tbody></table>
<hr>
<pre><code>Δm = 52.07 g − 51.32 g = 0.75 g</code></pre>
</article>`;

/** The frames' sources for a system's canon, from its tokens and files, its assets loading through `toUrl`. */
export function canonFrames(tokens: TokenSet, files: Readonly<Record<string, string>>, toUrl: AssetUrl) {
  const csp = frameCsp(assetSource(toUrl));
  const documentCss = files[DOCUMENT_CSS_PATH];
  const faces = fontFaceCss(documentCss, tokens, toUrl);
  const deck = generateTokensCss(tokens, { medium: 'deck' });
  const html = (path: string) => rewriteHtmlAssets(files[path]!, toUrl);
  const paths = Object.keys(files).sort();
  return {
    layouts: paths
      .filter((path) => canonKind(path) === 'layout')
      .map((path) => ({ path, srcDoc: frameDocument({ csp, styles: [BASE, SLIDE_BASE, faces, deck], body: html(path) }) })),
    components: paths
      .filter((path) => canonKind(path) === 'component')
      .map((path) => ({ path, srcDoc: frameDocument({ csp, styles: [BASE, COMPONENT_BASE, faces, deck], body: html(path) }) })),
    document:
      documentCss === undefined
        ? null
        : frameDocument({ csp, styles: [BASE, generateTokensCss(tokens, { medium: 'document' }), rewriteCssUrls(documentCss, toUrl)], body: SAMPLE_DOCUMENT }),
  };
}

/** A slide frame drawn at 1920×1080 and scaled to its box's width. */
function SlideFrame(props: { title: string; srcDoc: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setScale(width / SLIDE.width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="dsp-slide" style={{ aspectRatio: `${SLIDE.width} / ${SLIDE.height}` }}>
      <iframe
        title={props.title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={props.srcDoc}
        width={SLIDE.width}
        height={SLIDE.height}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}

export function Canon(props: { tokens: TokenSet; files: Readonly<Record<string, string>>; toUrl: AssetUrl }) {
  const frames = canonFrames(props.tokens, props.files, props.toUrl);
  const empty = !frames.layouts.length && !frames.components.length && frames.document === null;
  return (
    <section className="dsp-section" data-ds-section="canon" aria-labelledby="dsp-canon">
      <h2 id="dsp-canon" className="dsp-heading">
        Canon
      </h2>
      {empty ? <p className="dsp-muted">No layouts, components or document styles yet.</p> : null}
      {frames.layouts.length ? (
        <div className="dsp-canon-grid">
          {frames.layouts.map((frame) => (
            <figure key={frame.path} className="dsp-canon-item">
              <SlideFrame title={frame.path} srcDoc={frame.srcDoc} />
              <figcaption className="dsp-name">{frame.path}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {frames.components.length ? (
        <div className="dsp-canon-grid">
          {frames.components.map((frame) => (
            <figure key={frame.path} className="dsp-canon-item">
              <iframe title={frame.path} sandbox="" referrerPolicy="no-referrer" srcDoc={frame.srcDoc} className="dsp-component-frame" />
              <figcaption className="dsp-name">{frame.path}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {frames.document !== null ? (
        <figure className="dsp-canon-item">
          <iframe title={DOCUMENT_CSS_PATH} sandbox="" referrerPolicy="no-referrer" srcDoc={frames.document} className="dsp-document-frame" />
          <figcaption className="dsp-name">{DOCUMENT_CSS_PATH} on a sample handout</figcaption>
        </figure>
      ) : null}
    </section>
  );
}
