// sminos's declared channels and threads, the shared vectors (vectors/channel-rule.json; Interfaces §B of
// docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md): the file holds §B's shape, and every `ids` entry answers
// through `isChannelId` as its `channel` says. The `retired` cases are run by the app's reader and its kept lifecycle
// (src/main/org/channel/address.test.ts, cache.test.ts); sminos's suite runs both halves from its own copy.
import { describe, expect, it } from 'vitest';
import { CHANNEL_ID, isChannelId } from '../src/index.ts';
import { CHANNEL_RULE } from '../vectors/index.ts';

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
/** `v` has every one of `required` and nothing beyond `optional`. */
const shaped = (v: unknown, required: string[], optional: string[] = []): v is Fields =>
  isObject(v) && required.every((k) => k in v) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

describe('the channel rule vectors', () => {
  const raw: unknown = CHANNEL_RULE;

  it("hold §B's shape at version 1", () => {
    expect(shaped(raw, ['about', 'version', 'ids', 'retired'])).toBe(true);
    expect(isText(CHANNEL_RULE.about)).toBe(true);
    expect(Number.isInteger(CHANNEL_RULE.version) && CHANNEL_RULE.version > 0).toBe(true);
    expect(CHANNEL_RULE.version).toBe(1);
    for (const e of CHANNEL_RULE.ids as unknown[]) {
      expect(shaped(e, ['id', 'channel', 'why']), JSON.stringify(e)).toBe(true);
      const { id, channel, why } = e as Fields;
      expect(typeof id === 'string' && typeof channel === 'boolean' && isText(why), JSON.stringify(e)).toBe(true);
    }
    const answers = new Set(CHANNEL_RULE.ids.map((e) => e.channel));
    expect([...answers].sort()).toEqual([false, true]);
    for (const c of CHANNEL_RULE.retired as unknown[]) {
      expect(shaped(c, ['name', 'steps']) && isText((c as Fields).name), JSON.stringify(c)).toBe(true);
      const steps = (c as Fields).steps;
      expect(Array.isArray(steps) && steps.length > 0, JSON.stringify(c)).toBe(true);
      for (const s of steps as unknown[]) {
        expect(shaped(s, ['event', 'member']) && typeof (s as Fields).member === 'boolean', JSON.stringify(s)).toBe(true);
        const event = (s as Fields).event;
        expect(shaped(event, ['kind'], ['reason', 'thread']), JSON.stringify(s)).toBe(true);
        expect(['joined', 'retired'], JSON.stringify(s)).toContain((event as Fields).kind);
      }
    }
    const names = CHANNEL_RULE.retired.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('hold the parent four retired cases, in its order', () => {
    expect(CHANNEL_RULE.retired.map((c) => c.name)).toEqual([
      'a stamped joined, then an unstamped ended: still a member',
      'then an unstamped moved: a member no more',
      'a stamped ended after the unstamped one: a member no more',
      'an unstamped joined, then an unstamped ended: a member no more',
    ]);
  });

  it('answer every id through isChannelId as its channel says', () => {
    for (const { id, channel, why } of CHANNEL_RULE.ids) expect(isChannelId(id), `${JSON.stringify(id)}: ${why}`).toBe(channel);
  });

  it('hold the entries a pattern most easily gets wrong', () => {
    const ids = CHANNEL_RULE.ids.map((e) => e.id);
    expect(ids).toContain('5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c\n');
    expect(ids).toContain('5C2A9E10-7B3D-8F41-9A6C-2D4E6F8A0B1C');
    expect(ids).toContain('');
  });

  it('call nothing but a string a channel id', () => {
    for (const v of [undefined, null, 8, true, {}, [], ['5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c'], new String('5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c')]) {
      expect(isChannelId(v), String(v)).toBe(false);
    }
  });

  it('keep the pattern a stateless test', () => {
    // A global or sticky flag would make `test` remember where it stopped, and answer one id two ways.
    expect(CHANNEL_ID.flags).toBe('');
    const id = '5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c';
    expect([isChannelId(id), isChannelId(id)]).toEqual([true, true]);
  });
});
