// Whether an HTML page names files beside it (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// "A page that names files beside it"; M5, decision 14; Decision Log 20): a stylesheet, a script, a picture, a media
// source or a frame named by a relative URL or a `file:` URL counts; a `data:` or `blob:` value, a fragment alone, another
// scheme, an empty value and a scheme-relative value do not. Read from the head main already read at issue, and from
// nothing else. Every page here is invented.
import { describe, expect, it } from 'vitest';
import { FRAME_HEAD_BYTES } from './charset';
import { neighboursOf } from './neighbours';

const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));
const page = (body: string) => bytes(`<!doctype html><html><head><title>Quillon ledger</title></head><body><p>Grüße — 회의</p>${body}</body></html>`);

describe('neighboursOf', () => {
  it.each([
    ['a link’s href', '<link rel="stylesheet" href="style.css">'],
    ['a script’s src', '<script src="app.js"></script>'],
    ['an img’s src', '<img src="images/lark.png" alt="">'],
    ['a video’s src', '<video src="clips/tide.webm" controls></video>'],
    ['an audio’s src', '<audio src="../sounds/bell.ogg"></audio>'],
    ['a source’s src', '<video controls><source src="./clips/tide.mp4" type="video/mp4"></video>'],
    ['an iframe’s src', '<iframe src="inner.html"></iframe>'],
    ['an embed’s src', '<embed src="chart.svg" type="image/svg+xml">'],
  ])('%s, with a relative value, counts', (_, tag) => {
    expect(neighboursOf(page(tag))).toBe(true);
  });

  it('a file: value counts', () => {
    expect(neighboursOf(page('<img src="file:///w/invented/lark.png">'))).toBe(true);
    expect(neighboursOf(page("<script src='FILE:app.js'></script>"))).toBe(true);
  });

  it.each([
    ['a data: value does not count', '<img src="data:image/png;base64,iVBORw0KGgo=">'],
    ['a blob: value does not count', '<script src="blob:null/0d4f1c2e"></script>'],
    ['a fragment alone does not count', '<link rel="icon" href="#lark">'],
    ['a value with another scheme does not count', '<link rel="stylesheet" href="https://example.com/style.css"><script src="http://example.com/a.js"></script><iframe src="about:blank"></iframe>'],
    ['an empty value does not count', '<img src=""><script src="  "></script>'],
    ['a scheme-relative value does not count', '<script src="//example.com/app.js"></script>'],
  ])('%s', (_, tag) => {
    expect(neighboursOf(page(tag))).toBe(false);
  });

  it('a self-contained page names none', () => {
    const contained = page('<style>p { margin: 0 }</style><script>document.title = "lark"</script><a href="notes.html">notes</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">');
    expect(neighboursOf(contained)).toBe(false);
    expect(neighboursOf(new Uint8Array())).toBe(false);
  });

  it('attribute and element names in any case', () => {
    expect(neighboursOf(page('<IMG SRC="lark.png">'))).toBe(true);
    expect(neighboursOf(page('<Link Rel=stylesheet HREF=style.css>'))).toBe(true);
    expect(neighboursOf(page('<sCrIpT type="module" Src = "app.js"></sCrIpT>'))).toBe(true);
  });

  it('a page that names one only past the bound is answered as naming none: the recorded limit', () => {
    const filler = `<p>${'quillon '.repeat(FRAME_HEAD_BYTES / 8)}</p>`;
    const whole = page(`${filler}<link rel="stylesheet" href="style.css">`);
    expect(whole.length).toBeGreaterThan(FRAME_HEAD_BYTES);
    expect(neighboursOf(whole.subarray(0, FRAME_HEAD_BYTES))).toBe(false);
  });
});
