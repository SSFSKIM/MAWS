// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, decision 30; Interfaces D; Acceptance 19): Send
// now on a message that waits at the next step is offered only under an engine host that has this build's wire, and so
// `session.steer.sendNow`. After an app update the earlier build's engine host serves on (its fingerprint, `supervisor.wire`,
// is then not this build's `appWire`); before the first status, or with no supervisor, nothing is known.
import { describe, expect, it } from 'vitest';
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';
import { hostHasThisWire } from './host-wire';

const status = ({ state = 'ready', wire = 'w-this' as string | null, appWire = 'w-this' } = {}): Pick<HostStatus, 'state' | 'supervisor' | 'appWire'> => ({
  state: state as HostStatus['state'],
  supervisor: wire === null ? null : ({ wire, buildId: 'b' } as SupervisorStatus),
  appWire,
});

describe('hostHasThisWire', () => {
  it('holds over this build’s own engine host, ready', () => {
    expect(hostHasThisWire(status())).toBe(true);
  });

  it('does not hold under build F’s engine host (another fingerprint), with no supervisor, in a state other than ready, or before any status', () => {
    expect(hostHasThisWire(status({ wire: 'w-build-f' }))).toBe(false);
    expect(hostHasThisWire(status({ wire: null }))).toBe(false);
    expect(hostHasThisWire(status({ state: 'starting' }))).toBe(false);
    expect(hostHasThisWire(status({ state: 'restarting' }))).toBe(false);
    expect(hostHasThisWire(status({ state: 'crashed', wire: null }))).toBe(false);
    expect(hostHasThisWire(null)).toBe(false);
  });
});
