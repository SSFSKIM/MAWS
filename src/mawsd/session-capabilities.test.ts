import { describe, expect, it } from 'vitest';
import { daemonCuaSocketPath } from '@shared/browser/cua-socket';
import { cuaSocketDir, renderCuaSocketDir, socketFallbackDir } from '@shared/daemon/files';
import { defaultProfileDir } from '@shared/daemon/profile';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionCapability } from '@shared/ipc/schema/session-capabilities';
import { oldHostReason } from './browser-work';
import { browserCapability, createSessionCapabilities, headlessReason, renderCapabilities, type HeadlessFacts } from './session-capabilities';

// A session's capabilities on this machine (P5 O5 M5; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §I;
// acceptance 9): the render entries from the render seam's state (cold when it is not loaded), the browser entry from
// the cua sockets', each with the exact reason the renderer and O7 show; the event follows each flip once.

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const available: SessionCapability = { available: true };

describe('the render entries', () => {
  const facts = { machine: 'mini', runtime: { available: true } as const, failure: null, engineHostRenders: true, appAttached: false };

  it('are available while the runtime is present, the seam has not failed and the engine host renders', () => {
    expect(renderCapabilities(facts)).toEqual({ artifact_screenshot: available, artifact_export: available });
  });

  it('say why, in order: the runtime absent, the seam failed, an engine host that predates the render service with no app', () => {
    const absent = renderCapabilities({ ...facts, runtime: { available: false, reason: 'the render runtime is not installed on mini' }, failure: 'x', engineHostRenders: false });
    expect(absent.artifact_screenshot).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render runtime is not installed on mini' });
    expect(renderCapabilities({ ...facts, failure: 'the render host failed: no display', engineHostRenders: false }).artifact_export).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render host failed: no display' });
    expect(renderCapabilities({ ...facts, engineHostRenders: false }).artifact_screenshot).toEqual({ available: false, reason: 'the engine host on mini predates the render service; it is replaced when idle' });
    expect(renderCapabilities({ ...facts, engineHostRenders: false, appAttached: true }).artifact_screenshot).toEqual(available); // its events still reach the seam
  });
});

