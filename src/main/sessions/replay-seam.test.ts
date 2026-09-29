import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureIdentity } from '../../../test/support/fixture-session-id';
import { SessionHarness } from '../../../test/support/session-harness';
import { fixtureSessionId, ReplaySeam } from './replay-seam';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const ROOT = join(__dirname, '../../..');
const AUTO = 'spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl';
const BOOT = 'spikes/protocol-probe/fixtures/pass3/trust-bootstrap-recorded.jsonl';

describe('the e2e replay seam', () => {
  it('reads a fixture’s recorded id as the test support does: system/init, else the spawn pin; neither is an error', () => {
    expect(fixtureSessionId(join(ROOT, AUTO))).toBe('9d753242-8280-4bb4-a144-501cf423d6a1');
    expect(fixtureSessionId(join(ROOT, BOOT))).toBe(fixtureIdentity(BOOT).sessionId);
    expect(() => fixtureSessionId(join(ROOT, 'spikes/protocol-probe/fixtures/pass2/trust-attested.jsonl'))).toThrow('no session id');
  });

  it('is off without MAWS_E2E, and hands out each listed fixture once', () => {
    expect(ReplaySeam.fromEnv({ MAWS_E2E_REPLAY_FIXTURES: AUTO }, ROOT)).toBeNull();
    const seam = ReplaySeam.fromEnv({ MAWS_E2E: '1', MAWS_E2E_REPLAY_FIXTURES: `${BOOT}, ${AUTO}` }, ROOT)!;
    expect(seam.take()).toEqual({ path: BOOT, sessionId: fixtureIdentity(BOOT).sessionId });
    expect(seam.take()).toEqual({ path: AUTO, sessionId: '9d753242-8280-4bb4-a144-501cf423d6a1' });
    expect(seam.take()).toBeNull();
  });

  describe('through the service', () => {
    let h: SessionHarness;
    afterEach(() => h.dispose());

    it('gives the bootstrap and the real launch each its fixture and pin, and refuses a launch past the list', async () => {
      h = await new SessionHarness({ replay: new ReplaySeam([BOOT, AUTO], ROOT) }).start();
      const { appSessionId: id } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
      await h.service.startSession(id, { message: null, options: { trust: 'accepted' } });
      expect(await h.settled(id)).toMatchObject({ phase: 'ready', outcome: { engineSessionId: '9d753242-8280-4bb4-a144-501cf423d6a1' } });
      const [bootstrap, real] = h.host.launches;
      expect(bootstrap).toMatchObject({ replay: BOOT, sessionId: fixtureIdentity(BOOT).sessionId });
      expect(real).toMatchObject({ appSessionId: id, replay: AUTO, sessionId: '9d753242-8280-4bb4-a144-501cf423d6a1' });
      const { appSessionId: next } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
      await h.service.startSession(next, { message: null, options: { trust: 'declined' } });
      expect(await h.settled(next)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: expect.stringContaining('MAWS_E2E_REPLAY_FIXTURES has no fixture left') } });
      expect(h.host.launches).toHaveLength(2);
    });
  });
});
