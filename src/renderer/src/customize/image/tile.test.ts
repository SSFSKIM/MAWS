// UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C): the letter tile is the item's
// monogram on one of the eight author colours, which a hash of its kind and its seed chooses, so the item has the same
// tile wherever it is drawn and on every launch; and the seed is the one string each place names the item by.
import { describe, expect, it } from 'vitest';
import { item } from '../discover/test-items';
import { catalogSeedOf, pluginSeedOf, tileOf } from './tile';

describe('the letter tile', () => {
  it('holds the vectors: FNV-1a of the kind, a zero byte and the seed in lower case, modulo eight, plus one', () => {
    expect(tileOf('plugin', 'berth-notes')).toEqual({ letter: 'B', colour: 4 });
    expect(tileOf('skill', 'csv-export')).toEqual({ letter: 'C', colour: 4 });
    expect(tileOf('connector', 'tides')).toEqual({ letter: 'T', colour: 6 });
    expect(tileOf('connector', 'Tides')).toEqual({ letter: 'T', colour: 6 });
    expect(tileOf('mod', 'to-human')).toEqual({ letter: 'T', colour: 5 });
    expect(tileOf('plugin', 'élan')).toEqual({ letter: 'É', colour: 6 });
  });

  it('takes the kind into the colour, and keeps the monogram’s letter rule', () => {
    const colours = (['plugin', 'skill', 'connector', 'mod'] as const).map((kind) => tileOf(kind, 'harbour').colour);
    expect(new Set(colours).size).toBeGreaterThan(1);
    expect(tileOf('plugin', '42fathoms').letter).toBe('42');
    expect(tileOf('skill', '--').letter).toBe('?');
  });
});

describe('the seed', () => {
  it('a plugin is its install name, the part of its id before the last @', () => {
    expect(pluginSeedOf('berth-notes@harbour-market')).toBe('berth-notes');
    expect(pluginSeedOf('@scoped/berth@harbour-market')).toBe('@scoped/berth');
    expect(pluginSeedOf('berth-notes')).toBe('berth-notes');
  });

  it('a Discover item is its plugin route’s install name, its connector route’s proposed name, else its name', () => {
    const plugin = item({ name: 'Berth Notes', install: { kind: 'plugin', marketplaceSource: 'harbour/market', marketplaceName: 'harbour-market', pluginName: 'berth-notes', ref: null, present: false } });
    expect(catalogSeedOf(plugin)).toBe('berth-notes');
    const connector = item({ kind: 'connector', name: 'Tides Online', install: { kind: 'connector', name: 'tides', url: 'https://mcp.tides.example/mcp', urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'auth_required' } });
    expect(catalogSeedOf(connector)).toBe('tides');
    expect(catalogSeedOf(item({ name: 'Quay Ledger', install: { kind: 'manual', docsUrl: null, reason: 'Not installable by this engine' } }))).toBe('Quay Ledger');
    // the same plugin in My items and in Discover: one tile
    expect(tileOf('plugin', catalogSeedOf(plugin))).toEqual(tileOf('plugin', pluginSeedOf('berth-notes@harbour-market')));
  });
});
