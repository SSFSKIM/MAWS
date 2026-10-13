// The HTML import (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): ProseMirror's DOMParser over the
// schema, on a sanitised inert document (scripts, styles and handlers gone, addresses `https:` and `maws-artifact:`
// only for what loads), in the renderer as paste is. Equivalent Markdown and HTML read to the same content, and the
// HTML and Markdown exports of the every-kind fixture read back to it.
import { describe, expect, it } from 'vitest';
import corpus from '../../../../test/fixtures/document/corpus.md?raw';
import page from '../../../../test/fixtures/document/page.html?raw';
import { comparable, everyKindSource } from '../convert.fixture';
import { exportHtml } from '../export/html';
import { exportMarkdown } from '../export/markdown';
import { importHtml } from './html';
import { importMarkdown } from './markdown';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('importHtml', () => {
  it('reads a page to the same content as the equivalent Markdown', async () => {
    const fromHtml = await importHtml(page);
    fromHtml.check();
    expect(comparable(fromHtml)).toEqual(comparable(importMarkdown(corpus)));
  });

  it('mints a fresh id for every block, whatever ids the page carries', async () => {
    const body = await importHtml('<p data-id="dup">One</p><p data-id="dup">Two</p><ul><li>Three</li></ul>');
    const ids: string[] = [];
    body.descendants((node) => void (node.isBlock && ids.push(String(node.attrs.id))));
    expect(ids).toHaveLength(5); // two paragraphs, the list, its item and the item's paragraph
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{8}$/);
    expect(new Set(ids).size).toBe(5);
  });

  it('drops what could run or load from elsewhere and keeps the text', async () => {
    const body = await importHtml(
      [
        '<p onclick="steal()">Click <a href="javascript:steal()">here</a> or <a href="https://example.com/ok" onmouseover="steal()">there</a>.</p>',
        '<script>steal()</script><style>p { color: red }</style><iframe src="https://example.com/frame"></iframe>',
        '<p>Pictures: <img src="http://example.com/plain.png" alt="plain"><img src="file:///etc/passwd" alt="file">',
        '<img src="//example.com/relative.png" alt="relative"><img src="https://example.com/ok.png" alt="ok"></p>',
        '<p><a href="mailto:owner@example.com">Mail</a> <a href="/relative">relative</a></p>',
      ].join(''),
    );
    const json = JSON.stringify(body.toJSON());
    expect(body.textContent).toBe('Click here or there.Pictures: Mail relative');
    expect(json).not.toMatch(/javascript:|steal|file:|http:\/\/|\/\/example\.com\/relative|frame|\/relative"/);
    const images: unknown[] = [];
    const links: unknown[] = [];
    body.descendants((node) => {
      if (node.type.name === 'image') images.push(node.attrs.src);
      for (const mark of node.marks) if (mark.type.name === 'link') links.push(mark.attrs.href);
    });
    expect(images).toEqual(['https://example.com/ok.png']);
    expect(links).toEqual(['https://example.com/ok', 'mailto:owner@example.com']);
  });

  it('uploads an inline picture as an asset, and drops it when nothing can upload it', async () => {
    const uploads: Array<{ bytes: number[]; name: string; mime: string }> = [];
    const html = '<p>Logo <img src="data:image/png;base64,iVBORw0KGgoBAgM=" alt="Logo"></p>';
    const body = await importHtml(html, {
      uploadAsset: async (bytes, meta) => {
        uploads.push({ bytes: [...bytes], ...meta });
        return { assetId: 'as9', ref: 'maws-artifact:as9/image-1.png' };
      },
    });
    expect(uploads).toEqual([{ bytes: [...PNG], name: 'image-1.png', mime: 'image/png' }]);
    expect(body.firstChild?.child(1).attrs).toEqual({ src: 'maws-artifact:as9/image-1.png', alt: 'Logo', assetId: 'as9' });
    expect((await importHtml(html)).textContent).toBe('Logo');
  });

  it('reads the HTML export of the every-kind fixture back to its content, images inlined or referenced', async () => {
    const source = everyKindSource();
    const loadImage = async () => ({ bytes: PNG, mime: 'image/png' });
    for (const options of [{ tab: 'tab-1', loadImage }, { tab: 'tab-1', images: 'reference' as const }]) {
      const back = await importHtml(await exportHtml(source, options));
      expect(comparable(back)).toEqual(comparable(source.tabs[0].body));
    }
  });

  it('reads the Markdown and HTML exports of the every-kind fixture to the same content', async () => {
    const source = everyKindSource();
    const fromHtml = await importHtml(await exportHtml(source, { tab: 'tab-2', images: 'reference' }));
    const fromMarkdown = importMarkdown(exportMarkdown(source, { tab: 'tab-2' }));
    expect(comparable(fromHtml)).toEqual(comparable(fromMarkdown));
    expect(fromHtml.textContent).toContain('안녕하세요, 팀 여러분.');
  });
});
