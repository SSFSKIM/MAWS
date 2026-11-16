// Whether an HTML page names files beside it (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// "A page that names files beside it"; M5, decision 14; the owner's answer to card 2, "Say so"). A page is drawn alone,
// without the stylesheet, the script, the pictures or the frames beside it; when its head names one, the tab says so in
// one line. Read from the head main already read at issue for the charset (`FRAME_HEAD_BYTES`), and from nothing else:
// no file beside the page is read and nothing new is asked of the files service.
//
// What counts: an `href` of a `link`, or a `src` of a `script`, `img`, `video`, `audio`, `source`, `iframe` or `embed`,
// whose value has no scheme or the scheme `file`. What does not: a `data:` or `blob:` value and any other scheme, a
// fragment alone, and (Decision Log 20) an empty value or one that is only a query, which name the page itself, and a
// scheme-relative value (`//host/…`), which names another host. A pure function of the bytes, searched as latin1 without
// regard to case, so bytes of any encoding are searched without being decoded (as `htmlContentType` searches them). The
// bound is the head: a tag that begins or ends past it is not seen (the recorded limit), and a tag written inside a
// comment or a script's text is read as a tag, as the charset check reads one.

// A start tag of the elements that load a file, with its attributes; a quoted value may hold a `>`.
const TAG = /<(link|script|img|video|audio|source|iframe|embed)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export function neighboursOf(head: Uint8Array): boolean {
  const text = Buffer.from(head.buffer, head.byteOffset, head.byteLength).toString('latin1');
  for (const [, element, attributes] of text.matchAll(TAG)) {
    const wanted = element!.toLowerCase() === 'link' ? 'href' : 'src';
    for (const [, name, double, single, bare] of attributes!.matchAll(ATTRIBUTE)) {
      if (name!.toLowerCase() === wanted && namesAFileBeside(double ?? single ?? bare ?? '')) return true;
    }
  }
  return false;
}

// A URL's value as HTML reads it, its surrounding whitespace stripped.
function namesAFileBeside(value: string): boolean {
  const url = value.trim();
  if (url === '' || url.startsWith('#') || url.startsWith('?') || url.startsWith('//')) return false;
  const scheme = SCHEME.exec(url)?.[1];
  return scheme === undefined || scheme.toLowerCase() === 'file';
}
