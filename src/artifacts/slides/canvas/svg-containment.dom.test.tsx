// P3-C final fix wave B, finding B1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Decision Log 37 (3)): an
// svg's ids stay the svg's: two drawings of one svg (the stage and its thumbnail) each reference their own `#id`s. The
// hostile `<style>` half is the e2e's (presentations.spec.ts, Chromium) and svg-scope.test.ts's (the text written):
// happy-dom reads an svg's `<style>` as raw text and leaves it empty, and never applies it to the document. An HTML
// `<style>` the HTML parser makes inside an svg's `<desc>` or `<title>` (integration points) is an HTML stylesheet,
// which happy-dom applies: that variant is built here as Chromium parses it and contained (B1 re-review 1).
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import { importSlide, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { containSvg } from './elements';
import { SlideCanvas } from './slide-canvas';

const SVG_NS = 'http://www.w3.org/2000/svg';

const HOSTILE = `<section id="s1">
  <svg id="chart" viewBox="0 0 100 50" style="width:400px; height:200px"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs><rect id="r" class="bar" width="10" height="10" fill="url(#g)"/><use href="#r" x="20"/><style>body{display:none!important} .chrome{color:rgb(255,0,0)!important} p{visibility:hidden!important}</style></svg>
</section>`;

function deck(html: string): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: [l.slide.id] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

const mounted: SlideCanvas[] = [];
function mount(doc: Doc): SlideCanvas {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, 's1', host);
  mounted.push(canvas);
  return canvas;
}
afterEach(() => {
  mounted.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/** The element a local reference (`url(#x)` or `#x`) resolves to in the document, as a browser resolves it. */
function target(doc: Document, ref: string): Element | null {
  const id = /#([^)'"\s]+)/.exec(ref)?.[1];
  return id ? doc.getElementById(id) : null;
}

describe('an svg’s stylesheet and ids are its own (B1)', () => {
  for (const host of ['desc', 'title']) {
    it(`a <style> inside the svg’s <${host}> (an HTML stylesheet) leaves the app document’s elements as they were`, () => {
      const markup = `<${host}><style>body{display:none!important} .chrome{color:rgb(255,0,0)!important}</style></${host}><rect width="10" height="10"/>`;
      expect(loadSlide(`<section id="s1"><svg id="chart" viewBox="0 0 10 10">${markup}</svg></section>`).ok).toBe(true); // the loader admits it
      const chrome = document.createElement('p');
      chrome.className = 'chrome';
      chrome.textContent = 'app chrome';
      document.body.appendChild(chrome);
      const before = { body: getComputedStyle(document.body).display, color: getComputedStyle(chrome).color };
      // the tree Chromium's parser builds (happy-dom keeps no integration points): an HTML <style> under the svg's <desc>
      const svg = document.createElementNS(SVG_NS, 'svg');
      const point = svg.appendChild(document.createElementNS(SVG_NS, host));
      point.appendChild(document.createElement('style')).textContent = 'body{display:none!important} .chrome{color:rgb(255,0,0)!important}';
      svg.appendChild(document.createElementNS(SVG_NS, 'rect'));
      containSvg(svg, 'msvg-test');
      document.body.appendChild(svg);
      expect(getComputedStyle(document.body).display).toBe(before.body);
      expect(getComputedStyle(chrome).color).toBe(before.color);
    });
  }

  it('two drawings of one svg each resolve their own #ids (the stage and a thumbnail)', () => {
    const doc = deck(HOSTILE);
    const stage = mount(doc);
    const thumb = mount(doc);
    for (const c of [stage, thumb]) {
      const svg = c.node('chart')!;
      const rect = svg.querySelector('rect')!;
      const fill = target(document, rect.getAttribute('fill') ?? '');
      expect(fill?.tagName.toLowerCase()).toBe('lineargradient');
      expect(svg.contains(fill)).toBe(true);
      const used = target(document, svg.querySelector('use')!.getAttribute('href') ?? '');
      expect(used).toBe(rect);
    }
    // no id of one drawing is the other's
    const ids = (c: SlideCanvas) => [...c.node('chart')!.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids(stage).filter((id) => ids(thumb).includes(id))).toEqual([]);
  });
});