describe('the browser entry (P5 O17 M5, Interfaces §I)', () => {
  const TOO_LONG = { available: false, reason: 'the browser socket of this session is longer than a Unix socket allows on mini' };
  const local = { available: true, viewed: 'local' };
  const screencast = { available: true, viewed: 'screencast' };
  const at = { machine: 'mini', appSessionId: A, path: '/p/mawsd/cua/A.sock', renderPath: '/p/mawsd/rcua/A.sock' };

  it('reads the app’s pane while an app is attached, the screencast while the headless browser is usable, else its reason', () => {
    expect(browserCapability({ ...at, tabEngine: '/u/browser/cua', headless: 'whatever' })).toEqual(local); // an app first
    expect(browserCapability({ ...at, tabEngine: null, headless: null })).toEqual(screencast);
    expect(browserCapability({ ...at, tabEngine: null, headless: 'the reason' })).toEqual({ available: false, reason: 'the reason' });
    expect(browserCapability({ ...at, path: null, tabEngine: '/u/browser/cua', headless: null })).toEqual(TOO_LONG);
    expect(browserCapability({ ...at, path: null, tabEngine: null, headless: null })).toEqual(TOO_LONG);
  });

  // P5 O17 (the session sockets' names, 2026-11-03): the render host's socket for the session is the headless browser's,
  // so one that cannot fit is named before any use, never `available: true` with a path the first browser call fails on
  it('says the path does not fit when the render host\'s socket for the session does not, though the daemon\'s does', () => {
    expect(browserCapability({ ...at, renderPath: null, tabEngine: null, headless: null })).toEqual(TOO_LONG);
    expect(browserCapability({ ...at, renderPath: null, tabEngine: null, headless: 'the reason' })).toEqual({ available: false, reason: 'the reason' }); // the machine's reason first
    expect(browserCapability({ ...at, renderPath: null, tabEngine: '/u/browser/cua', headless: null })).toEqual(local); // an app's tabs need none
  });

  // the relay connects to the tab engine's own socket for the session: a daemon socket that fits (102 bytes) is no browser
  // when the app's (104) does not
  it('says the path does not fit when the tab engine\'s socket for the session does not, though the daemon\'s does', () => {
    const id = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73' as AppSessionId;
    const daemonDir = `/${'d'.repeat(59)}`; // + '/' + 36 + '.sock' = 102 bytes
    const appDir = `/${'a'.repeat(61)}`; // 104 bytes
    expect(Buffer.byteLength(`${daemonDir}/${id}.sock`)).toBe(102);
    expect(Buffer.byteLength(`${appDir}/${id}.sock`)).toBe(104);
    expect(browserCapability({ machine: 'mini', appSessionId: id, path: `${daemonDir}/${id}.sock`, renderPath: null, tabEngine: appDir, headless: null })).toEqual(TOO_LONG);
    expect(browserCapability({ machine: 'mini', appSessionId: id, path: `${daemonDir}/${id}.sock`, renderPath: null, tabEngine: daemonDir, headless: null })).toEqual(local);
  });

  // P5 O17 (the session sockets' names, 2026-11-03; Surprises, "the session sockets' sun_path overflow"): the reading
  // over the paths mawsd computes for each socket kind, as daemon.ts reads it, on a Mac's default profile (a
  // 24-character user name, a 36-character session id) in the profile and in the fallback under the 48-byte TMPDIR:
  // each fits, so the headless browser reads usable; and where one cannot fit the reading names it, never usable
  describe('on a Mac’s default profile, over the paths mawsd computes', () => {
    const UUID = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73' as AppSessionId;
    const TMP = `/var/folders/c1/${'t'.repeat(30)}/T`; // 48 bytes, os.tmpdir()'s form of the per-user TMPDIR
    const reading = (profile: string, tmp: string) => {
      const path = daemonCuaSocketPath(cuaSocketDir(profile, tmp), UUID);
      const renderPath = daemonCuaSocketPath(renderCuaSocketDir(profile, tmp), UUID);
      const capability = browserCapability({ machine: 'mini', appSessionId: UUID, path, renderPath, tabEngine: null, headless: null });
      if (capability.available) for (const fits of [path, renderPath]) expect(Buffer.byteLength(fits ?? 'x'.repeat(104)), 'never usable with a path past sun_path').toBeLessThanOrEqual(103);
      return { path, renderPath, capability };
    };

    it('a 24-character user’s profile: mawsd’s cua socket and the render host’s fit there (96 and 97 bytes), and the headless browser reads usable', () => {
      expect(Buffer.byteLength(TMP)).toBe(48);
      const profile = defaultProfileDir('darwin', {}, `/Users/${'u'.repeat(24)}`);
      const { path, renderPath, capability } = reading(profile, TMP);
      expect(path!.startsWith(`${profile}/mawsd/cua/`) && Buffer.byteLength(path!)).toBe(96);
      expect(renderPath!.startsWith(`${profile}/mawsd/rcua/`) && Buffer.byteLength(renderPath!)).toBe(97);
      expect(capability).toEqual(screencast);
    });

    it('the 48-byte TMPDIR fallback: both fit there (98 and 99 bytes, whatever the profile), and the headless browser reads usable', () => {
      const profile = defaultProfileDir('darwin', {}, `/Users/${'u'.repeat(40)}`); // too long for either in the profile
      const { path, renderPath, capability } = reading(profile, TMP);
      expect(path!.startsWith(`${socketFallbackDir(profile, TMP)}/cua/`) && Buffer.byteLength(path!)).toBe(98);
      expect(renderPath!.startsWith(`${socketFallbackDir(profile, TMP)}/rcua/`) && Buffer.byteLength(renderPath!)).toBe(99);
      expect(capability).toEqual(screencast);
    });

    it('a render host’s socket that fits nowhere while mawsd’s does is named before any use', () => {
      // mawsd's cua socket at exactly 103 bytes in the profile, the render host's one byte over, and a fallback too long
      const name = `/mawsd/cua/${'0'.repeat(16)}.sock`;
      const profile = `/Users/${'u'.repeat(103 - '/Users/'.length - name.length)}`;
      const { path, renderPath, capability } = reading(profile, `/${'t'.repeat(60)}`);
      expect(Buffer.byteLength(path!)).toBe(103);
      expect(renderPath).toBeNull();
      expect(capability).toEqual(TOO_LONG);
    });
  });
});

