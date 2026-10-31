// The VM driver of the endpoint acceptance run (deploy/endpoint-machine.ts; P5 O10 M11), against a stand-in for
// `devcloud vm ssh` that records what it was given: every step is a script file of mode 0600 handed to it on stdin,
// with no `--` and no command words; a file that held a secret is gone before the step ends and its secret reaches no
// argument, log or result; the step's own lines are read between its markers, past the VM's login banner; and every
// wait is bounded.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeScript, laneBEventLines, ScriptRunner, stopMachineWork, VmMachine, type Ssh } from '../../deploy/endpoint-machine.ts';
import { Cleanup } from '../../deploy/proof.ts';

/** A stand-in for devcloud: records its argv, the mode of the file on its stdin and the script, answers `reply`. */
function standin(reply: (script: string) => string, { exit = 0, delayS = 0 } = {}): { bin: string; dir: string; calls: () => Array<{ argv: string[]; mode: string; script: string; scriptGone: boolean }> } {
  const dir = mkdtempSync(join(tmpdir(), 'ep-devcloud-'));
  const replies = join(dir, 'replies.cjs');
  writeFileSync(replies, `module.exports = ${reply.toString()};`);
  const bin = join(dir, 'devcloud');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const n = fs.readdirSync(${JSON.stringify(dir)}).filter((f) => f.startsWith('call-')).length;
// The file behind stdin, a moment after the start: its mode, and whether it is unlinked already (no links left).
setTimeout(() => {
  let mode = 'not-a-file';
  let links = -1;
  try { const st = fs.fstatSync(0); mode = st.isFile() ? (st.mode & 0o777).toString(8) : 'not-a-file'; links = st.nlink; } catch {}
  const script = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(${JSON.stringify(dir)} + '/call-' + n + '.json', JSON.stringify({ argv: process.argv.slice(2), mode, script, links }));
  setTimeout(() => {
    process.stdout.write('Welcome to Ubuntu (a banner)\\n' + require(${JSON.stringify(replies)})(script));
    process.exit(${exit});
  }, ${delayS * 1000});
}, 300);
`,
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    dir,
    calls: () =>
      readdirSync(dir)
        .filter((f) => f.startsWith('call-'))
        .sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5)))
        .map((f) => {
          const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { argv: string[]; mode: string; script: string; links: number };
          return { argv: c.argv, mode: c.mode, script: c.script, scriptGone: c.links === 0 };
        }),
  };
}

const scratch = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'ep-scratch-')), 'steps');
  mkdirSync(dir, { mode: 0o700 });
  return dir;
};

describe('a step on the VM', () => {
  it('is a 0600 script file on devcloud’s stdin, no `--` and no command words, and its lines are read between its markers', async () => {
    const fake = standin(() => '@@BEGIN\nhello\nworld\n@@END 0\n');
    const dir = scratch();
    const ssh: Ssh = { devcloud: fake.bin, vm: 'dc-acceptance-7f80' };
    const run = new ScriptRunner(ssh, dir);
    const out = await run.step('hello', 'echo hello; echo world', { root: true });
    expect(out).toEqual({ rc: 0, lines: ['hello', 'world'] });
    const [call] = fake.calls();
    expect(call.argv).toEqual(['vm', 'ssh', 'dc-acceptance-7f80', '--root']);
    expect(call.mode).toBe('600');
    expect(call.script).toContain('echo hello; echo world');
    expect(readdirSync(dir)).toEqual([]); // no step file outlives its step
  });

  it('runs as the VM’s user without --root, and names a step that ended before its end marker', async () => {
    const fake = standin(() => '@@BEGIN\nhalf\n');
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, scratch());
    await expect(run.step('cut', 'true')).rejects.toThrow(/the step cut on vm1 ended before its end \(devcloud exit 0\)/);
    expect(fake.calls()[0].argv).toEqual(['vm', 'ssh', 'vm1']);
  });

  it('deletes a file holding a secret before the step even ends, and never prints or returns the secret', async () => {
    const code = `smns-enroll-v2.${'Q'.repeat(80)}`;
    const fake = standin(() => '@@BEGIN\n{"enrollment":"org-listed"}\n@@END 0\n', { delayS: 1 });
    const dir = scratch();
    const printed: string[] = [];
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, dir, (l) => printed.push(l));
    const out = await run.step('enroll', `printf '%s\\n' '${code}' | enroll`, { root: true, secret: code });
    const [call] = fake.calls();
    expect(call.scriptGone).toBe(true); // unlinked while devcloud still read it
    expect(call.argv.join(' ')).not.toContain(code);
    expect(call.script).toContain(code); // it reached the VM on stdin alone
    expect(JSON.stringify(out)).not.toContain(code);
    expect(printed.join('\n')).not.toContain(code);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('kills a step past its bound, and says so', async () => {
    const fake = standin(() => '@@BEGIN\n@@END 0\n', { delayS: 5 });
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, scratch());
    await expect(run.step('slow', 'true', { ms: 500 })).rejects.toThrow(/the step slow on vm1 took longer than 0.5 s/);
  });
});

/**
 * A devcloud that never answers: it starts a child (as devcloud's python starts `ssh`) and waits on it; both pids kept.
 * `stubborn`: the child ignores SIGTERM and holds none of the step's pipes, so devcloud's own exit on TERM closes them
 * while the child runs on.
 */
function hung({ stubborn = false } = {}): { bin: string; pids: () => number[] } {
  const dir = mkdtempSync(join(tmpdir(), 'ep-hung-'));
  const bin = join(dir, 'devcloud');
  const child = stubborn ? "(trap '' TERM; exec sleep 60) >/dev/null 2>&1 &" : 'sleep 60 &';
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\n${child}\necho $! > '${dir}/child.pid'\necho $$ > '${dir}/parent.pid'\nwait\n`, { mode: 0o755 });
  const read = (f: string) => (existsSync(join(dir, f)) ? Number(readFileSync(join(dir, f), 'utf8')) : NaN);
  return { bin, pids: () => [read('parent.pid'), read('child.pid')] };
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  return check();
};

