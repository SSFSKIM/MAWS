// The VM driver of the endpoint acceptance run (deploy/endpoint-machine.ts; P5 O10 M11), against a stand-in for
// `devcloud vm ssh` that records what it was given: every step is a script file of mode 0600 handed to it on stdin,
// with no `--` and no command words; a file that held a secret is gone before the step ends and its secret reaches no
// argument, log or result; the step's own lines are read between its markers, past the VM's login banner; and every
// wait is bounded.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeScript, ScriptRunner, VmMachine, type Ssh } from '../../deploy/endpoint-machine.ts';

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
