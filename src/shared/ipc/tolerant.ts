// The tolerant reader (P5 O1 M6, OX1): what a receiver whose peer may be another build of its wire major parses with. A
// newer peer may send an object key this build's schema does not know (a minor's new optional field); the reader drops
// it and validates the rest strictly, so builds a minor apart interoperate while a sender's real mistakes still fail.
//
// It is the one deliberate exception to "validators never transform" (charter §12 C1): the accepted value is what was
// sent, less the keys this build does not know. It belongs only where a peer may be another build (the host runtime's
// inputs, main's supervisor's outputs and events, both ends' envelope and handshake), never at the renderer boundary.
// Same-build traffic never reaches the stripping: every sender validates strictly before sending, so the first, strict
// parse accepts it.
import type * as z from 'zod';

export const TOLERANT_PASSES = 8; // strip-and-reparse rounds before the strict failure stands

type Segment = PropertyKey;
interface Strip {
  path: Segment[]; // the object holding the key, from the value's root
  key: string;
}

export function readTolerant<T>(schema: z.ZodType<T>, value: unknown): { ok: true; value: T; dropped: string[] } | { ok: false; error: z.ZodError } {
  const strict = schema.safeParse(value);
  if (strict.success) return { ok: true, value: strict.data, dropped: [] };
  const dropped: string[] = [];
  let current = value;
  let issues = strict.error.issues;
  for (let pass = 0; pass < TOLERANT_PASSES; pass++) {
    const strips = strippable(issues, []);
    if (strips === null || strips.length === 0) break;
    current = without(current, strips);
    for (const { path, key } of strips) dropped.push([...path, key].map(String).join('.'));
    const next = schema.safeParse(current);
    if (next.success) return { ok: true, value: next.data, dropped };
    issues = next.error.issues;
  }
  return { ok: false, error: strict.error };
}

// The keys to strip, or null when the list is not strippable: every issue is an `unrecognized_keys`, or an
// `invalid_union` with at least one option whose own list is strippable. zod 4.6.5 gives a union's option issues paths
// relative to the union's own path (tolerant.test.ts pins it), so they are rebased onto `base` plus that path.
// Of the strippable options, the one dropping the fewest keys is followed (the first, on a tie): an option that knows
// more of the value keeps what it knows, where following the first could drop a key another option reads.
function strippable(issues: readonly z.core.$ZodIssue[], base: Segment[]): Strip[] | null {
  const strips: Strip[] = [];
  for (const issue of issues) {
    const at = [...base, ...issue.path];
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) strips.push({ path: at, key });
      continue;
    }
    if (issue.code !== 'invalid_union') return null;
    let best: Strip[] | null = null;
    for (const option of issue.errors) {
      const found = strippable(option, at);
      if (found !== null && found.length > 0 && (best === null || found.length < best.length)) best = found;
    }
    if (best === null) return null;
    strips.push(...best);
  }
  return strips;
}

// A copy of `value` without the stripped keys: only the containers on a stripped key's path are copied, so the input is
// left as it was sent and a large payload is not cloned whole.
function without(value: unknown, strips: readonly Strip[]): unknown {
  const root: Record<PropertyKey, unknown> = { value };
  const copies = new Set<unknown>();
  const own = (parent: Record<PropertyKey, unknown>, segment: Segment): Record<PropertyKey, unknown> | null => {
    const child = parent[segment];
    if (typeof child !== 'object' || child === null) return null;
    if (copies.has(child)) return child as Record<PropertyKey, unknown>;
    const copy = Array.isArray(child) ? [...(child as unknown[])] : { ...(child as Record<PropertyKey, unknown>) };
    parent[segment] = copy;
    copies.add(copy);
    return copy as Record<PropertyKey, unknown>;
  };
  for (const { path, key } of strips) {
    let node = own(root, 'value');
    for (const segment of path) node = node && own(node, segment);
    if (node) delete node[key];
  }
  return root.value;
}

// A reader's log of what it dropped: one line per message and structural path, at the first concrete path seen for it.
// `message` names what was read (`the input of session.status`, `event session.status`, `envelope req`). An array index
// folds into `[]`, so a list's length never multiplies the lines; distinct fields at distinct places stay distinct. A
// record key (a session id) cannot be told from a property name without the schema, so the set is capped instead: past
// TOLERANT_LOG_CAP distinct paths the log says so once and keeps no more.
export const TOLERANT_LOG_CAP = 256;

export function tolerantLog(write: (line: string) => void): (message: string, dropped: readonly string[]) => void {
  const seen = new Set<string>();
  let full = false;
  return (message, dropped) => {
    for (const path of dropped) {
      if (full) return;
      const key = `${message}\u0000${path.replace(/(^|\.)\d+(?=\.|$)/g, '$1[]')}`;
      if (seen.has(key)) continue;
      if (seen.size === TOLERANT_LOG_CAP) {
        full = true;
        write(`dropped fields past the first ${TOLERANT_LOG_CAP} distinct paths go unlogged from here on`);
        return;
      }
      seen.add(key);
      write(`dropped ${path} from ${message}, a field this build does not know (logged once per message and path)`);
    }
  };
}
