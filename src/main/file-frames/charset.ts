// An HTML page's Content-Type from its head (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// decision 18; M3, decision 11). Electron decodes a page that declares no charset as windows-1252 whatever the interface
// language (M1, row f), so a UTF-8 page of non-ASCII text that declares nothing reads wrong for everyone. Main says UTF-8
// when the head it read at issue holds no byte-order mark, declares no charset, and is valid UTF-8; otherwise the type
// goes out as it always has and Chromium decides. A pure function of the bytes: the bound is the head itself, so a
// declaration or an invalid byte past it is not seen (the recorded limit).

// What main reads of a file at issue: the type's read, and the bound of the charset check (L8).
export const FRAME_HEAD_BYTES = 64 * 1024;

const META = /<meta(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/gi; // a meta start tag; a quoted value may hold a `>`
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function htmlContentType(head: Uint8Array): 'text/html' | 'text/html; charset=utf-8' {
  return hasByteOrderMark(head) || declaresCharset(head) || !isUtf8(head) ? 'text/html' : 'text/html; charset=utf-8';
}

// UTF-8's mark, or either UTF-16's, at the start
function hasByteOrderMark(head: Uint8Array): boolean {
  return (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) || (head[0] === 0xfe && head[1] === 0xff) || (head[0] === 0xff && head[1] === 0xfe);
}

// A meta element with a `charset` attribute, or one with `http-equiv="content-type"` whose `content` names a charset,
// matched without regard to case anywhere in the head. Searched over the bytes read as latin1, so bytes of any encoding
// are searched without being decoded.
function declaresCharset(head: Uint8Array): boolean {
  const text = Buffer.from(head.buffer, head.byteOffset, head.byteLength).toString('latin1');
  for (const [tag] of text.matchAll(META)) {
    const attributes = new Map<string, string>();
    for (const [, name, double, single, bare] of tag.slice('<meta'.length).matchAll(ATTRIBUTE)) attributes.set(name!.toLowerCase(), double ?? single ?? bare ?? '');
    if (attributes.has('charset')) return true;
    if (attributes.get('http-equiv')?.trim().toLowerCase() === 'content-type' && /charset\s*=/i.test(attributes.get('content') ?? '')) return true;
  }
  return false;
}

// A strict decode that holds back a sequence cut short at the end (`stream`), which is not invalid: the read cut it.
function isUtf8(head: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}
