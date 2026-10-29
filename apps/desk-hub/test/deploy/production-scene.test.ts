// vm/production.sh's choices of what is the run's own on the production VM (P5 O10 M11, the owner's rulings): the
// lane A session is the one the run named and checked, a seat is the run's only inside the run's private mount
// namespace, and a local spawn is declined unless every claude of the owner's but the run's own is proven absent.
// The script is sourced (its verbs dispatch only when it is run), and its selection functions are fed tables as the
// VM's /proc would give them.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  // What `sminos project show <checkout>` prints, as the owner, before the engine starts: sminos's own resolution.
  const shown = (id: string, source: string) =>
    [`project  dc-acceptance-7f80`, `id       ${id}`, `kind     machine`, `source   ${source}`, `remote   -`, `hub      https://h (org ssfskim)`, `root     -`, `home     /x`].join('\n') + '\n';
  const mid = machineProjectId('ssfskim', 'dc-acceptance-7f80');

  it('starts only where sminos itself resolves the checkout to the pinned machine project, as a stray', () => {
    expect(call('project_verdict', [mid], shown(mid, 'machine project: no remote'))).toEqual({ lines: [], status: 0 });
  });

  it('is refused where a .smns above the checkout claims it, whatever project that names', () => {
    const other = '5d1f0e6a-1111-4222-8333-444455556666';
    expect(call('project_verdict', [mid], shown(other, '.smns at /Users/new'))).toEqual({
      lines: [`sminos puts the checkout in ${other}, not the machine project ${mid}`, 'its project comes from .smns at /Users/new, not from no .smns or remote (the machine project)'],
      status: 1,
    });
    expect(call('project_verdict', [mid], shown(mid, '.smns at /Users/new')).lines).toEqual(['its project comes from .smns at /Users/new, not from no .smns or remote (the machine project)']);
    expect(call('project_verdict', [mid], 'sminos: no project at /w\n').status).toBe(1);
  });
});


// sminos 1.27.15 reads a session's engine records and transcript under the config dir its record hook kept at
// $SMINOS_HOME/config-dirs/<session>.json, so the run makes no link into the owner's ~/.claude (attempts 2 to 4 did,
// and with 1.27.15 a linked record would be read twice); it checks instead that both sminos sides are at that floor,
// share the daemon's SMINOS_HOME, and that the session's config dir was recorded there.
const SH = '/Users/new/.claude/sminos';
const CLI = '/var/lib/devcloud/marketplaces/doperpowers/sminos/skills/sminos/scripts/sminos.py';