describe('a step that does not end', () => {
  it('is killed past its bound with every process devcloud started (its ssh), and settles on its own deadline', async () => {
    const fake = hung();
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, scratch());
    const started = Date.now();
    await expect(run.step('stuck', 'true', { ms: 800 })).rejects.toThrow(/took longer than 0.8 s/);
    expect(Date.now() - started).toBeLessThan(8000);
    const [parent, child] = fake.pids();
    expect(Number.isInteger(parent) && Number.isInteger(child)).toBe(true);
    expect(await until(() => !alive(parent) && !alive(child), 3000)).toBe(true);
  }, 15_000);

  it('is killed whole, a child that ignores SIGTERM too, before the step says it ended', async () => {
    const fake = hung({ stubborn: true });
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, scratch());
    const stuck = run.step('stuck', 'true', { ms: 800 });
    await until(() => Number.isInteger(fake.pids()[1]), 5000);
    await expect(stuck).rejects.toThrow(/took longer than 0.8 s/);
    const [parent, child] = fake.pids();
    expect(alive(parent)).toBe(false);
    expect(alive(child)).toBe(false);
  }, 15_000);

  it('names the steps still running when settling runs out of time, and none once they ended', async () => {
    const fake = hung();
    const cleanup = new Cleanup();
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, scratch(), () => {}, { gate: () => cleanup.check(), signal: cleanup.signal });
    const stuck = run.step('lane-a-up', 'true', { ms: 60_000 }).catch((error: Error) => error);
    await until(() => Number.isInteger(fake.pids()[1]), 5000);
    expect(await run.settle(300)).toEqual(['lane-a-up']);
    cleanup.interrupt('the run failed');
    expect(await run.settle()).toEqual([]);
    expect(String(await stuck)).toMatch(/cancelled: the run failed/);
  }, 20_000);

  it('is cancelled by the run’s interruption, and the run starts no step after it but the cleanup’s', async () => {
    const fake = hung();
    const cleanup = new Cleanup();
    const run = new ScriptRunner({ devcloud: fake.bin, vm: 'vm1' }, scratch(), () => {}, { gate: () => cleanup.check(), signal: cleanup.signal });
    const stuck = run.step('up', 'true', { ms: 60_000 });
    await until(() => Number.isInteger(fake.pids()[1]), 5000);
    cleanup.interrupt('interrupted by SIGINT');
    await expect(stuck).rejects.toThrow(/cancelled: interrupted by SIGINT/);
    const [parent, child] = fake.pids();
    expect(await until(() => !alive(parent) && !alive(child), 3000)).toBe(true);
    await run.settle();
    await expect(run.step('enroll', 'true')).rejects.toThrow(/interrupted by SIGINT/);
    // The cleanup's own steps still run.
    const answering = standin(() => '@@BEGIN\ndown\n@@END 0\n');
    const down = new ScriptRunner({ devcloud: answering.bin, vm: 'vm1' }, scratch(), () => {}, { gate: () => cleanup.check(), signal: cleanup.signal });
    let said: string[] = [];
    cleanup.add('down', async () => void (said = (await down.step('down', 'true')).lines));
    expect(await cleanup.run()).toEqual([]);
    expect(said).toEqual(['down']);
  }, 20_000);
});

