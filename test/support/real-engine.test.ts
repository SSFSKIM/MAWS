// P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md): which engine the Discover e2e group runs and
// how a missing or wrong one fails the run, with the binary's `--version` answered by a stand-in. The real lookup and
// version call are the e2e group's own (e2e/support/real-engine.ts).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVISION_COMMAND, REAL_ENGINE_VERSION, realEngineCandidate, verifyRealEngine } from '../../e2e/support/real-engine';

describe('the real engine of the Discover group', () => {
  it('pins 2.1.309 and names the provisioning command', () => {
    expect(REAL_ENGINE_VERSION).toBe('2.1.309');
    expect(PROVISION_COMMAND).toBe('eval "$(scripts/provision-engine.sh 2.1.309)"');
  });

  it('is MAWS_E2E_ENGINE_BIN when the job provisioned one, else the installed 2.1.309', () => {
    expect(realEngineCandidate({ MAWS_E2E_ENGINE_BIN: '/cache/2.1.309/claude' }, '/Users/runner')).toBe('/cache/2.1.309/claude');
    expect(realEngineCandidate({}, '/Users/runner')).toBe(join('/Users/runner', '.local/share/claude/versions/2.1.309'));
    expect(realEngineCandidate({ MAWS_E2E_ENGINE_BIN: '' }, '/Users/runner')).toBe(join('/Users/runner', '.local/share/claude/versions/2.1.309'));
  });

  it('answers the binary and its version when it reports 2.1.309', () => {
    expect(verifyRealEngine('/bin/claude', () => '2.1.309 (Claude Code)')).toEqual({ bin: '/bin/claude', version: '2.1.309' });
  });

  it('fails, naming the provisioning command, when the binary is missing or unversioned', () => {
    expect(() => verifyRealEngine('/nowhere/claude', () => null)).toThrow(/no engine answers --version at \/nowhere\/claude.*eval "\$\(scripts\/provision-engine\.sh 2\.1\.309\)"/s);
  });

  it('fails, naming both versions, when the binary is another release', () => {
    expect(() => verifyRealEngine('/bin/claude', () => '2.1.310 (Claude Code)')).toThrow(/\/bin\/claude is 2\.1\.310, not 2\.1\.309.*provision-engine/s);
    expect(() => verifyRealEngine('/bin/claude', () => '2.1.3090 (Claude Code)')).toThrow(/is 2\.1\.3090, not 2\.1\.309/);
  });
});
