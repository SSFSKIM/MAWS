// UX wave U1a §F: the modes an approved plan may name, and the gate that offers one only under an engine host that
// applies it.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { PLAN_OUTCOMES } from '@shared/graph/enums';
import { readTolerant } from '@shared/ipc/tolerant';
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';
import { hostAppliesPlanMode, PLAN_NEXT_MODES } from './plan-next-mode';

// What the gate reads of main's `host.status`: the host's state, the engine host's wire fingerprint, and this app's
const status = ({ state = 'ready', wire = 'w' as string | null, appWire = 'w' } = {}): Pick<HostStatus, 'state' | 'supervisor' | 'appWire'> => ({
  state: state as HostStatus['state'],
  supervisor: wire === null ? null : ({ wire, buildId: 'b' } as SupervisorStatus),
  appWire,
});

describe('the modes a plan’s approval may name', () => {
  it('are the two the check of 2026-11-12 ran end to end', () => {
    expect(PLAN_NEXT_MODES).toEqual(['default', 'acceptEdits']);
  });
});

describe('hostAppliesPlanMode', () => {
  it('holds only for a ready engine host whose wire fingerprint is this app’s', () => {
    expect(hostAppliesPlanMode(status())).toBe(true);
    expect(hostAppliesPlanMode(status({ wire: 'w-older' }))).toBe(false);
    expect(hostAppliesPlanMode(status({ state: 'starting', wire: null }))).toBe(false);
    expect(hostAppliesPlanMode(status({ state: 'restarting' }))).toBe(false);
    expect(hostAppliesPlanMode(status({ state: 'crashed', wire: null }))).toBe(false);
    expect(hostAppliesPlanMode(null)).toBe(false);
  });

  it('holds under an engine host of another build whose wire is the same, which applies the key as well', () => {
    expect(hostAppliesPlanMode({ ...status(), supervisor: { wire: 'w', buildId: 'old' } as SupervisorStatus })).toBe(true);
  });

  // Why the gate exists: build F's engine host holds the plan answer as the strict object below (`src/shared/engine/
  // answers.ts` at f1852de3a) and reads its peers tolerantly, so an answer that names a mode reaches its broker as a plain
  // implement, which restores the earlier mode, whatever the button said.
  it('an answer naming a mode, read by build F’s engine host, is a plain implement', () => {
    const planAnswerOfF = z.strictObject({ kind: z.literal('plan'), outcome: z.enum(PLAN_OUTCOMES), feedback: z.string().nullable() });
    expect(readTolerant(planAnswerOfF, { kind: 'plan', outcome: 'implement', feedback: null, mode: 'acceptEdits' })).toEqual({
      ok: true,
      value: { kind: 'plan', outcome: 'implement', feedback: null },
      dropped: ['mode'],
    });
  });
});
