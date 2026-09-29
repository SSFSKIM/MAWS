import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureIdentity } from './fixture-session-id';
import { loadJournal } from './fixtures';

const P2 = 'spikes/protocol-probe/fixtures/pass2';
const P3 = 'spikes/protocol-probe/fixtures/pass3';
type Frame = { type?: string; subtype?: string; session_id?: string; event?: string; args?: string[]; request?: { subtype?: string; tool_name?: string }; response?: { request_id?: string; response?: Record<string, unknown> } };
const frames = (pass: 'pass2' | 'pass3', name: string) => loadJournal(pass, name).map((r) => ({ ...r, f: r.frame as Frame }));
const pinOf = (pass: 'pass2' | 'pass3', name: string) => {
  const args = frames(pass, name).find((r) => r.f.event === 'spawn')!.f.args!;
  return args[args.indexOf('--session-id') + 1];
};
const initResponse = (pass: 'pass2' | 'pass3', name: string) => {
  const rows = frames(pass, name);
  const id = (rows.find((r) => r.direction === 'out' && r.f.request?.subtype === 'initialize')!.frame as { request_id: string }).request_id;
  return rows.find((r) => r.direction === 'in' && r.f.response?.request_id === id)!.f.response!.response!;
};

describe('fixture identity', () => {
  it('reads the recorded id from the first system/init and the first prompt from the first user frame (pass2/auto-routed)', () => {
    const identity = fixtureIdentity(`${P2}/auto-routed.jsonl`);
    expect(identity.sessionId).toBe('9d753242-8280-4bb4-a144-501cf423d6a1');
    const seq6 = loadJournal('pass2', 'auto-routed').find((r) => r.seq === 6)!.frame as { type: string; message: { content: unknown } };
    expect(seq6.type).toBe('user');
    expect(identity.firstPrompt).toEqual({ content: seq6.message.content, display: typeof seq6.message.content === 'string' ? seq6.message.content : expect.any(String) });
  });

  it('falls back to the --session-id pin of a no-turn fixture (pass3/trust-bootstrap-recorded), with no prompt', () => {
    expect(fixtureIdentity(`${P3}/trust-bootstrap-recorded.jsonl`)).toEqual({ sessionId: pinOf('pass3', 'trust-bootstrap-recorded'), firstPrompt: null });
  });

  it('throws when neither source exists (pass2/trust-attested: no pin, no system/init) or when they disagree', () => {
    expect(() => fixtureIdentity(`${P2}/trust-attested.jsonl`)).toThrow(/no session id/);
    const dir = mkdtempSync(join(tmpdir(), 'maws-fixture-id-'));
    try {
      const file = join(dir, 'disagree.jsonl');
      const rows = [
        { seq: 1, direction: 'meta', at: '2026-09-29T00:00:00.000Z', frame: { event: 'spawn', args: ['-p', '--session-id', '11111111-1111-4111-8111-111111111111'] } },
        { seq: 2, direction: 'in', at: '2026-09-29T00:00:00.000Z', frame: { type: 'system', subtype: 'init', session_id: '22222222-2222-4222-8222-222222222222' } },
      ];
      writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n'));
      expect(() => fixtureIdentity(file)).toThrow(/disagree/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("M1's pass-3 records", () => {
  it('trust-bootstrap-recorded: pinned in the spawn row, recorded true, ended as C3 stops, no user frame, no system/init', () => {
    const rows = frames('pass3', 'trust-bootstrap-recorded');
    expect(pinOf('pass3', 'trust-bootstrap-recorded')).toMatch(/^[0-9a-f-]{36}$/);
    expect(initResponse('pass3', 'trust-bootstrap-recorded').workspace_trust_recorded).toBe(true);
    expect(rows.some((r) => r.direction === 'out' && r.f.request?.subtype === 'end_session')).toBe(true);
    expect(rows.some((r) => r.f.type === 'user')).toBe(false);
    expect(rows.some((r) => r.f.type === 'system' && r.f.subtype === 'init')).toBe(false);
    expect(rows.find((r) => r.f.event === 'exit')!.f).toMatchObject({ code: 0 });
  });

  it('home-trust-session-only: the same shape, recorded false', () => {
    const rows = frames('pass3', 'home-trust-session-only');
    expect(pinOf('pass3', 'home-trust-session-only')).toMatch(/^[0-9a-f-]{36}$/);
    expect(initResponse('pass3', 'home-trust-session-only').workspace_trust_recorded).toBe(false);
    expect(rows.some((r) => r.f.type === 'user' || (r.f.type === 'system' && r.f.subtype === 'init'))).toBe(false);
  });

  it('home-trust-unattested: under ~ the local rule loads without the attestation and no trust notice is printed, attested or not', () => {
    const rulesOf = (name: string) => {
      const rows = frames('pass3', name);
      const id = (rows.find((r) => r.direction === 'out' && r.f.request?.subtype === 'list_permission_rules')!.frame as { request_id: string }).request_id;
      return (rows.find((r) => r.direction === 'in' && r.f.response?.request_id === id)!.f.response!.response as { state: { rules: { source: string; rule: string }[] } }).state.rules;
    };
    const notice = (name: string) => loadJournal('pass3', name).some((r) => r.direction === 'stderr' && String((r.frame as { text: string }).text).includes('this workspace has not been trusted'));
    expect(pinOf('pass3', 'home-trust-unattested')).toMatch(/^[0-9a-f-]{36}$/);
    expect('workspace_trust_recorded' in initResponse('pass3', 'home-trust-unattested')).toBe(false);
    for (const name of ['home-trust-unattested', 'home-trust-session-only']) {
      expect(rulesOf(name)).toMatchObject([{ source: 'localSettings', rule: 'Bash(echo MAWS_C10_HOME:*)' }]);
      expect(notice(name)).toBe(false);
    }
  });

  it('trust-exact-key: an accepted "/" does not satisfy the headless gate (no workspace_trust_recorded; the notice on stderr)', () => {
    expect('workspace_trust_recorded' in initResponse('pass3', 'trust-exact-key')).toBe(false);
    expect(loadJournal('pass3', 'trust-exact-key').some((r) => r.direction === 'stderr' && String((r.frame as { text: string }).text).includes('this workspace has not been trusted'))).toBe(true);
  });

  it("fork-pinned-id: each launch's system/init.session_id is its spawn row's --session-id, and the fork's differs from the source's", () => {
    const start = fixtureIdentity(`${P3}/fork-pinned-id-start.jsonl`);
    const fork = fixtureIdentity(`${P3}/fork-pinned-id-fork.jsonl`); // throws if the pin and system/init disagreed
    expect(start.sessionId).toBe(pinOf('pass3', 'fork-pinned-id-start'));
    expect(fork.sessionId).toBe(pinOf('pass3', 'fork-pinned-id-fork'));
    expect(fork.sessionId).not.toBe(start.sessionId);
    const args = frames('pass3', 'fork-pinned-id-fork').find((r) => r.f.event === 'spawn')!.f.args!;
    expect(args.slice(args.indexOf('--resume'))).toEqual(expect.arrayContaining(['--resume', start.sessionId, '--fork-session']));
  });

  it('read-only-permission: a Read outside the working directory asks under default mode', () => {
    const asked = frames('pass3', 'read-only-permission').filter((r) => r.direction === 'in' && r.f.request?.subtype === 'can_use_tool');
    expect(asked.map((r) => r.f.request!.tool_name)).toEqual(['Read']);
  });
});
