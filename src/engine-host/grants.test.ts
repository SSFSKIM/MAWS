import { describe, expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import { loadJournal } from '../../test/support/fixtures';
import { EMPTY_GRANTS, grantRuleString, reapply, recordFromResponse } from './grants';
import { ControlClient } from './rpc';
import type { EngineTransport } from './transport';

// A transport that answers every control request with an empty success and records what was written.
function answeringTransport() {
  const written: StdinFrame[] = [];
  let client: ControlClient | null = null;
  const transport: EngineTransport = {
    pid: 1,
    frames: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
    stderr: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
    write: async (frame) => {
      written.push(frame);
      if (frame.type === 'control_request') queueMicrotask(() => client!.observe({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id } }));
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  client = new ControlClient(transport, { row: (direction, frame) => ({ seq: 0, direction, at: '', frame }) }, 'GRANTS01', { warn: () => {} });
  return { client, written };
}

describe('grant snapshot re-applies through apply_flag_settings', () => {
  it('renders rules as list_permission_rules does', () => {
    expect(grantRuleString({ toolName: 'Bash', ruleContent: 'touch granted.txt' })).toBe('Bash(touch granted.txt)');
    expect(grantRuleString({ toolName: 'Read' })).toBe('Read');
  });

  it('records only session-destination allow addRules, once each, from the updatedPermissions we sent', () => {
    const sent = loadJournal('pass2', 'grant-reapply-start').find((r) => r.seq === 32)!.frame as { response: { response: { updatedPermissions: unknown[] } } };
    const snapshot = recordFromResponse(EMPTY_GRANTS, sent.response.response.updatedPermissions);
    expect(snapshot).toEqual({ allow: ['Bash(touch granted.txt)'] });
    expect(recordFromResponse(snapshot, sent.response.response.updatedPermissions)).toEqual({ allow: ['Bash(touch granted.txt)'] });
    const others = [
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' },
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm' }], behavior: 'deny', destination: 'session' },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      { type: 'addDirectories', directories: ['/x'], destination: 'session' },
    ];
    expect(recordFromResponse(snapshot, others)).toEqual({ allow: ['Bash(touch granted.txt)'] });
  });

  it('writes apply_flag_settings exactly as pass2/grant-reapply-resume seq 7, and nothing for an empty snapshot', async () => {
    const recorded = loadJournal('pass2', 'grant-reapply-resume').find((r) => r.seq === 7)!.frame as { request: unknown };
    const { client, written } = answeringTransport();
    expect(await reapply(client, { allow: ['Bash(touch granted.txt)'] })).toBe(true);
    expect(written).toHaveLength(1);
    expect((written[0] as { request: unknown }).request).toEqual(recorded.request);

    const empty = answeringTransport();
    expect(await reapply(empty.client, EMPTY_GRANTS)).toBe(false);
    expect(empty.written).toEqual([]);
  });
});
