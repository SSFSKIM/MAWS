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

  it('never parses raw HTML: no script, no raw element, no event handler; the tags read as written (W1)', () => {
    const root = view();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('div[onclick], img[onerror], [onclick], [onerror]')).toBeNull();
    expect(root.textContent).toContain('<b>bold</b>');
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.textContent).toContain('<div onclick="alert(3)">raw block</div>');
  });

  // W1 (A3), the study's exact strings: a tag alone on a line used to open an HTML block that swallowed the next
  // paragraph, and the block was deleted.
  it('keeps every paragraph around a tag alone on a line, and the tag itself', () => {
    const two = render(<Markdown markdown={'<to-human>\nPara1\n\nPara2\n</to-human>'} live={live} />).container;
    expect(two.textContent).toContain('Para1');
    expect(two.textContent).toContain('Para2');
    expect(two.textContent).toContain('<to-human>');
    expect(two.textContent).toContain('</to-human>');
    cleanup();
    const one = render(<Markdown markdown={'<to-human>\nOne paragraph with **bold**\n</to-human>'} live={live} />).container;
    expect(one.textContent).toContain('One paragraph with bold');
    expect(one.querySelector('[data-streamdown="strong"]')?.textContent).toBe('bold'); // what follows the tag is markdown again
    cleanup();
    const list = render(<Markdown markdown={'<to-human>\n- first\n- second\n</to-human>'} live={live} />).container;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent?.split('\n')[0])).toEqual(['first', 'second']); // the closing tag is the last item's lazy continuation line
  });

  it('leaves code untouched and autolinks working', () => {
    const root = render(<Markdown markdown={'Use `<div>` here.\n\n```html\n<p>hi</p>\n```\n\nSee <https://example.com/x>.'} live={live} />).container;
    expect(root.querySelector('code')?.textContent).toBe('<div>');
    expect(root.textContent).toContain('<p>hi</p>');
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('https://example.com/x');
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
