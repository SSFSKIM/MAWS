import { describe, expect, it } from 'vitest';
import { CREDENTIAL_KEY, forgetEverything, readPairing, writePairing } from './credential';

function storage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

const CREDENTIAL = 'A'.repeat(43);

describe('the stored pairing (T9, T19)', () => {
  it('is kept under maws.sheet. as { v: 1, id, credential }, and read back', () => {
    const store = storage();
    expect(CREDENTIAL_KEY.startsWith('maws.sheet.')).toBe(true);
    expect(readPairing(store)).toBeNull();
    writePairing({ id: '0a1b2c3d', credential: CREDENTIAL }, store);
    expect(JSON.parse(store.getItem(CREDENTIAL_KEY)!)).toEqual({ v: 1, id: '0a1b2c3d', credential: CREDENTIAL });
    expect(readPairing(store)).toEqual({ id: '0a1b2c3d', credential: CREDENTIAL });
  });

  it('reads an entry that does not parse, or is not of its shape, as no pairing, and leaves it there', () => {
    for (const value of ['{', '[]', '{"v":2,"id":"0a1b2c3d","credential":"x"}', `{"v":1,"id":"nothex!!","credential":"${CREDENTIAL}"}`, '{"v":1,"id":"0a1b2c3d","credential":"short"}']) {
      const store = storage({ [CREDENTIAL_KEY]: value });
      expect(readPairing(store), value).toBeNull();
      expect(store.getItem(CREDENTIAL_KEY)).toBe(value);
    }
  });

  it('is replaced by a new pairing', () => {
    const store = storage();
    writePairing({ id: '0a1b2c3d', credential: CREDENTIAL }, store);
    writePairing({ id: 'ffffffff', credential: 'B'.repeat(43) }, store);
    expect(readPairing(store)).toEqual({ id: 'ffffffff', credential: 'B'.repeat(43) });
  });

  it('forgetEverything removes every key under maws.sheet. and no other', () => {
    const store = storage({ [CREDENTIAL_KEY]: '{}', 'maws.sheet.draft.s.q1': '{}', 'maws.sheet.outline': 'open', 'maws.other': 'kept', unrelated: 'kept' });
    forgetEverything(store);
    expect(Object.fromEntries(Array.from({ length: store.length }, (_, i) => [store.key(i)!, store.getItem(store.key(i)!)]))).toEqual({ 'maws.other': 'kept', unrelated: 'kept' });
  });
});
