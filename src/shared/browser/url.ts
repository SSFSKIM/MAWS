// The browser's URL rules (E4a execution document, Design §5 and §14). Pure, shared by main (which checks every URL
// before a view sees it) and the renderer (the address field, the `browser` pane of `show_pane`). Only http and https
// reach a page; `about:blank` is main's own empty document and never accepted from anyone else.

export type BrowserUrlCheck = { ok: true; url: string } | { ok: false; scheme: string };

export type ResolvedAddress =
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string }
  | { kind: 'refused'; scheme: string }; // Decision Log 31: the field shows the refused-scheme banner without asking main

const isWebProtocol = (protocol: string) => protocol === 'http:' || protocol === 'https:';

function parse(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

// `url` is the parsed URL's serialisation; `scheme` names a refused protocol ('' for a string that is not a URL).
export function validateBrowserUrl(input: string): BrowserUrlCheck {
  const url = parse(input);
  if (url === null) return { ok: false, scheme: '' };
  return isWebProtocol(url.protocol) ? { ok: true, url: url.href } : { ok: false, scheme: url.protocol };
}

// A search engine URL: http or https, with `%s` where the search text goes.
export function isSearchUrlTemplate(template: string): boolean {
  return template.includes('%s') && validateBrowserUrl(template.replaceAll('%s', 'x')).ok;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;
const DOTTED_NAME = /^(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]*\p{L}[\p{L}\p{N}-]*$/u; // the last label holds a letter, so `1.5` is no host
const PORT_AND_REST = /^(?::\d{1,5})?(?:[/?#]|$)/;

const isLoopback = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || (IPV4.test(host) && host.startsWith('127.'));
const isAddressHost = (host: string) => isLoopback(host) || IPV4.test(host) || IPV6.test(host) || DOTTED_NAME.test(host);

// The host a bare address starts with: a bracketed IPv6 literal, else everything up to a port, path, query or fragment.
function leadingHost(text: string): string {
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    return end === -1 ? '' : text.slice(0, end + 1);
  }
  return text.split(/[:/?#]/, 1)[0];
}

// Typed text, read as Chrome's omnibox would in the cases MAWS needs: text with a space is a search; a bare host
// (`wikipedia.org`, `localhost:3000`, an IPv4 address, `[::1]`) gets `https://`, or `http://` for localhost and
// loopback; an http or https URL stays one; any other scheme is refused; everything else is a search through
// `searchUrl`, whose `%s` takes the encoded text.
export function resolveAddress(text: string, searchUrl: string): ResolvedAddress {
  const typed = text.trim();
  const search = (): ResolvedAddress => ({ kind: 'search', url: searchUrl.replaceAll('%s', encodeURIComponent(typed)), query: typed });
  if (/\s/.test(typed)) return search();

  const host = leadingHost(typed).toLowerCase();
  if (host !== '' && isAddressHost(host) && PORT_AND_REST.test(typed.slice(host.length))) {
    const checked = validateBrowserUrl(`${isLoopback(host) ? 'http' : 'https'}://${typed}`);
    return checked.ok ? { kind: 'url', url: checked.url } : search();
  }

  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(typed)?.[0].toLowerCase();
  if (scheme !== undefined) {
    if (!isWebProtocol(scheme)) return { kind: 'refused', scheme };
    const checked = validateBrowserUrl(typed);
    if (checked.ok) return { kind: 'url', url: checked.url };
  }
  return search();
}

// The address field's unfocused display: the host apart from the rest, with no credentials; nothing at all of a URL
// that is not http or https, so no `javascript:` text is ever drawn as an address.
export function displayUrl(input: string): { scheme: string; host: string; rest: string } {
  const url = parse(input);
  if (url === null) return { scheme: '', host: '', rest: '' };
  if (!isWebProtocol(url.protocol)) return { scheme: url.protocol, host: '', rest: '' };
  const rest = `${url.pathname}${url.search}${url.hash}`;
  return { scheme: url.protocol, host: url.host, rest: rest === '/' ? '' : rest };
}

// A URL's host name, else its path, else the string itself (Codex's rule for the error page's `{host}`).
export function hostOf(input: string): string {
  const url = parse(input);
  return url === null ? input : url.hostname || url.pathname || input;
}
