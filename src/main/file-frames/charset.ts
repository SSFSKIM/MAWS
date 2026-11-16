// An HTML page's Content-Type from its head (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// decision 18; M3, decision 11). Electron decodes a page that declares no charset as windows-1252 whatever the interface
// language (M1, row f), so a UTF-8 page of non-ASCII text that declares nothing reads wrong for everyone. Main says UTF-8
// when the head it read at issue holds no byte-order mark, declares no charset, and is valid UTF-8; otherwise the type
// goes out as it always has and Chromium decides. A pure function of the bytes: the bound is the head itself, so a
// declaration or an invalid byte past it is not seen (the recorded limit). Decision Log 31: a declaration inside a comment
// is none, as Chromium's own scan finds none there.

// What main reads of a file at issue: the type's read, and the bound of the charset check (L8).
export const FRAME_HEAD_BYTES = 64 * 1024;

const META = /<meta(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/iy; // a meta start tag at the scan's place; a quoted value may hold a `>`
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function htmlContentType(head: Uint8Array): 'text/html' | 'text/html; charset=utf-8' {
  return hasByteOrderMark(head) || declaresCharset(head) || !isUtf8(head) ? 'text/html' : 'text/html; charset=utf-8';
}

// UTF-8's mark, or either UTF-16's, at the start
function hasByteOrderMark(head: Uint8Array): boolean {
  return (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) || (head[0] === 0xfe && head[1] === 0xff) || (head[0] === 0xff && head[1] === 0xfe);
}

// A meta element with a `charset` attribute, or one with `http-equiv="content-type"` whose `content` names a charset,
// matched without regard to case anywhere in the head outside a comment. Searched over the bytes read as latin1, so bytes
// of any encoding are searched without being decoded.
function declaresCharset(head: Uint8Array): boolean {
  const text = Buffer.from(head.buffer, head.byteOffset, head.byteLength).toString('latin1');
  for (const tag of metaTags(text)) {
    const attributes = new Map<string, string>();
    for (const [, name, double, single, bare] of tag.slice('<meta'.length).matchAll(ATTRIBUTE)) attributes.set(name!.toLowerCase(), double ?? single ?? bare ?? '');
    if (attributes.has('charset')) return true;
    if (attributes.get('http-equiv')?.trim().toLowerCase() === 'content-type' && /charset\s*=/i.test(attributes.get('content') ?? '')) return true;
  }
  return false;
}

// The meta start tags of the head in order, read as the HTML standard's encoding prescan walks the bytes (Decision Log 31):
// - a comment runs from `<!--` to the first `>` preceded by `--` after its `<` (the two dashes may be the opening's, so
//   `<!-->` is a whole comment), and one never closed runs to the head's end;
// - a meta tag is read whole;
// - any other tag (`<` or `</`, then an ASCII letter) is read to its first space or `>`, then attribute by attribute, a
//   quoted value whole, so a `<!--` or a `<meta` inside a value is neither a comment nor a tag;
// - `<!`, `</` or `<?` followed by anything else runs to the next `>`.
// Wherever the head ends inside one of these, the scan ends.
function* metaTags(text: string): Generator<string> {
  for (let at = text.indexOf('<'); at !== -1; at = text.indexOf('<', at)) {
    if (text.startsWith('<!--', at)) {
      const close = text.indexOf('-->', at + 2);
      if (close === -1) return;
      at = close + 3;
      continue;
    }
    META.lastIndex = at;
    const tag = META.exec(text);
    if (tag !== null) {
      at = META.lastIndex;
      yield tag[0];
      continue;
    }
    const next = text[at + 1];
    const letter = next === '/' ? at + 2 : at + 1;
    if (isAsciiLetter(text[letter])) at = pastTag(text, letter);
    else if (next === '!' || next === '/' || next === '?') at = text.indexOf('>', at + 1) + 1;
    else at += 1;
    if (at <= 0) return; // the head ended inside the tag
  }
}

const isSpace = (c: string | undefined) => c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' ';
const isAsciiLetter = (c: string | undefined) => c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));

// Past a tag that is not `meta`, from its name's first letter, as the prescan's "get an attribute" reads it: to the first
// space or `>`, then attributes until there is none; the place after its `>`, or 0 where the head ends first.
function pastTag(text: string, from: number): number {
  let at = from;
  while (at < text.length && !isSpace(text[at]) && text[at] !== '>') at += 1;
  for (;;) {
    const got = pastAttribute(text, at);
    if (got === null) return 0;
    if (!got.attribute) return got.at + 1;
    at = got.at;
  }
}

// One attribute, read and passed over: where the scan stands after it, and whether there was one (none at the tag's `>`);
// null where the head ends inside it.
function pastAttribute(text: string, from: number): { at: number; attribute: boolean } | null {
  let at = from;
  while (isSpace(text[at]) || text[at] === '/') at += 1;
  if (at >= text.length) return null;
  if (text[at] === '>') return { at, attribute: false };
  // the name: a first byte of any kind (an `=` among them), then up to `=`, a space, `/` or `>`
  for (at += 1; ; at += 1) {
    if (at >= text.length) return null;
    if (text[at] === '=' || isSpace(text[at])) break;
    if (text[at] === '/' || text[at] === '>') return { at, attribute: true };
  }
  while (isSpace(text[at])) at += 1;
  if (at >= text.length) return null;
  if (text[at] !== '=') return { at, attribute: true };
  for (at += 1; isSpace(text[at]); ) at += 1;
  if (at >= text.length) return null;
  const quote = text[at];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, at + 1);
    return close === -1 ? null : { at: close + 1, attribute: true };
  }
  if (quote === '>') return { at, attribute: true };
  for (at += 1; ; at += 1) {
    if (at >= text.length) return null;
    if (isSpace(text[at]) || text[at] === '>') return { at, attribute: true };
  }
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