describe('the run’s end, however it ends', () => {
  it('cancels what the machine still runs after an ordinary failure, and names what outlived the cancellation', async () => {
    const fake = hung();
    const cleanup = new Cleanup();
    const machine = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831', gate: () => cleanup.check(), signal: cleanup.signal });
    const up = machine.up().catch((error: Error) => error);
    await until(() => Number.isInteger(fake.pids()[1]), 5000);
    expect(await stopMachineWork(cleanup, machine, 1)).toEqual([]);
    expect(String(await up)).toMatch(/the step up on vm1 was cancelled: the run failed/);
    const [parent, child] = fake.pids();
    expect(alive(parent) || alive(child)).toBe(false);
    // A step the cancellation did not end within the bound is named, for the scene's down to stop on the VM.
    const slow = { label: 'the scratch mawsd on vm1', settle: async () => ['lane-a-up'] };
    expect(await stopMachineWork(new Cleanup(), slow, 0)).toEqual(['the step lane-a-up on the scratch mawsd on vm1 still ran when the run ended; the scene’s down stops it there']);
  }, 20_000);
});

describe('a step whose script exits', () => {
  it('still reports its status and lines: a body’s `exit` ends the body, not the step (vm/teardown.sh ends `exit $left`)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ep-bash-'));
    const bin = join(dir, 'devcloud');
    writeFileSync(bin, '#!/bin/sh\nexec bash -s\n', { mode: 0o755 }); // runs the step's script as the VM would
    const run = new ScriptRunner({ devcloud: bin, vm: 'vm1' }, scratch());
    expect(await run.step('teardown', 'echo gone; exit 3', { root: true })).toEqual({ rc: 3, lines: ['gone'] });
  });
});

describe('composeScript', () => {
  it('carries files as base64 into a stage directory and runs the body after them, with its markers', () => {
    const script = composeScript('echo "$STAGE/a.txt"', { 'a.txt': Buffer.from('payload\n') }, { trace: 'setup' });
    expect(script.startsWith('#!/bin/bash\n')).toBe(true);
    expect(script).toContain(Buffer.from('payload\n').toString('base64'));
    expect(script).toContain('echo "@@BEGIN"');
    expect(script.indexOf('a.txt')).toBeLessThan(script.indexOf('echo "$STAGE/a.txt"'));
    expect(script).toMatch(/echo "@@END \$rc"/);
  });

  it('refuses a file name that would leave the stage directory', () => {
    expect(() => composeScript('true', { '../x': Buffer.from('') })).toThrow(/file name/);
  });
});

describe('the VM machine', () => {
  it('hands the enrollment code to `mawsd enroll` on its stdin alone, the name a checked word', async () => {
    const fake = standin(() => '@@BEGIN\n{"enrollment":"org-listed","name":"o10-m11-x"}\n@@END 0\n');
    const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://100.116.205.27:47831' });
    const code = `smns-enroll-v2.${'Z'.repeat(80)}`;
    await expect(vm.enroll(code, 'o10-m11-x')).resolves.toMatchObject({ enrollment: 'org-listed' });
    const [call] = fake.calls();
    expect(call.script).toMatch(/printf '%s\\n' 'smns-enroll-v2\.Z+' \| \/opt\/o10-m11\/scene\.sh enroll o10-m11-x/);
    await expect(vm.enroll(code, 'bad name; rm -rf /')).rejects.toThrow(/machine name/);
  });

  it('reads `mawsd endpoint status --json` and `keys --json` as JSON, and refuses a policy outside the grammar', async () => {
    const fake = standin((script) => (script.includes('status') ? '@@BEGIN\n{"enrollment":"org-listed","hub":{"connected":true},"listener":{"bound":true},"channels":{"relayed":0,"direct":0},"rl10":{"connected":true}}\n@@END 0\n' : '@@BEGIN\n{"read_only":true,"ceiling":"default","source":"set"}\n@@END 0\n'));
    const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://100.116.205.27:47831' });
    expect(await vm.status()).toMatchObject({ enrollment: 'org-listed', hub: { connected: true } });
    expect(await vm.policy({ readOnly: true, ceiling: 'default' })).toEqual({ read_only: true, ceiling: 'default' });
    expect(fake.calls()[1].script).toContain('/opt/o10-m11/scene.sh mawsd endpoint policy --read-only on --ceiling default --json');
    await expect(vm.policy({ ceiling: 'x; reboot' })).rejects.toThrow(/ceiling/);
  });

  it('fails a step whose script exits non-zero, naming its last lines', async () => {
    const fake = standin(() => '@@BEGIN\nmawsd: not running\n@@END 3\n');
    const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://100.116.205.27:47831' });
    await expect(vm.keys()).rejects.toThrow(/keys on vm1 exited 3: mawsd: not running/);
  });
});

