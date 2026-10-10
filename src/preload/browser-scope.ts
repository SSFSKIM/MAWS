// cua board #90: the documents the browser preload acts in. The preload is the partition session's, so Chromium runs it
// in every document of the partition, an imported extension's own pages among them (its popup, its options page, an
// MV2 background page, an offscreen document: the S1 spike's measure). It belongs to the pages a tab shows: http and
// https, and the about:blank a page's `window.open` child starts as and its opener may write into. Imported from
// `browser.ts` alone, with nothing of its own to import, so Rollup inlines it.
export function browserPreloadActs(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:' || protocol === 'about:';
}