describe('whether the headless browser is usable, and why not (P5 O17 M5, Interfaces §I 2–5)', () => {
  const usable: HeadlessFacts = { machine: 'mini', platform: 'darwin', addon: 'loaded', engineHost: 'browserWork', runtime: { available: true }, failure: null };

  it('is usable on a Mac with the addon loaded (or not tried yet), an engine host that holds browser work, and the render service', () => {
    expect(headlessReason(usable)).toBeNull();
    expect(headlessReason({ ...usable, addon: 'untried' })).toBeNull(); // a capability read loads no addon (acceptance 14)
  });

  // The architect (2026-11-01): with no engine host connected the reading is this build's, never the old-host reason; the
  // fence's acquire meanwhile answers that the engine host is reconnecting (browser-work.test.ts), so the two never disagree
  it('reads this build’s with no engine host connected (reconnecting), never the old-host reason', () => {
    expect(headlessReason({ ...usable, engineHost: 'none' })).toBeNull();
    expect(browserCapability({ machine: 'mini', appSessionId: A, path: '/p/mawsd/cua/A.sock', renderPath: '/p/mawsd/rcua/A.sock', tabEngine: null, headless: headlessReason({ ...usable, engineHost: 'none' }) })).toEqual({ available: true, viewed: 'screencast' });
  });

  it('says why in §I’s order: Linux, the addon, an engine host that predates browser work, the render service', () => {
    const worst: HeadlessFacts = { machine: 'mini', platform: 'linux', addon: 'failed', engineHost: 'old', runtime: { available: false, reason: 'the render runtime is not installed on mini' }, failure: 'it failed twice' };
    expect(headlessReason(worst)).toBe("cua's host cannot check its peers on Linux yet, so the agent's browser is unavailable on mini");
    expect(headlessReason({ ...worst, platform: 'darwin' })).toBe("the peer identity check did not load on mini, so the agent's browser is refused");
    expect(headlessReason({ ...worst, platform: 'darwin', addon: 'loaded' })).toBe(oldHostReason('mini'));
    expect(headlessReason({ ...worst, platform: 'darwin', addon: 'loaded', engineHost: 'browserWork' })).toBe('the render service is unavailable on mini: the render runtime is not installed on mini');
    expect(headlessReason({ ...usable, failure: 'the render host failed: no display' })).toBe('the render service is unavailable on mini: the render host failed: no display');
  });

  // P5 O17 M8 (Decisions, pass 3 on Linux): the e2e switch lets Linux's route reach `cold` for the fixture connector; the
  // rest of §I's order still reads, and without it Linux reads its own reason
  it('on Linux under the e2e switch, reads the rest of §I’s order instead of the Linux reason', () => {
    const linux: HeadlessFacts = { ...usable, platform: 'linux', addon: 'untried' };
    expect(headlessReason(linux)).toBe("cua's host cannot check its peers on Linux yet, so the agent's browser is unavailable on mini");
    expect(headlessReason({ ...linux, e2eLinuxHeadless: false })).toBe("cua's host cannot check its peers on Linux yet, so the agent's browser is unavailable on mini");
    expect(headlessReason({ ...linux, e2eLinuxHeadless: true })).toBeNull();
    expect(headlessReason({ ...linux, e2eLinuxHeadless: true, engineHost: 'old' })).toBe(oldHostReason('mini'));
    expect(headlessReason({ ...usable, e2eLinuxHeadless: true })).toBeNull(); // a Mac reads as it does without it
    expect(headlessReason({ ...usable, addon: 'failed', e2eLinuxHeadless: true })).toBe("the peer identity check did not load on mini, so the agent's browser is refused");
  });
});

