// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Catalog } from 'desk-hub/protocol';
import { CatalogCache } from './catalog';
const value = (fingerprint: string): Catalog => ({ fingerprint, commands: [], models: { options: ['default'], aliases: {} }, measured: '2.1.307' });
describe('session catalogs', () => {
  it('keeps skill names across cache reloads and refuses malformed membership from disk or the wire', () => {
    localStorage.clear();
    const cache = new CatalogCache(localStorage);
    cache.accept('p/a', { ...value('skills'), skills: ['playwright-cli', 'doperpowers:progress-report'] });
    expect(new CatalogCache(localStorage).get('p/a').catalog?.skills).toEqual(['playwright-cli', 'doperpowers:progress-report']);
    for (const skills of [null, {}, 42, ['ok', 1]]) {
      const bad = { ...value('bad'), skills } as Catalog;
      cache.accept('p/b', bad);
      expect(cache.get('p/b').catalog).toBeNull();
      localStorage.setItem('desk.catalogs', JSON.stringify([['p/b', { catalog: bad, asOf: 1 }]]));
      expect(new CatalogCache(localStorage).get('p/b').catalog).toBeNull();
    }
  });
  it('loads only that session, stale until confirmed, and replaces a changed fingerprint', () => {
    localStorage.clear();
    const cache = new CatalogCache(localStorage);
    cache.accept('p/a', value('one'), 10);
    expect(cache.get('p/b').catalog).toBeNull();
    const reopened = new CatalogCache(localStorage);
    expect(reopened.get('p/a')).toMatchObject({ stale: true, asOf: 10, catalog: { fingerprint: 'one' } });
    reopened.accept('p/a', value('one'), 20);
    expect(reopened.get('p/a').stale).toBe(false);
    reopened.invalidate('p/a');
    expect(reopened.get('p/a').stale).toBe(true);
    reopened.accept('p/a', value('two'), 30);
    expect(reopened.get('p/a')).toMatchObject({ stale: false, catalog: { fingerprint: 'two' } });
  });
  it('retains at most 32 sessions on disk and in memory, and tolerates corrupt or unavailable storage', () => {
    localStorage.clear();
    const cache = new CatalogCache(localStorage);
    for (let i = 0; i < 33; i++) cache.accept(`p/${i}`, value(`${i}`), i);
    expect(cache.get('p/0').catalog).toBeNull();
    expect(new CatalogCache(localStorage).get('p/0').catalog).toBeNull();
    expect(new CatalogCache(localStorage).get('p/32').catalog?.fingerprint).toBe('32');
    localStorage.setItem('desk.catalogs', '{');
    expect(new CatalogCache(localStorage).get('p/32').catalog).toBeNull();
    const unavailable = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
    const memory = new CatalogCache(unavailable);
    memory.accept('p/a', value('one'), 10);
    expect(memory.get('p/a').catalog?.fingerprint).toBe('one');
  });
});
