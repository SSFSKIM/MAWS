// The claude export's reading of canon HTML against the canon frames' (review M7b-2): the export runs in main, with no
// DOMParser, so its own reader must take from a canon file exactly the assets the frame loads (`rewriteHtmlAssets`,
// over the DOM the renderer parses). Here under happy-dom, the renderer's parser in tests.
import { describe, expect, it } from 'vitest';
import { newDoc } from '../yjs';
import { claudeExportAssetRefs } from './export';
import complete from './fixtures/complete.tokens.json';
import { writeSystem } from './model';
import { rewriteHtmlAssets } from './page/frame';
import { parseTokens, serializeTokens } from './tokens';

const TOKENS = serializeTokens(parseTokens(complete).tokens!);

function exported(html: string): string[] {
  const doc = newDoc();
  writeSystem(doc, { 'DESIGN.md': '# Check\n', 'tokens.tokens.json': TOKENS, 'layouts/check.html': html }, { route: 'derived', at: 0 });
  return claudeExportAssetRefs(doc);
}
function loaded(html: string): string[] {
  const refs = new Set<string>();
  rewriteHtmlAssets(html, (ref) => (refs.add(ref), `maws-artifact://ds/live/${ref}`));
  return [...refs].sort();
}

describe('the claude export reads canon HTML as the canon frames load it', () => {
  it.each([
    ['a URL attribute’s surrounding spaces', '<section id="s"><img src=" assets/logo.png "><a href="\tassets/sheet.pdf\n">x</a></section>', ['assets/logo.png', 'assets/sheet.pdf']],
    ['an unrelated attribute’s out-of-range reference', '<section id="s"><img src="assets/logo.png" alt="&#x110000; &#0; &#xD800; &#99999999999;"></section>', ['assets/logo.png']],
    ['a read attribute’s invalid reference, as U+FFFD', '<section id="s"><img src="assets/l&#x110000;go.png"></section>', ['assets/l\ufffdgo.png']],
    ['a read attribute’s numeric references', '<section id="s"><img src="assets/&#x4C;ogo&#32;mark.png"></section>', ['assets/Logo mark.png']],
  ])('reads %s as the frame does', (_, html, refs) => {
    expect(loaded(html)).toEqual(refs);
    expect(exported(html)).toEqual(refs);
  });
});
