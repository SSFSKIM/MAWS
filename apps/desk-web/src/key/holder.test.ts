// The tab's key holder (the DC5 plan's M2): an unlocked key is kept as long as the owner chose — this tab's life, or
// the device's IndexedDB — and locking forgets it from both.
import { beforeEach, describe, expect, it } from 'vitest';
import { VECTOR_KEY } from '../../test/vectors';
import { keyFingerprint } from './derive';
import { loadDeviceKey, lock, unlock, useKeyHolder } from './holder';
import { memoryKeyStore } from './org-key';

beforeEach(() => useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null }));

describe('unlock', () => {
  it('kept for the session: the tab holds the key, the device keeps nothing', async () => {
    const store = memoryKeyStore();
    const raw = Uint8Array.from(VECTOR_KEY);
    await unlock('org', raw, 'session', store);
    const held = useKeyHolder.getState();
    expect(held).toMatchObject({ state: 'unlocked', kept: 'session' });
    expect(held.fingerprint).toBe(await keyFingerprint(held.key!));
    expect(raw.every((b) => b === 0)).toBe(true); // the bytes are wiped once held
    expect(await store.load('org')).toBeNull();
  });

  it('kept on the device: a later load finds it', async () => {
    const store = memoryKeyStore();
    await unlock('org', Uint8Array.from(VECTOR_KEY), 'device', store);
    const fingerprint = useKeyHolder.getState().fingerprint;
    useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null });
    await loadDeviceKey('org', store);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device', fingerprint });
  });

  it('kept for the session after the device kept one: the device forgets it', async () => {
    const store = memoryKeyStore();
    await unlock('org', Uint8Array.from(VECTOR_KEY), 'device', store);
    await unlock('org', Uint8Array.from(VECTOR_KEY), 'session', store);
    expect(await store.load('org')).toBeNull();
  });
});

describe('lock', () => {
  it('forgets the key in the tab and on the device', async () => {
    const store = memoryKeyStore();
    await unlock('org', Uint8Array.from(VECTOR_KEY), 'device', store);
    await lock('org', store);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, kept: null, fingerprint: null });
    expect(await store.load('org')).toBeNull();
  });
});
