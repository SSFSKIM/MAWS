// An item's letter tile (UX wave U11c M1, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C; the child's
// O-14, "The letter tile"): its monogram on one of the eight author colours. The colour is one more than the 32-bit
// FNV-1a hash of the kind, a zero byte and the seed in lower case, modulo 8, so an item has the same tile wherever it is
// drawn and on every launch. The seed is the one string every place names the item by (the plan's table).
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { monogramOf } from '../discover/present';

export type ItemKind = 'plugin' | 'skill' | 'connector' | 'mod';
export type TileColour = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const OFFSET = 2166136261;
const PRIME = 16777619;
const utf8 = new TextEncoder();

function fnv1a(bytes: Uint8Array): number {
  let hash = OFFSET;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, PRIME) >>> 0;
  return hash;
}

export function tileOf(kind: ItemKind, seed: string): { letter: string; colour: TileColour } {
  const kindBytes = utf8.encode(kind);
  const seedBytes = utf8.encode(seed.toLowerCase());
  const bytes = new Uint8Array(kindBytes.length + 1 + seedBytes.length);
  bytes.set(kindBytes, 0);
  bytes.set(seedBytes, kindBytes.length + 1); // the zero byte between them is the array's own
  return { letter: monogramOf(seed), colour: ((fnv1a(bytes) % 8) + 1) as TileColour };
}

/** An installed plugin's seed: its install name, the part of its id (`<name>@<marketplace>`) before the last `@`. */
export const pluginSeedOf = (id: string): string => {
  const at = id.lastIndexOf('@');
  return at > 0 ? id.slice(0, at) : id;
};

/** A Discover item's seed: the plugin its route installs, else the name the connector's add proposes, else its name. */
export const catalogSeedOf = (item: Pick<CatalogItem, 'name' | 'install'>): string =>
  item.install.kind === 'plugin' ? item.install.pluginName : item.install.kind === 'connector' ? item.install.name : item.name;
