// The stand-in's gate (P5 O6 M3, "The gate"; P5 Decision Log 21's condition): a packaged build never serves.
import { describe, expect, it } from 'vitest';
import { machineServeAllowed } from './serve-gate';

const VALUES = [undefined, '', '0', '1', 'true', 'yes'];
const VARIABLES = ['MAWS_MACHINE_SERVE', 'MAWS_E2E', 'MAWS_HARNESS', 'MAWS_LOCAL_MACHINES'] as const;

// Every combination of the variables over VALUES.
function* environments(): Generator<NodeJS.ProcessEnv> {
  const count = VALUES.length ** VARIABLES.length;
  for (let n = 0; n < count; n++) {
    const env: NodeJS.ProcessEnv = {};
    let rest = n;
    for (const variable of VARIABLES) {
      const value = VALUES[rest % VALUES.length];
      rest = Math.floor(rest / VALUES.length);
      if (value !== undefined) env[variable] = value;
    }
    yield env;
  }
}

describe('machineServeAllowed', () => {
  it('is false in a packaged build for every combination of the variables', () => {
    let checked = 0;
    for (const env of environments()) {
      expect(machineServeAllowed({ packaged: true, env }), JSON.stringify(env)).toBe(false);
      checked += 1;
    }
    expect(checked).toBe(VALUES.length ** VARIABLES.length);
  });

  it('in a build that is not packaged, requires MAWS_MACHINE_SERVE=1 exactly', () => {
    for (const env of environments()) {
      expect(machineServeAllowed({ packaged: false, env }), JSON.stringify(env)).toBe(env.MAWS_MACHINE_SERVE === '1');
    }
  });
});
