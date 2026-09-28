import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { transcriptUrlTransform } from './sanitize';

afterEach(cleanup);

const HOSTILE = [
  'Hello <b>bold</b> and <script>alert(1)</script> and <img src="x" onerror="alert(2)">',
  '',
  '<div onclick="alert(3)">raw block</div>',
  '',
  '[js](javascript:alert(4)) [file](file:///etc/passwd) [data](data:text/html;base64,PHNjcmlwdD4=) [vb](vbscript:msgbox(1))',
  '',
  '[site](https://example.com/a) [mail](mailto:me@example.com) [path](src/renderer/x.ts)',
  '',
  '![httpimg](https://example.com/i.png) ![fileimg](file:///tmp/i.png) ![dataimg](data:image/png;base64,iVBORw0KGgo=)',
].join('\n');

describe.each([false, true])('markdown sanitisation (live: %s)', (live) => {
  const view = () => render(<Markdown markdown={HOSTILE} live={live} />).container;

  it('removes raw HTML before parsing: no script, no raw element, no event handler', () => {
    const root = view();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(root.innerHTML).not.toMatch(/onerror|onclick/);
    expect(root.textContent).not.toContain('raw block');
  });

  it('keeps no javascript:, file:, data: or vbscript: href, and reduces those links to their text', () => {
    const root = view();
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => href !== null && /^(javascript|file|data|vbscript):/i.test(href))).toBe(false);
    expect(root.textContent).toContain('js');
    expect(root.textContent).toContain('file');
  });

  it('keeps https and mailto links and turns a scheme-less href into a path chip', () => {
    const hrefs = [...view().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://example.com/a');
    expect(hrefs).toContain('mailto:me@example.com');
    // The path chip (Link.tsx) names the path it opens; it is a button, never a navigable link.
    expect([...view().querySelectorAll('[data-chip="path"]')].map((chip) => chip.getAttribute('title'))).toEqual(['src/renderer/x.ts']);
  });

  it('loads no image by URL: a non-data image becomes an image chip, a data image stays', () => {
    const root = view();
    const sources = [...root.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources.every((src) => src !== null && src.startsWith('data:image/'))).toBe(true);
    const chips = [...root.querySelectorAll('[data-chip="image"]')].map((chip) => chip.getAttribute('title'));
    expect(chips).toContain('https://example.com/i.png');
  });
});

describe('transcriptUrlTransform', () => {
  const node = {} as Parameters<typeof transcriptUrlTransform>[2];
  it.each([
    ['https://a.b/c', 'href', 'https://a.b/c'],
    ['http://a.b/c', 'href', 'http://a.b/c'],
    ['mailto:x@y.z', 'href', 'mailto:x@y.z'],
    ['maws-path:src/x.ts', 'href', 'maws-path:src/x.ts'],
    ['maws-image:https://a.b/i.png', 'href', 'maws-image:https://a.b/i.png'],
    ['JavaScript:alert(1)', 'href', null],
    ['file:///etc/passwd', 'href', null],
    ['data:text/html,x', 'href', null],
    ['vbscript:x', 'href', null],
    ['data:image/png;base64,AA', 'src', 'data:image/png;base64,AA'],
    ['https://a.b/i.png', 'src', null],
  ])('%s as %s → %s', (url, key, expected) => {
    expect(transcriptUrlTransform(url, key, node)).toBe(expected);
  });
});