function scratch(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'o10-sminos-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

describe('the owner’s ~/.claude', () => {
  it('receives no link of the run’s: the record links and everything that made or removed them are gone', () => {
    expect(call('for f in record_plan own_links link_records; do type -t $f; done; true', [])).toEqual({ lines: [], status: 0 });
    // Of the owner's ~/.claude the script names sminos's home alone.
    const named = [...readFileSync(script, 'utf8').matchAll(/\$OH\/\.claude\/[A-Za-z._-]*/g)].map((m) => m[0]);
    expect(new Set(named)).toEqual(new Set(['$OH/.claude/sminos']));
  });
});

describe('the lane A session’s environment', () => {
  const env = () => call('printf "%s\\n" "${SESSION_ENV[@]}" | grep -E "^(SMINOS_HOME|CLAUDE_CONFIG_DIR)="', []).lines;

  it('carries the owner daemon’s SMINOS_HOME and the scratch config dir, absolute', () => {
    expect(env().sort()).toEqual([`CLAUDE_CONFIG_DIR=${X}/claude`, `SMINOS_HOME=${SH}`]);
    expect(call('printf "%s\\n" "${SESSION_ENV[@]}" | session_env_problems', [])).toEqual({ lines: [], status: 0 });
  });

  it('is refused with another SMINOS_HOME, or a config dir that is not the scratch one’s absolute path', () => {
    const good = [`SMINOS_HOME=${SH}`, `CLAUDE_CONFIG_DIR=${X}/claude`];
    const swap = (line: string) => good.map((l) => (l.split('=')[0] === line.split('=')[0] ? line : l)).join('\n') + '\n';
    expect(call('session_env_problems', [], swap('SMINOS_HOME=/Users/new/.config/sminos'))).toEqual({ lines: [`SMINOS_HOME is /Users/new/.config/sminos, not ${SH} (the owner’s daemon’s)`], status: 1 });
    expect(call('session_env_problems', [], swap('CLAUDE_CONFIG_DIR=o10-m11-lane-a/claude'))).toEqual({ lines: [`CLAUDE_CONFIG_DIR is o10-m11-lane-a/claude, not ${X}/claude (absolute)`], status: 1 });
    expect(call('session_env_problems', [], '').lines).toEqual([`SMINOS_HOME is unset, not ${SH} (the owner’s daemon’s)`, `CLAUDE_CONFIG_DIR is unset, not ${X}/claude (absolute)`]);
  });
});

describe('the config dir sminos recorded for the session', () => {
  it('is the scratch one, in the owner daemon’s SMINOS_HOME, or lane A is not up', () => {
    const { root, done } = scratch();
    try {
      const file = join(root, 'f.json');
      writeFileSync(file, JSON.stringify({ configDir: `${X}/claude`, at: '2026-10-29T00:00:00.000Z' }));
      expect(call('config_dir_verdict', [file])).toEqual({ lines: [], status: 0 });
      writeFileSync(file, JSON.stringify({ configDir: '/Users/new/.claude', at: 'x' }));
      expect(call('config_dir_verdict', [file])).toEqual({ lines: [`sminos recorded /Users/new/.claude as the config dir of the session, not ${X}/claude`], status: 1 });
      writeFileSync(file, 'not json');
      expect(call('config_dir_verdict', [file]).status).toBe(1);
      expect(call('config_dir_verdict', [join(root, 'none.json')])).toEqual({ lines: [`sminos recorded no config dir for the session (no ${join(root, 'none.json')})`], status: 1 });
    } finally {
      done();
    }
  });
});

describe('sminos at 1.27.15 or later, on both sides', () => {
  it('reads a version from sminos’s own plugin.json alone', () => {
    const { root, done } = scratch();
    try {
      const at = (name: string, body: unknown) => (writeFileSync(join(root, name), JSON.stringify(body)), join(root, name));
      expect(call('sminos_version', [at('a.json', { name: 'sminos', version: '1.27.15' })])).toEqual({ lines: ['1.27.15'], status: 0 });
      expect(call('sminos_version', [at('b.json', { name: 'doperpowers', version: '7.300.0' })]).status).toBe(1);
      expect(call('sminos_version', [at('c.json', { name: 'sminos', version: '1.27.15-rc1' })]).status).toBe(1);
      expect(call('sminos_version', [join(root, 'none.json')]).status).toBe(1);
    } finally {
      done();
    }
  });

  it('finds the CLI a daemon runs from its command line, and nothing in another command line', () => {
    const argv = (...a: string[]) => a.join('\0') + '\0';
    expect(call('daemon_cli', [], argv('/usr/bin/python3', CLI, 'daemon', 'run'))).toEqual({ lines: [CLI], status: 0 });
    expect(call('daemon_cli', [], argv('/usr/bin/python3', CLI, 'list', '--json')).status).toBe(1);
    expect(call('daemon_cli', [], argv('/usr/bin/python3', 'sminos/skills/sminos/scripts/sminos.py', 'daemon', 'run')).status).toBe(1);
    expect(call('daemon_cli', [], argv('/usr/bin/sleep', 'infinity'))).toEqual({ lines: ['not a direct `<python> <cli> daemon run`: /usr/bin/sleep infinity'], status: 1 });
    expect(call('daemon_cli', [], '')).toEqual({ lines: ['not a direct `<python> <cli> daemon run`: an empty command line'], status: 1 });
  });

  it('takes only a direct `<python> <cli> daemon run`, as the unit runs it, and names any other command line it found', () => {
    const argv = (...a: string[]) => a.join('\0') + '\0';
    // The unit's ExecStart is `<python> <cli> daemon run` (references/sminos-daemon.service), and a restart in place
    // execs the same argv; devcloud's scrubber runs it as a child, its argv unchanged.
    expect(call('daemon_cli', [], argv('/usr/bin/python3.12', CLI, 'daemon', 'run'))).toEqual({ lines: [CLI], status: 0 });
    for (const [found, line] of [
      [['/usr/bin/python3', '/opt/wrapper.py', CLI, 'daemon', 'run'], `/usr/bin/python3 /opt/wrapper.py ${CLI} daemon run`],
      [['/usr/bin/python3', '-c', 'import runpy', CLI, 'daemon', 'run'], `/usr/bin/python3 -c import runpy ${CLI} daemon run`],
      [['/usr/bin/python3', '-m', 'sminos', CLI, 'daemon', 'run'], `/usr/bin/python3 -m sminos ${CLI} daemon run`],
      [['/usr/bin/python3', '-I', CLI, 'daemon', 'run'], `/usr/bin/python3 -I ${CLI} daemon run`],
      [['/usr/bin/python3', CLI, 'daemon', 'run', '--interval', '5'], `/usr/bin/python3 ${CLI} daemon run --interval 5`],
      [['/opt/wrapper', CLI, 'daemon', 'run'], `/opt/wrapper ${CLI} daemon run`],
      [['python3', CLI, 'daemon', 'run'], `python3 ${CLI} daemon run`],
    ] as const) {
      expect(call('daemon_cli', [], argv(...found)), line).toEqual({ lines: [`not a direct \`<python> <cli> daemon run\`: ${line}`], status: 1 });
    }
  });

  it('takes the daemon for $SMINOS_HOME’s own only while the run lock’s pid holds that lock open and runs `daemon run`', () => {
    const { root, done } = scratch();
    try {
      const lock = join(root, 'run.lock');
      const proc = join(root, 'proc');
      writeFileSync(lock, 'pid 4242 since 2026-10-29T00:00:00Z');
      mkdirSync(join(proc, '4242', 'fd'), { recursive: true });
      writeFileSync(join(proc, '4242', 'cmdline'), ['/usr/bin/python3', CLI, 'daemon', 'run', ''].join('\0'));
      symlinkSync('/dev/null', join(proc, '4242', 'fd', '0'));
      expect(call('daemon_of', [lock, proc])).toEqual({ lines: [`the daemon’s pid 4242 does not hold ${lock} open: it is not this SMINOS_HOME’s daemon`], status: 1 });
      symlinkSync(lock, join(proc, '4242', 'fd', '3'));
      expect(call('daemon_of', [lock, proc])).toEqual({ lines: [`4242 ${CLI}`], status: 0 });
      writeFileSync(join(proc, '4242', 'cmdline'), ['/usr/bin/sleep', 'infinity', ''].join('\0'));
      expect(call('daemon_of', [lock, proc])).toEqual({ lines: ['pid 4242 runs no sminos daemon: not a direct `<python> <cli> daemon run`: /usr/bin/sleep infinity'], status: 1 });
      rmSync(join(proc, '4242'), { recursive: true });
      expect(call('daemon_of', [lock, proc])).toEqual({ lines: ['pid 4242, which the run lock names, runs no more'], status: 1 });
      writeFileSync(lock, '');
      expect(call('daemon_of', [lock, proc])).toEqual({ lines: [`no daemon has run for ${root} (its run lock names no pid)`], status: 1 });
    } finally {
      done();
    }
  });

  it('lets the run start only when the daemon and the stub’s copy are both at the floor, compared by number', () => {
    for (const [daemon, stub] of [['1.27.15', '1.27.15'], ['1.27.100', '1.28.0'], ['2.0', '1.27.15']]) expect(call('sminos_floor', [daemon, stub]), `${daemon} ${stub}`).toEqual({ lines: [], status: 0 });
    const need = 'lane A under a scratch CLAUDE_CONFIG_DIR needs both at 1.27.15 or later (the stub’s hooks record its config dir, the daemon’s plane reads its transcript there)';
    expect(call('sminos_floor', ['1.27.14', '1.27.15'])).toEqual({ lines: [`refused: sminos below 1.27.15: the VM’s daemon runs 1.27.14, the stub’s copy is 1.27.15; ${need}`], status: 1 });
    expect(call('sminos_floor', ['1.27.15', '1.27.9'])).toEqual({ lines: [`refused: sminos below 1.27.15: the VM’s daemon runs 1.27.15, the stub’s copy is 1.27.9; ${need}`], status: 1 });
    expect(call('sminos_floor', ['', '1.27.15', 'no daemon has run for /x'])).toEqual({ lines: [`refused: sminos below 1.27.15: the VM’s daemon runs an unread version (no daemon has run for /x), the stub’s copy is 1.27.15; ${need}`], status: 1 });
    expect(call('sminos_floor', ['1.27.15', '']).lines).toEqual([`refused: sminos below 1.27.15: the VM’s daemon runs 1.27.15, the stub’s copy is an unread version; ${need}`]);
  });
});
