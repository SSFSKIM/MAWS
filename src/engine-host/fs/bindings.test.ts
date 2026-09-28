import { describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { Bindings } from './bindings';

const s = (id: string) => id as SessionId;
const a = (id: string) => id as AppSessionId;

describe('bindings pair engine session ids with app session ids', () => {
  it('answers both directions and null for an unbound id', () => {
    const bindings = new Bindings();
    bindings.bind(s('s1'), a('a1'));
    expect(bindings.appIdOf(s('s1'))).toBe('a1');
    expect(bindings.sessionIdOf(a('a1'))).toBe('s1');
    expect(bindings.appIdOf(s('s2'))).toBeNull();
    expect(bindings.sessionIdOf(a('a2'))).toBeNull();
    expect(bindings.size).toBe(1);
  });

  it('keeps one pair per id: rebinding either side drops the pair it replaces', () => {
    const bindings = new Bindings();
    bindings.bind(s('s1'), a('a1'));
    bindings.bind(s('s1'), a('a2'));
    expect(bindings.sessionIdOf(a('a1'))).toBeNull();
    expect(bindings.appIdOf(s('s1'))).toBe('a2');
    bindings.bind(s('s2'), a('a2'));
    expect(bindings.appIdOf(s('s1'))).toBeNull();
    expect(bindings.sessionIdOf(a('a2'))).toBe('s2');
    expect(bindings.size).toBe(1);
  });

  it('unbinds an app session id, dropping its pair on both sides; an unknown id is a no-op', () => {
    const bindings = new Bindings();
    bindings.bind(s('s1'), a('a1'));
    bindings.bind(s('s2'), a('a2'));
    expect(bindings.unbind(a('a1'))).toBe('s1');
    expect(bindings.sessionIdOf(a('a1'))).toBeNull();
    expect(bindings.appIdOf(s('s1'))).toBeNull();
    expect(bindings.unbind(a('a1'))).toBeNull();
    expect(bindings.appIdOf(s('s2'))).toBe('a2');
    expect(bindings.size).toBe(1);
  });
});
