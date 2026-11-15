// A connector that an installed plugin's files declare (the UX wave's U11h, docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md,
// §B). Pure and zod-free: the engine host words a row's address by it, and the services hold a sign-in from that row to it,
// so the two cannot disagree about which addresses a row may sign in at.
//
// The engine fills each `${…}` of a plugin server's address from its launch's environment and reports the address filled
// (spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt, 4). MAWS never sees that environment, so a templated
// address is signed in from a row only where its origin is written out: the strict form below.

export type AddressForm = 'literal' | 'templated' | 'templated-origin';

// The strict form's head: `http` or `https` in lower case, `://`, then the authority, up to the first `/`, `?` or `#`.
const HEAD = /^(https?):\/\/([^/?#]*)/;
// What the authority of the strict form may not hold: a `$` (a template), a backslash (which the URL parser reads as a
// slash), whitespace or a control character (which it drops), `@` (userinfo, which would move the host).
const UNSAFE_AUTHORITY = /[$\\@\s\p{Cc}]/u;

/** The literal origin a templated address declares, by the URL parser over its head; null where it is not in the strict form. */
function literalOriginOf(url: string): string | null {
  const head = HEAD.exec(url);
  if (head === null) return null;
  const [whole, scheme, authority] = head as unknown as [string, string, string];
  if (authority === '' || UNSAFE_AUTHORITY.test(authority)) return null;
  let origin: string;
  try {
    origin = new URL(whole).origin;
  } catch {
    return null;
  }
  return origin.startsWith(`${scheme}://`) ? origin : null;
}

/** The shape of a declared address, never its text: `literal` with no `${`; `templated` where a `${` follows a literal
 * origin in the strict form; `templated-origin` for any other address with a `${`, which no row signs in at. */
export function addressFormOf(url: string): AddressForm {
  if (!url.includes('${')) return 'literal';
  return literalOriginOf(url) === null ? 'templated-origin' : 'templated';
}
