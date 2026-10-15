// How the exporters fail (M6's fix wave 1, review finding 5; docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// the deliberate fallbacks stay (a loader answering null shows the alt text, an unknown language is plain code), and
// anything unexpected (a loader that rejects, a highlighter that fails) fails the export rather than degrade it
// unseen; M8's caller shows the error.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceOf } from '../convert.fixture';
import * as shiki from '../shiki';
import { exportHtml } from './html';

vi.mock('../shiki', async (original) => {
  const real = await original<typeof import('../shiki')>();
  return { ...real, highlightCode: vi.fn(real.highlightCode) };
});

const image = sourceOf([{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'maws-artifact:as1/a.png', alt: 'Chart', assetId: 'as1' } }] }]);
const code = (language: string) => sourceOf([{ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: 'const x = 1' }] }]);

afterEach(() => vi.mocked(shiki.highlightCode).mockClear());

describe('the HTML export’s failures', () => {
  it('fails when the image loader rejects, and shows the alt text when it answers null', async () => {
    await expect(exportHtml(image, { loadImage: async () => Promise.reject(new Error('asset store offline')) })).rejects.toThrow('asset store offline');
    expect(await exportHtml(image, { loadImage: async () => null })).toContain('<img class="doc-image" data-src="maws-artifact:as1/a.png" alt="Chart" data-asset-id="as1">');
  });

  it('fails when highlighting a known language fails, and writes an unknown language plain', async () => {
    vi.mocked(shiki.highlightCode).mockRejectedValueOnce(new Error('grammar failed to load'));
    await expect(exportHtml(code('ts'))).rejects.toThrow('grammar failed to load');
    const plain = await exportHtml(code('no-such-language'));
    expect(plain).toContain('<pre><code class="language-no-such-language">const x = 1</code></pre>');
    expect(shiki.highlightCode).toHaveBeenCalledTimes(1);
  });
});