describe('the VM’s record of the sessions the run started', () => {
  it('reads `started`’s lines: lane A’s session, the seat’s and lane B’s, whichever exist', async () => {
    const fake = standin(() => '@@BEGIN\nsession 0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13\nseat 1a2b3c4d-7c1d-4b9e-9a61-2d4f6b8c0e13\nlane-b 2b3c4d5e-7c1d-4b9e-9a61-2d4f6b8c0e13\n@@END 0\n');
    const machine = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831' });
    expect(await machine.laneA.started()).toEqual(['0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13', '1a2b3c4d-7c1d-4b9e-9a61-2d4f6b8c0e13', '2b3c4d5e-7c1d-4b9e-9a61-2d4f6b8c0e13']);
    expect(fake.calls()[0].script).toContain('/opt/o10-m11/scene.sh started');
  });
});

describe('the VM’s lane B session', () => {
  const APP = '5b1f0c2e-8d4a-4c3b-9e7f-1a2b3c4d5e6f';
  const ENGINE = '0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13';

  it('is the scratch scene’s alone: a machine is given one only when it asks (production’s never does)', () => {
    expect(new VmMachine({ devcloud: '/x', vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831' }).laneB).toBeNull();
    expect(new VmMachine({ devcloud: '/x', vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831', laneB: true }).laneB).not.toBeNull();
  });

  it('starts by `lane-b-up <tag>` and reads its ids; reads the engine host’s numbering by `lane-b-events <app>`', async () => {
    // The reply runs in the stand-in's own process: its ids are written out, not closed over.
    const fake = standin((script) =>
      script.includes('lane-b-up')
        ? '@@BEGIN\n{"app":"5b1f0c2e-8d4a-4c3b-9e7f-1a2b3c4d5e6f","launch":"lnch0001","engine":"0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13","alias":"o10-b"}\n@@END 0\n'
        : '@@BEGIN\nev lnch0001 1 0\nev lnch0001 1 1\nevents 2 complete\n@@END 0\n',
    );
    const machine = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831', laneB: true });
    expect(await machine.laneB!.up('abc1b')).toEqual({ app: APP, launch: 'lnch0001', engine: ENGINE, alias: 'o10-b' });
    expect(await machine.laneB!.events(APP)).toEqual([
      { epoch: 'lnch0001', seq: 1, idx: 0 },
      { epoch: 'lnch0001', seq: 1, idx: 1 },
    ]);
    expect(fake.calls().map((c) => c.script.match(/scene\.sh [^\n]*/)?.[0])).toEqual(['scene.sh lane-b-up abc1b', `scene.sh lane-b-events ${APP}`]);
    await expect(machine.laneB!.up('Bad tag')).rejects.toThrow(/a tag/);
    await expect(machine.laneB!.events('not-an-id')).rejects.toThrow(/an app session id/);
  });

  it('takes the numbering only whole: its count line matching, and its end there', () => {
    expect(laneBEventLines(['ev lnch0001 3 0', 'events 1 complete'])).toEqual([{ epoch: 'lnch0001', seq: 3, idx: 0 }]);
    expect(() => laneBEventLines(['ev lnch0001 3 0', 'events 2 complete'])).toThrow(/counted 2 events and printed 1/);
    expect(() => laneBEventLines(['ev lnch0001 3 0', 'lane-b: mawsd did not answer session.events within 30 s'])).toThrow(/did not end/);
  });
});
