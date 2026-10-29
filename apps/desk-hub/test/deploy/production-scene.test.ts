// vm/production.sh's choices of what is the run's own on the production VM (P5 O10 M11, the owner's rulings): the
// lane A session is the one the run named and checked, a seat is the run's only inside the run's private mount
// namespace, and a local spawn is declined unless every claude of the owner's but the run's own is proven absent.
// The script is sourced (its verbs dispatch only when it is run), and its selection functions are fed tables as the
// VM's /proc would give them.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { machineProjectId } from '../../src/protocol/identity';

const script = join(import.meta.dirname, '../../deploy/vm/production.sh');
const X = '/Users/new/.local/share/o10-m11-lane-a';
const STUB = 'http://127.0.0.1:47899';
const OURS = 'mnt:[4026532900]';
const HOST = 'mnt:[4026531841]';

/** One of production.sh's functions, its stdin `input`: its lines and status. */
function call(fn: string, args: string[], input = ''): { lines: string[]; status: number | null } {
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const run = spawnSync('bash', ['-c', `source '${script}' && ${fn} ${quoted}`], { input, encoding: 'utf8' });
  return { lines: run.stdout.split('\n').filter((l) => l !== ''), status: run.status };
}

describe('production.sh, sourced', () => {
  it('runs no verb and touches nothing when sourced', () => {
    expect(call('true', [])).toEqual({ lines: [], status: 0 });
  });
});

describe('the lane A session the run uses', () => {
  const good = [`CLAUDE_CONFIG_DIR=${X}/claude`, `ANTHROPIC_BASE_URL=${STUB}`, `cwd=${X}/work`, `ns=${OURS}`].join('\n');

  it('is the run’s only when its engine has the scratch config, the stub, the checkout and the run’s namespace', () => {
    expect(call('session_problems', [OURS], `${good}\n`)).toEqual({ lines: [], status: 0 });
  });

  it('is refused when any of them is another’s: an owner’s session is never taken for the run’s', () => {
    for (const [line, said] of [
      [`CLAUDE_CONFIG_DIR=/Users/new/.claude`, `CLAUDE_CONFIG_DIR is /Users/new/.claude, not ${X}/claude`],
      [`ANTHROPIC_BASE_URL=https://api.anthropic.com`, `ANTHROPIC_BASE_URL is https://api.anthropic.com, not ${STUB}`],
      [`cwd=/Users/new/Developer/MAWS`, `its directory is /Users/new/Developer/MAWS, not ${X}/work`],
      [`ns=${HOST}`, `it runs outside the run’s namespace (${HOST})`],
    ]) {
      const key = line.split('=')[0];
      const input = good.split('\n').map((l) => (l.startsWith(`${key}=`) ? line : l)).join('\n');
      expect(call('session_problems', [OURS], `${input}\n`)).toEqual({ lines: [said], status: 1 });
    }
    expect(call('session_problems', [OURS], `ns=${OURS}\n`).lines).toEqual([`CLAUDE_CONFIG_DIR is unset, not ${X}/claude`, `ANTHROPIC_BASE_URL is unset, not ${STUB}`, `its directory is unknown, not ${X}/work`]);
  });
});

describe('before a local spawn', () => {
  it('finds no claude of the owner’s but those in the run’s namespace, so the spawn may go', () => {
    expect(call('foreign', [OURS], `101 ${OURS}\n102 ${OURS}\n`)).toEqual({ lines: [], status: 0 });
  });

  it('names every other claude of the owner’s, terminal or not, so the spawn is declined', () => {
    expect(call('foreign', [OURS], `101 ${OURS}\n201 ${HOST}\n202 \n`)).toEqual({ lines: ['201', '202'], status: 0 });
  });
});

