import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionCapability } from '@shared/ipc/schema/session-capabilities';
import { browserCapability, createSessionCapabilities, renderCapabilities } from './session-capabilities';

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

describe('the browser entry', () => {
  it('is available while a tab engine is attached, and says why when none is or the path does not fit', () => {
    expect(browserCapability({ machine: 'mini', path: '/p/mawsd/cua/A.sock', targeted: true })).toEqual(available);
    expect(browserCapability({ machine: 'mini', path: '/p/mawsd/cua/A.sock', targeted: false })).toEqual({ available: false, reason: 'no browser is attached on mini' });
    expect(browserCapability({ machine: 'mini', path: null, targeted: true })).toEqual({ available: false, reason: 'the browser socket of this session is longer than a Unix socket allows on mini' });
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
