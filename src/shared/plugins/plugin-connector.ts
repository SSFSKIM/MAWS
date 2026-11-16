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

/** Whether a live address is the declared one. `literal`: the same text. `templated`: the live address parses, its origin is the declared literal origin's, and its whole text matches the pattern. Never asked of `templated-origin`. */
export function addressMatches(declared: string, live: string): boolean {
  const form = addressFormOf(declared);
  if (form === 'literal') return declared === live;
  if (form === 'templated-origin') return false;
  let origin: string;
  try {
    origin = new URL(live).origin;
  } catch {
    return false;
  }
  return origin === literalOriginOf(declared) && fitsPattern(declared.split(TEMPLATE), live);
}

// A `${…}` of a templated address: in the pattern, one or more characters of any kind
const TEMPLATE = /\$\{[^}]*\}/;
// Whether `text` is the literal parts in order with one or more characters between each two: the first a prefix, the last
// a suffix, each middle one at its leftmost place past the last, so the answer takes steps bounded by the text's length
// per part whatever the parts are (a backtracking pattern could take exponentially many on an address that fails).
function fitsPattern(parts: readonly string[], text: string): boolean {
  if (parts.length === 1) return text === parts[0]; // a `${` never closed is a character like any other
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const end = text.length - last.length; // where the last part must begin
  if (end < first.length || !text.startsWith(first) || !text.endsWith(last)) return false;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = text.indexOf(part, at + 1);
    if (found === -1) return false;
    at = found + part.length;
  }
  return at + 1 <= end;
}

/** An entry of the session's plugin list (`EngineSessionStatus.plugins`): the manifest name, the key it was installed by, its version. */
export interface SessionPlugin { name: string; source: string | null; version: string | null }
export type PluginInSession = 'ok' | 'not-reported' | 'absent' | 'collision' | 'other-plugin' | 'other-version';

/** The possible owners of an engine name among plugins: those whose `plugin:<name>:` is a prefix of it. */
export function ownersOf<P extends { name: string }>(engineName: string, plugins: readonly P[]): P[] {
  return plugins.filter((plugin) => engineName.startsWith(`plugin:${plugin.name}:`));
}

// Rule (a) (§B): the engine names a plugin's server `plugin:<manifest name>:<server>`, and a manifest name may hold a colon,
// so more than one loaded plugin can build one name; the engine keeps one of them and says nothing. A row is admitted only
// where the session's own report holds exactly one possible owner of its name and that one is the row's plugin.
/** Rule (a). `observedAt` null: the engine has reported no list in this launch. */
export function pluginInSession(row: { name: string; plugin: string; version: string | null }, plugins: readonly SessionPlugin[], observedAt: string | null): PluginInSession {
  if (observedAt === null) return 'not-reported';
  const owners = ownersOf(row.name, plugins);
  if (owners.length === 0) return 'absent';
  if (owners.length > 1) return 'collision';
  const [owner] = owners as [SessionPlugin];
  if (owner.source !== row.plugin) return 'other-plugin';
  if (owner.version !== null && row.version !== null && owner.version !== row.version) return 'other-version';
  return 'ok';
}