describe('after a local spawn', () => {
  it('reads the seat’s session from what `sminos spawn` printed', () => {
    const said = 'seat spawned: doperpowers/o10-local-ab12cd  [4f2a9c1 / 0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13]  status=working  (reply: sminos reply 4f2a9c1)';
    expect(call('seat_session', [], `banner\n${said}\n`)).toEqual({ lines: ['0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13'], status: 0 });
    expect(call('seat_session', [], 'sminos: spawn failed\n')).toEqual({ lines: [], status: 1 });
  });

  it('holds the new claude processes the run’s, and fine, only inside its namespace with the scratch config and the stub', () => {
    const table = [`301 ${OURS} CLAUDE_CONFIG_DIR=${X}/claude ANTHROPIC_BASE_URL=${STUB}`, `302 ${OURS} ANTHROPIC_BASE_URL=${STUB} CLAUDE_CONFIG_DIR=${X}/claude`].join('\n');
    expect(call('seat_verdict', [OURS], `${table}\n`)).toEqual({ lines: ['ours 301', 'ours 302'], status: 0 });
  });

  it('marks one of the run’s with another environment to kill, and one outside the namespace as not the run’s to kill', () => {
    const table = [`301 ${OURS} CLAUDE_CONFIG_DIR=/Users/new/.claude ANTHROPIC_BASE_URL=${STUB}`, `401 ${HOST}`, `302 ${OURS} CLAUDE_CONFIG_DIR=${X}/claude ANTHROPIC_BASE_URL=${STUB}`].join('\n');
    expect(call('seat_verdict', [OURS], `${table}\n`)).toEqual({ lines: ['kill 301', 'foreign 401', 'ours 302'], status: 1 });
  });

  it('fails when no new claude process appeared at all', () => {
    expect(call('seat_verdict', [OURS], '')).toEqual({ lines: [], status: 1 });
  });
});

describe('the lane A session in the machine project', () => {
  it('is in the project the run names only when that is this machine’s own, as sminos derives it', () => {
    expect(call('machine_project', ['ssfskim', 'dc-acceptance-7f80'])).toEqual({ lines: [machineProjectId('ssfskim', 'dc-acceptance-7f80')], status: 0 });
    expect(call('machine_project', ['ssfskim', 'DC-Acceptance-7F80']).lines).toEqual([machineProjectId('ssfskim', 'dc-acceptance-7f80')]);
  });

  it('is found in the listing by its own session id, never by a row that merely mentions it', () => {
    const sid = '09208ca6-d9ca-4cda-a917-7fec865e43fa';
    const rows = [
      { alias: 'owners-seat', session: '11111111-2222-4333-8444-555555555555', seat: { current: sid }, former: [sid] },
      { alias: 'o10-m11-lane-a', session: sid, local: true },
    ];
    expect(call('member_alias', [sid], JSON.stringify(rows))).toEqual({ lines: ['o10-m11-lane-a'], status: 0 });
    expect(call('member_alias', [sid], JSON.stringify(rows.slice(0, 1)))).toEqual({ lines: [], status: 1 });
    expect(call('member_alias', [sid], '')).toEqual({ lines: [], status: 1 });
  });
});

// sminos reads the engine's session records from $HOME/.claude/sessions alone, whatever CLAUDE_CONFIG_DIR says, so a
// lane A engine on the scratch config dir is seen only through a link there to its own record (attempt 2, 2026-10-29).
describe('the engine records the owner’s sminos reads', () => {
  function dirs(): { records: string; sessions: string; done: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'o10-records-'));
    const records = join(root, 'records');
    const sessions = join(root, 'sessions');
    spawnSync('mkdir', ['-p', records, sessions]);
    return { records, sessions, done: () => rmSync(root, { recursive: true, force: true }) };
  }

  it('links each of the run’s records not linked yet, keeps one linked already, and never takes a name the owner’s holds', () => {
    const { records, sessions, done } = dirs();
    try {
      for (const pid of ['501', '502', '503']) writeFileSync(join(records, `${pid}.json`), '{}');
      symlinkSync(join(records, '502.json'), join(sessions, '502.json'));
      writeFileSync(join(sessions, '503.json'), '{}');
      expect(call('record_plan', [records, sessions])).toEqual({ lines: ['link 501.json', 'linked 502.json', 'taken 503.json'], status: 0 });
    } finally {
      done();
    }
  });

  it('names for removal only the links into the run’s scratch, never the owner’s own records or other links', () => {
    const { sessions, done } = dirs();
    try {
      symlinkSync(`${X}/claude/sessions/601.json`, join(sessions, '601.json'));
      symlinkSync('/Users/new/.claude/elsewhere.json', join(sessions, '602.json'));
      symlinkSync(`${X}-other/claude/sessions/603.json`, join(sessions, '603.json'));
      writeFileSync(join(sessions, '604.json'), '{}');
      expect(call('own_links', [sessions])).toEqual({ lines: [join(sessions, '601.json')], status: 0 });
    } finally {
      done();
    }
  });
});
