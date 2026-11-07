// The VM scene's script under P5 O18 M6's parametrization (deploy/vm/scene.sh, setup.sh, teardown.sh, check.sh), run
// here as bash on its read-only verb and its refusals: with no `--scene` it is O10 M11's scene exactly (its user, ports,
// directories, verb registry and the match `down` stops a registered verb by), each reach scene its own; and every reach
// verb's words are refused before anything runs (no verb registered, no sminos started), as are the reach verbs on O10's
// scene and the operator's pty path anywhere but a reach scene.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const vm = join(import.meta.dirname, '../../deploy/vm');
const scene = join(vm, 'scene.sh');
const bash = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync('bash', args, { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
const params = (sceneName?: string) =>
  Object.fromEntries(
    bash([scene, ...(sceneName ? ['--scene', sceneName] : []), 'params'])
      .stdout.trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]),
  );
const SID = '0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13';

describe('the scene’s parameters', () => {
  it('are O10 M11’s with no scene named: its user, ports, directories and registry, unchanged', () => {
    expect(params()).toEqual({
      scene: 'o10',
      user: 'o10acc',
      home: '/home/o10acc',
      opt: '/opt/o10-m11',
      ports: 'direct 47831, stub 47899',
      tmux: 'o10-m11',
      verbs: '/run/o10-m11-scene-verbs',
      self: '/opt/o10-m11/scene.sh ',
      sminos: '/opt/o10-m11/bin/sminos',
      pack: '/home/o10acc/pack',
      archive: 'none',
    });
  });

  it('are each reach scene’s own, every one apart from the others and from O10’s', () => {
    const all = ['a1', 'a2', 'b1', 'a3'].map((s) => params(s));
    expect(all.map((p) => [p.user, p.ports])).toEqual([
      ['o18a1', 'direct 47841, stub 47901'],
      ['o18a2', 'direct 47842, stub 47902'],
      ['o18b', 'direct 47843, stub 47903'],
      ['o18a3', 'direct 47844, stub 47904'],
    ]);
    expect(all.map((p) => p.verbs)).toEqual(['/run/o18-a1-verbs', '/run/o18-a2-verbs', '/run/o18-b1-verbs', '/run/o18-a3-verbs']);
    expect(all.map((p) => p.self)).toEqual(['a1', 'a2', 'b1', 'a3'].map((s) => `/opt/o18-m6/scene.sh --scene ${s} `));
    // A3 is the old sminos (6e); the others the new one; none the VM's marketplace's.
    expect(all.map((p) => p.sminos.split('/')[3])).toEqual(['sminos-new', 'sminos-new', 'sminos-new', 'sminos-old']);
    expect(new Set(all.map((p) => p.archive))).toEqual(new Set(['/srv/o18-archive.git']));
    expect(bash([scene, '--scene', 'c9', 'params']).stdout).toMatch(/a scene: --scene a1, a2, b1 or a3/);
  });
});

describe('the reach verbs’ words', () => {
  const refused = (args: string[], message: RegExp) => {
    const run = bash([scene, ...args]);
    expect(run.status, args.join(' ')).toBe(1);
    expect(run.stdout, args.join(' ')).toMatch(message);
    expect(run.stdout, args.join(' ')).not.toMatch(/cannot register/);
  };

  it('are refused before anything runs when they are not of their shape', () => {
    refused(['--scene', 'a1', 'as-session', 'nope', 'list-org'], /a session id/);
    refused(['--scene', 'a1', 'as-session', SID, 'say', 'tok1', 'S#short'], /a tag <alias>\[:<short>\], not S#short/);
    refused(['--scene', 'a1', 'as-session', SID, 'say', 'tok1'], /say <token> <tag>/);
    refused(['--scene', 'a1', 'as-session', SID, 'shell', 'id'], /say\|access\|share\|spawn\|list-org\|find/);
    refused(['--scene', 'a1', 'operator', 'access', SID, 'owner'], /access <member> <private\|listed/);
    refused(['--scene', 'a1', 'operator', 'share', SID, 'b;rm', 'list'], /share <member> <person>/);
    refused(['--scene', 'b1', 'forge-say', SID, SID, 'Bad_Alias', 'tok1'], /forge-say <writer session>/);
    refused(['--scene', 'b1', 'grep-home', 'tok1', '--after', 'yesterday'], /grep-home <token>/);
    refused(['--scene', 'b1', 'log-files', 'extra'], /takes no words/);
    refused(['--scene', 'a1', 'archive-ls', 'a b'], /not a token/);
    refused(['--scene', 'b1', 'archive-evidence', 'extra'], /takes no words/);
  });

  it('are a reach scene’s alone: O10’s scene refuses each, the operator’s pty path first among them', () => {
    for (const verb of [['operator', 'access', SID, 'listed'], ['as-session', SID, 'list-org'], ['forge-say', SID, SID, 'x', 'tok1'], ['log-files'], ['mawsd-freeze'], ['archive-evidence']]) refused(verb, /a reach scene's verb/);
  });
});

describe('setup.sh and teardown.sh', () => {
  it('are bash, and check.sh too', () => {
    for (const f of ['scene.sh', 'setup.sh', 'teardown.sh', 'check.sh']) expect(bash(['-n', join(vm, f)]).status, f).toBe(0);
  });

  it('take O10’s path unless their composer says RUN=o18, and refuse a reach setup the composer did not give its ids', () => {
    const o10 = bash([join(vm, 'setup.sh')], { STAGE: '/nonexistent' });
    expect(o10.status).toBe(2);
    expect(o10.stdout).toMatch(/setup: BASE and COMMIT are the composer's/);
    const reach = bash([join(vm, 'setup.sh')], { RUN: 'o18', STAGE: '/nonexistent', COMMIT: 'x' });
    expect(reach.status).toBe(2);
    expect(reach.stdout).toMatch(/COMMIT, BUNDLE_SHA256, SMINOS_NEW and SMINOS_OLD are the composer's/);
  });
});
