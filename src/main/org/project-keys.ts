// The key table (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §I, "The key
// table" and "`moved`"; design §2, "A row's layout key on a device is assigned once and kept"): each project id's row
// key on this device, kept by main in `<userData>/org/project-keys.json` (M10's decision: one per device whatever the
// number of windows, and a build rolled back ignores a file it does not know).
//
// - An id gets its key the first time main sees it, as a registry location's or on one of this device's own rows. The
//   key is the label (`org.key`) of one of this device's rows that carry the id, a declared row before any other and
//   then in the rows' order, provided the row is not linked into the id and the label is not already another id's key;
//   else `id:<id>`. Ids first seen together are taken in id order. An entry never changes, so a key belongs to one id:
//   two clones with one label and two ids, one of them linked, are two keys.
// - The table also keeps, per id, the locations (machine and the row's `pid`) the id last had, updated whenever it has
//   any. `moved` is computed from them at each emission and never kept: the key of each id that has no row now maps to
//   the key of the project that carries the first of its last locations now. A location is looked up where it is now,
//   so an id whose locations moved twice maps straight to their present project, and an id with a row again has no
//   entry: nothing stale redirects a project that came back and was later removed.
//
// Pure: the registry (project-registry.ts) reads and writes the file.
import { idKey, type OrgKey } from '@shared/machine/org-key';

export const PROJECT_KEYS_FILE = 'project-keys.json';

/** Where a location is: a machine and its row's id there. */
export type Place = { machine: string; pid: string };
/** A location now, and the project it is in (null: its machine's own project, which no key names). */
export type Carrier = Place & { id: string | null };
/** One of this device's own rows that is not hidden: its place (this machine, the row's id), its project and label. */
export type OwnRow = Carrier & { key: OrgKey; declared: boolean; linked: boolean };
export type KeysFile = { version: 1; keys: Record<string, OrgKey>; last: Record<string, Place[]> };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPlace = (value: unknown): value is Place => isObject(value) && typeof value.machine === 'string' && typeof value.pid === 'string';
export const isKeysFile = (value: unknown): value is KeysFile => isObject(value) && value.version === 1 && isObject(value.keys) && isObject(value.last);
const placeOf = (p: Place) => `${p.machine}/${p.pid}`;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class KeyTable {
  readonly #keys = new Map<string, OrgKey>();
  readonly #last = new Map<string, Place[]>();

  constructor(file: KeysFile | null) {
    if (file === null) return;
    for (const [id, key] of Object.entries(file.keys)) if (typeof key === 'string' && key !== '') this.#keys.set(id, key as OrgKey);
    for (const [id, places] of Object.entries(file.last)) if (Array.isArray(places)) this.#last.set(id, places.filter(isPlace).map((p) => ({ machine: p.machine, pid: p.pid })));
  }

  /** Every id carried now gets its key, once, and its locations are recorded; whether the table moved (to be written). */
  update(registry: readonly Carrier[], own: readonly OwnRow[]): boolean {
    let moved = false;
    const taken = new Set(this.#keys.values());
    const fresh = [...new Set([...registry, ...own].flatMap((c) => (c.id === null || this.#keys.has(c.id) ? [] : [c.id])))].sort(byText);
    for (const id of fresh) {
      const lender = [...own.filter((r) => r.declared), ...own.filter((r) => !r.declared)].find((r) => r.id === id && !r.linked && !taken.has(r.key));
      const key = lender?.key ?? idKey(id);
      this.#keys.set(id, key);
      taken.add(key);
      moved = true;
    }
    for (const [id, places] of carried(registry, own)) {
      const before = this.#last.get(id);
      if (before !== undefined && before.length === places.length && before.every((p, i) => placeOf(p) === placeOf(places[i]))) continue;
      this.#last.set(id, places);
      moved = true;
    }
    return moved;
  }

  keyOf(id: string): OrgKey | null {
    return this.#keys.get(id) ?? null;
  }

  keys(): Record<string, OrgKey> {
    return Object.fromEntries(this.#keys);
  }

  /** The key of each id with no row now → the key of the project that carries the first of its last locations now. */
  moved(registry: readonly Carrier[], own: readonly OwnRow[]): Record<string, OrgKey> {
    const now = carried(registry, own);
    const where = new Map<string, string>();
    for (const c of [...registry, ...own]) if (c.id !== null && !where.has(placeOf(c))) where.set(placeOf(c), c.id);
    const out: Record<string, OrgKey> = {};
    for (const [id, key] of this.#keys) {
      if (now.has(id)) continue;
      for (const place of this.#last.get(id) ?? []) {
        const there = where.get(placeOf(place));
        const target = there === undefined ? null : this.#keys.get(there);
        if (target === undefined || target === null) continue;
        if (target !== key) out[key] = target;
        break;
      }
    }
    return out;
  }

  file(): KeysFile {
    return { version: 1, keys: this.keys(), last: Object.fromEntries(this.#last) };
  }
}

/** Each id carried now, with its places: the registry's in their order, then this device's rows not among them. */
function carried(registry: readonly Carrier[], own: readonly OwnRow[]): Map<string, Place[]> {
  const out = new Map<string, Place[]>();
  const seen = new Set<string>();
  for (const c of [...registry, ...own]) {
    if (c.id === null || seen.has(`${c.id}\n${placeOf(c)}`)) continue;
    seen.add(`${c.id}\n${placeOf(c)}`);
    out.set(c.id, [...(out.get(c.id) ?? []), { machine: c.machine, pid: c.pid }]);
  }
  return out;
}
