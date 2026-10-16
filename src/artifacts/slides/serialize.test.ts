// P3-C M1 (D1): the canonical serializer, and its token-resolving form for the mirror and the Claude export.
import { describe, expect, it } from 'vitest';
import { loadSlide } from './parse';
import { serializeSlide } from './serialize';

const slideOf = (html: string) => {
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  return l.slide;
};

const TOKENS = `<section id="tok" style="background:var(--ds-color-bg); font-family:var(--ds-font-body)">
<h2 id="h" style="color:var(--ds-color-accent, #C00); padding:var(--ds-space-4) var(--ds-space-6); font-size:var(--ds-type-h2-size)">T <span style="color:var(--ds-color-text-muted, #666)">muted</span></h2>
<div id="d" style="gap:var(--ds-space-3); border:2px solid var(--ds-color-border)"></div></section>`;

describe('serializeSlide', () => {
  it('keeps var(--ds-*) through the round trip', () => {
    const once = serializeSlide(slideOf(TOKENS));
    expect(once.match(/var\(--ds-[^)]*\)/g)).toHaveLength(9);
    expect(serializeSlide(slideOf(once))).toBe(once);
  });

  it('resolves tokens to literals for the mirror and the Claude export, leaving out what neither a value nor a fallback gives', () => {
    const values: Record<string, string> = { '--ds-color-bg': '#fbfbf8', '--ds-font-body': 'Inter, sans-serif', '--ds-color-accent': '#2b7a78', '--ds-space-4': '32px', '--ds-space-6': '48px', '--ds-color-border': '#e3e6e4' };
    const out = serializeSlide(slideOf(TOKENS), { resolveVar: (name) => values[name] });
    expect(out).not.toMatch(/var\(/);
    expect(out).toBe(`<section id="tok" style="font-family:Inter, sans-serif; background:#fbfbf8">
  <h2 id="h" style="padding:32px 48px; color:#2b7a78">T <span style="color:#666666">muted</span></h2>
  <div id="d" style="border:2px solid #e3e6e4"></div>
</section>
`);
    expect(loadSlide(out).ok).toBe(true);
  });

  it('writes pinned children under the flow layer first, then the flow, then the pinned ones over it', () => {
    const html = '<section id="s"><p id="under" style="position:absolute; left:0px; top:0px">u</p><p id="flow">f</p><p id="over" style="position:absolute; left:0px; top:0px">o</p><p id="flow2">g</p></section>';
    expect([...serializeSlide(slideOf(html)).matchAll(/ id="([^"]+)"/g)].map((m) => m[1])).toEqual(['s', 'under', 'flow', 'flow2', 'over']);
  });

  it('writes text with minimal escaping and the canonical mark nesting', () => {
    const out = serializeSlide(slideOf('<section id="s"><p id="p"><i><b>a &amp; b</b></i>&nbsp;<u><a href="https://x.test/?a=1&amp;b=2">c &lt; d</a></u><br> e</p></section>'));
    expect(out).toBe('<section id="s">\n  <p id="p"><b><i>a &amp; b</i></b>&#160;<a href="https://x.test/?a=1&amp;b=2"><u>c &lt; d<br></u></a>e</p>\n</section>\n'); // a <br> closes no mark it need not
  });
});