describe('the capabilities and their event', () => {
  function stand() {
    const state = { render: { artifact_screenshot: available, artifact_export: available }, browser: true };
    const events: { appSessionId: string; capabilities: Record<string, SessionCapability> }[] = [];
    const caps = createSessionCapabilities({
      render: () => state.render,
      browser: () => (state.browser ? available : { available: false, reason: 'no browser is attached on mini' }),
      emit: (appSessionId, capabilities) => void events.push({ appSessionId, capabilities }),
    });
    return { state, events, caps };
  }

  it('answers any session cold, tracked or not', () => {
    const { caps } = stand();
    expect(caps.of(A)).toEqual({ artifact_screenshot: available, artifact_export: available, browser: available });
  });

  it('posts each tracked session\'s change once per flip, nothing for an untracked or unchanged one', () => {
    const { state, events, caps } = stand();
    caps.track(A);
    caps.track(B);
    caps.refresh();
    expect(events).toEqual([]); // nothing changed since they were tracked
    state.browser = false;
    caps.refresh();
    caps.refresh();
    expect(events.map((event) => event.appSessionId)).toEqual(['A', 'B']);
    expect(events[0]!.capabilities.browser).toEqual({ available: false, reason: 'no browser is attached on mini' });
    caps.forget(B);
    state.render = { artifact_screenshot: { available: false, reason: 'r' }, artifact_export: { available: false, reason: 'r' } };
    caps.refresh();
    expect(events.map((event) => event.appSessionId)).toEqual(['A', 'B', 'A']);
    expect(events[2]!.capabilities).toEqual({ artifact_screenshot: { available: false, reason: 'r' }, artifact_export: { available: false, reason: 'r' }, browser: { available: false, reason: 'no browser is attached on mini' } });
  });

  it('a session tracked again keeps its last reading: the flip it missed is not posted twice', () => {
    const { state, events, caps } = stand();
    caps.track(A);
    state.browser = false;
    caps.track(A);
    caps.refresh();
    expect(events).toHaveLength(1);
  });

  // The panel's scalpel-4#3: a reading a client asked for is told, so it is what the next change compares against. A flip
  // and its reversal inside the Linux watch's debounce leave the asker holding the flip unless the reversal is posted
  it('a client\'s reading is what was last told: a flip it read and the reversal after it are both posted', () => {
    const { state, events, caps } = stand();
    caps.track(A);
    state.browser = false;
    expect(caps.ask(A).browser).toEqual({ available: false, reason: 'no browser is attached on mini' });
    expect(events.map((event) => event.capabilities.browser)).toEqual([{ available: false, reason: 'no browser is attached on mini' }]); // every other client hears the flip the asker read
    state.browser = true;
    caps.refresh();
    expect(events.map((event) => event.capabilities.browser)).toEqual([{ available: false, reason: 'no browser is attached on mini' }, available]);
    expect(caps.ask(A).browser).toEqual(available);
    expect(events).toHaveLength(2); // a reading equal to what was told posts nothing
  });

  it('a client\'s reading enrols its session: the next flip is posted', () => {
    const { state, events, caps } = stand();
    expect(caps.ask(A).browser).toEqual(available);
    expect(events).toEqual([]);
    state.browser = false;
    caps.refresh();
    expect(events.map((event) => event.appSessionId)).toEqual(['A']);
  });

  it('says when the first session is tracked and when the last is forgotten, once each (the Linux cache watch rides on it)', () => {
    const tracking: boolean[] = [];
    const caps = createSessionCapabilities({ render: () => ({ artifact_screenshot: available, artifact_export: available }), browser: () => available, emit: () => {}, tracking: (any) => void tracking.push(any) });
    caps.forget(A);
    caps.track(A);
    caps.track(A);
    caps.track(B);
    caps.forget(A);
    expect(tracking).toEqual([true]);
    caps.forget(B);
    caps.forget(B);
    expect(tracking).toEqual([true, false]);
    caps.track(B);
    expect(tracking).toEqual([true, false, true]);
  });
});
