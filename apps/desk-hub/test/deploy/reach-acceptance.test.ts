// P5 O18 M6's live acceptance of message reach (deploy/reach-acceptance.ts, reach-items.ts, the reach scenes of
// endpoint-machine.ts and vm/scene.sh): what a command line asks for and refuses, production above all; the operator's
// pty path refused for any hub but staging's and any machine outside the run's own scenes, before anything reaches the
// VM; the reach verbs' words checked on this side as on the VM's; O10's own scene driven exactly as before; the VM's
// setup composed from a full bundle staged in bounded steps; and the readings the items make of what the scenes print.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audienceDigest } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, STAGING_HOST, STAGING_ORG } from '../../deploy/config.ts';
import { operatorRefusal, REACH_SCENES, sessionWords, tagWord, VmMachine, type ReachSceneName } from '../../deploy/endpoint-machine.ts';
import { BUNDLE_PATH, bundleSteps, nodePin, reachItemsFor, reachMode, reachSetupHead } from '../../deploy/reach-acceptance.ts';
import { archiveAfter, givenPastNotice, heldPastNotice, inventoryStreams, item3b, policyRevOf, REACH_ITEMS, refusedReachLine, streamOfSession, streamsOf, uplinkWithheld, withheldHolds, type ReachReport, type ReachScene } from '../../deploy/reach-items.ts';

const deploy = join(import.meta.dirname, '../../deploy');
const staging = { worker: 'desk-hub-staging', host: STAGING_HOST };
const SID = '0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13';
const OTHER = '1a2b3c4d-7c1d-4b9e-9a61-2d4f6b8c0e13';

/** A stand-in for devcloud: records each script it is handed, answers `reply`'s lines between the step markers. */
function standin(reply = '@@BEGIN\nok\n@@END 0\n'): { bin: string; scripts: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'reach-devcloud-'));
  const bin = join(dir, 'devcloud');
  writeFileSync(bin, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst n = fs.readdirSync(${JSON.stringify(dir)}).filter((f) => f.startsWith('call-')).length;\nfs.writeFileSync(${JSON.stringify(dir)} + '/call-' + n, fs.readFileSync(0, 'utf8'));\nprocess.stdout.write(${JSON.stringify(reply)});\n`);
  chmodSync(bin, 0o755);
  return {
    bin,
    scripts: () =>
      readdirSync(dir)
        .filter((f) => f.startsWith('call-'))
        .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
        .map((f) => readFileSync(join(dir, f), 'utf8')),
  };
}
const scratch = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'reach-scratch-')), 'steps');
  mkdirSync(dir, { mode: 0o700 });
  return dir;
};
const sceneLine = (script: string) => script.match(/\/opt\/[a-z0-9-]+\/scene\.sh [^\n]*/)?.[0];

describe('the command line’s mode', () => {
  it('runs on staging with the admin device’s keys, and never on production', () => {
    expect(reachMode({ 'device-keys': '/k.json' }, staging)).toEqual({ mode: 'staging' });
    expect(reachMode({}, staging)).toEqual({ refused: expect.stringMatching(/--device-keys/) });
    expect(reachMode({ 'device-keys': '/k.json' }, { worker: 'desk-hub', host: PRODUCTION_HOST })).toEqual({ refused: expect.stringMatching(/names production/) });
    expect(reachMode({ 'device-keys': '/k.json', production: true }, staging)).toEqual({ refused: expect.stringMatching(/staging alone/) });
    expect(reachMode({ 'vm-setup': true, production: true }, null)).toEqual({ refused: expect.stringMatching(/staging alone/) });
  });

  it('sets the reach scenes up or tears them down, one at a time and with no hub', () => {
    expect(reachMode({ 'vm-setup': true }, null)).toEqual({ mode: 'vm-setup' });
    expect(reachMode({ 'vm-teardown': true }, staging)).toEqual({ mode: 'vm-teardown' });
    expect(reachMode({ 'vm-setup': true, 'vm-teardown': true }, null)).toEqual({ refused: expect.stringMatching(/one at a time/) });
    expect(reachMode({}, null)).toEqual({ refused: expect.stringMatching(/--config/) });
  });

  it('runs every item in the run’s order, or those named in that order; 6a is cited, never run', () => {
    expect(reachItemsFor(undefined)).toEqual({ items: [...REACH_ITEMS] });
    expect(REACH_ITEMS).toEqual(['2', '8', '3a', '3b', '3c', '7', '1', '5', '4', '3e', '3d', '6b', '6c', '6d', '6e']);
    expect(reachItemsFor('6e, 2,3a')).toEqual({ items: ['2', '3a', '6e'] });
    expect(reachItemsFor('6a')).toEqual({ refused: expect.stringMatching(/6a is cited, not run/) });
    expect(reachItemsFor('3')).toEqual({ refused: expect.stringMatching(/not 3$/) });
  });

  it('pins staging by deploy/staging.json’s own host and org', () => {
    const config = JSON.parse(readFileSync(join(deploy, 'staging.json'), 'utf8')) as { host: string; org: { id: string } };
    expect([config.host, config.org.id]).toEqual([STAGING_HOST, STAGING_ORG]);
  });
});

describe('the operator’s pty path', () => {
  const run = { hub: { host: STAGING_HOST, org: STAGING_ORG }, scenes: ['a1', 'a2', 'b1'] };
  const change = { access: { member: SID, level: 'listed' } } as const;

  it('is refused for any hub but staging’s, by host and by org, before anything reaches the VM', async () => {
    for (const hub of [
      { host: PRODUCTION_HOST, org: 'ssfskim' },
      { host: PRODUCTION_HOST, org: STAGING_ORG },
      { host: STAGING_HOST, org: 'ssfskim' },
      { host: '127.0.0.1:8787', org: STAGING_ORG },
    ]) {
      expect(operatorRefusal(hub, 'a1', run.scenes), JSON.stringify(hub)).toMatch(/widens at staging .* alone/);
      const fake = standin();
      const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47841', scene: 'a1' });
      await expect(vm.operator(change, { ...run, hub })).rejects.toThrow(/widens at staging/);
      expect(fake.scripts()).toEqual([]);
    }
  });

  it('is refused for a machine outside the run’s own scenes: another scene, or one of none (O10’s, production’s)', async () => {
    expect(operatorRefusal(run.hub, 'a3', run.scenes)).toMatch(/the run's own scenes' alone .* not the scene a3/);
    expect(operatorRefusal(run.hub, null, run.scenes)).toMatch(/not a machine of no scene/);
    for (const options of [{ scene: 'a3' as ReachSceneName }, {}]) {
      const fake = standin();
      const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47841', ...options });
      await expect(vm.operator(change, run)).rejects.toThrow(/the run's own scenes' alone/);
      expect(fake.scripts()).toEqual([]);
    }
  });

  it('runs at staging, on a scene of the run’s, as that scene’s `operator` verb', async () => {
    expect(operatorRefusal(run.hub, 'b1', run.scenes)).toBeNull();
    const fake = standin('@@BEGIN\nS: access listed, policyRev 4\noperator: confirmed\n@@END 0\n');
    const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47843', scene: 'b1' });
    expect((await vm.operator(change, run)).lines).toContain('operator: confirmed');
    expect(sceneLine(fake.scripts()[0])).toBe(`/opt/o18-m6/scene.sh --scene b1 operator access ${SID} listed`);
  });
});

describe('the reach scenes’ verbs', () => {
  it('give every verb its scene first, and leave O10’s scene exactly as it was', async () => {
    const reach = standin('@@BEGIN\n{"enrollment":"org-listed","hub":{"connected":true},"listener":{"bound":true},"channels":{"relayed":0,"direct":0},"rl10":{"connected":true}}\n@@END 0\n');
    const vm = new VmMachine({ devcloud: reach.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47842', scene: 'a2' });
    expect(vm.label).toBe('the scene a2 on vm1');
    await vm.up();
    await vm.status();
    expect(reach.scripts().map(sceneLine)).toEqual(['/opt/o18-m6/scene.sh --scene a2 up', '/opt/o18-m6/scene.sh --scene a2 mawsd endpoint status --json']);
    const o10 = standin('@@BEGIN\n{"enrollment":"org-listed","hub":{"connected":true},"listener":{"bound":true},"channels":{"relayed":0,"direct":0},"rl10":{"connected":true}}\n@@END 0\n');
    const old = new VmMachine({ devcloud: o10.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831', laneB: true });
    expect([old.label, old.sceneName]).toEqual(['the scratch mawsd on vm1', null]);
    await old.up();
    await old.status();
    await old.laneA.sminos.status();
    expect(o10.scripts().map(sceneLine)).toEqual(['/opt/o10-m11/scene.sh up', '/opt/o10-m11/scene.sh mawsd endpoint status --json', '/opt/o10-m11/scene.sh sminos-status']);
    expect(() => new VmMachine({ devcloud: '/x', vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:1', scene: 'c9' as ReachSceneName })).toThrow(/a reach scene/);
  });

  it('are refused on a machine of no scene, before anything reaches the VM', async () => {
    const fake = standin();
    const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47831' });
    await expect(vm.asSession(SID, { listOrg: true })).rejects.toThrow(/a reach scene's verb/);
    await expect(vm.logFiles()).rejects.toThrow(/a reach scene's verb/);
    await expect(vm.mawsdState('freeze')).rejects.toThrow(/a reach scene's verb/);
    expect(fake.scripts()).toEqual([]);
  });

  it('check their words here as the scene checks them there: no space, no `#`, a tag as `<alias>[:<short>]`', async () => {
    expect(tagWord({ alias: 'o18-a1-lane-a', short: 'k3x9' })).toBe('o18-a1-lane-a:k3x9');
    expect(sessionWords({ say: { token: 'o18-i2-abc', tags: [{ alias: 's', short: 'q1' }, { alias: 'u' }] } })).toEqual(['say', 'o18-i2-abc', 's:q1', 'u']);
    expect(sessionWords({ share: { member: SID, person: 'b'.repeat(32), grade: 'none' } })).toEqual(['share', SID, 'b'.repeat(32), 'none']);
    expect(() => tagWord({ alias: 'a#b' })).toThrow(/a tag/);
    expect(() => tagWord({ alias: 'a b' })).toThrow(/a tag/);
    expect(() => sessionWords({ say: { token: 'Bad Token', tags: [{ alias: 'u' }] } })).toThrow(/say/);
    expect(() => sessionWords({ say: { token: 'o18-x-y', tags: [] } })).toThrow(/at least one tag/);
    expect(() => sessionWords({ access: { member: SID, level: 'owner' as never } })).toThrow(/a level/);
    expect(() => sessionWords({ share: { member: SID, person: 'b; rm', grade: 'list' } })).toThrow(/share/);
    const fake = standin('@@BEGIN\n{"writer":"m/x","seq":3}\n@@END 0\n');
    const vm = new VmMachine({ devcloud: fake.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47843', scene: 'b1' });
    await expect(vm.asSession('not-a-session', { listOrg: true })).rejects.toThrow(/a session id/);
    await expect(vm.forgeSay(SID, OTHER, 'Bad_Alias', 'o18-t-1')).rejects.toThrow(/forge-say/);
    await expect(vm.grepHome(SID, 'yesterday')).rejects.toThrow(/an ISO time/);
    await expect(vm.events('a b')).rejects.toThrow(/events/);
    await expect(vm.archive(['ok-token', 'not ok'])).rejects.toThrow(/archive-ls/);
    expect(fake.scripts()).toEqual([]);
    expect(await vm.forgeSay(SID, OTHER, 'o18-forged-x', 'o18-t-1')).toEqual({ writer: 'm/x', seq: 3 });
    await vm.asSession(SID, { say: { token: 'o18-t-2', tags: [{ alias: 'S', short: 'q1' }] } });
    expect(fake.scripts().map(sceneLine)).toEqual([`/opt/o18-m6/scene.sh --scene b1 forge-say ${SID} ${OTHER} o18-forged-x o18-t-1`, `/opt/o18-m6/scene.sh --scene b1 as-session ${SID} say o18-t-2 S:q1`]);
  });

  it('read what the scenes print: grep-home’s counts and total, archive-ls’s files, tombstones and tokens', async () => {
    const grep = new VmMachine({ devcloud: standin('@@BEGIN\n2 projects/p/log/a.b.jsonl\n1 daemon.log\ntotal 3\n@@END 0\n').bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47843', scene: 'b1' });
    expect(await grep.grepHome(SID, '2026-11-07T01:02:03.456Z')).toEqual({ files: { 'projects/p/log/a.b.jsonl': 2, 'daemon.log': 1 }, total: 3 });
    const arch = new VmMachine({ devcloud: standin('@@BEGIN\narchive: main at 0123456789ab\nfile log/m.u.jsonl\ntomb log/m.u.jsonl 4\ntoken o18-t-1 0\n@@END 0\n').bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47841', scene: 'a1' });
    expect(await arch.archive(['o18-t-1'])).toEqual({ head: '0123456789ab', files: ['log/m.u.jsonl'], tombs: [{ file: 'log/m.u.jsonl', seq: 4 }], tokens: { 'o18-t-1': 0 } });
    const empty = new VmMachine({ devcloud: standin('@@BEGIN\narchive: no commit on main\n@@END 0\n').bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47841', scene: 'a1' });
    expect(await empty.archive()).toBeNull();
    const ev = standin('@@BEGIN\nuplink {"archive":false}\nlog x archive\n@@END 0\n');
    const said = new VmMachine({ devcloud: ev.bin, vm: 'vm1' }, scratch(), { directUrl: 'ws://vm1:47843', scene: 'b1' });
    expect(await said.archiveEvidence()).toEqual(['uplink {"archive":false}', 'log x archive']);
    expect(sceneLine(ev.scripts()[0])).toBe('/opt/o18-m6/scene.sh --scene b1 archive-evidence');
  });
});

describe('the VM’s setup', () => {
  it('stages the full bundle in bounded steps, the first truncating, which decode back to it byte for byte', () => {
    const bundle = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const steps = bundleSteps(bundle, 300);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain(`: > ${BUNDLE_PATH}`);
    expect(steps.slice(1).every((s) => !s.includes(': >') && s.includes(`[[ -f ${BUNDLE_PATH} ]]`))).toBe(true);
    const decoded = Buffer.concat(steps.map((s) => Buffer.from(s.split("<<'O18_M6_B64' || exit 1\n")[1].split('\nO18_M6_B64')[0].replace(/\n/g, ''), 'base64')));
    expect(decoded.equals(bundle)).toBe(true);
  });

  it('gives setup.sh its reach mode and checked ids, and the pinned Node from packaging/mawsd/node.json', () => {
    const node = nodePin(readFileSync(join(import.meta.dirname, '../../../../packaging/mawsd/node.json'), 'utf8'));
    expect(node.version).toMatch(/^\d+\.\d+\.\d+$/);
    const ids = { commit: 'a'.repeat(40), bundleSha256: 'b'.repeat(64), sminosNew: 'c'.repeat(40), sminosOld: 'd'.repeat(40), node };
    const head = reachSetupHead(ids);
    expect(head.split('\n')[0]).toBe('RUN=o18');
    expect(head).toContain(`BUNDLE='${BUNDLE_PATH}'`);
    expect(head).toContain(`NODE_PIN='${node.version}'`);
    expect(() => reachSetupHead({ ...ids, sminosNew: 'HEAD;rm' })).toThrow(/new sminos/);
    expect(() => reachSetupHead({ ...ids, bundleSha256: 'x' })).toThrow(/sha256/);
    expect(() => nodePin('{"version":"24"}')).toThrow(/pins no Linux Node/);
  });
});

describe('what the items read', () => {
  it('a report line’s policyRev, the last named', () => {
    expect(policyRevOf(['S: access private, policyRev 3; its unlisted notice written, then its snapshot'])).toBe(3);
    expect(policyRevOf(['widening reach needs its owner: run this in a terminal, or use MAWS'])).toBeNull();
  });

  it('sminos’s refused-reach line, as deliver_reach writes it: the outcome’s name is never in it', () => {
    expect(refusedReachLine('2026-11-07T06:30:01Z the endpoint refused o18-b1-x/e7fe50a8:3 (o18-m6-x) reach into 80db411d: not-in-audience; nothing delivered')).toBe(true);
    expect(refusedReachLine('2026-11-07T06:30:01Z the endpoint refused o18-b1-x/e7fe50a8:3 (o18-m6-x) reach into 80db411d: no reason given; nothing delivered')).toBe(true);
    expect(refusedReachLine('2026-11-07T06:30:01Z the endpoint refused o18-b1-x/e7fe50a8:3 (o18-m6-x) as words into 80db411d: nothing delivered')).toBe(false);
    expect(refusedReachLine('settled refused-reach')).toBe(false);
  });

  it('a session’s stream writer and its log file, and the streams of a session among writers', () => {
    const a = 'a'.repeat(32);
    const s = streamOfSession('o18-a1-x', SID, [a]);
    expect(s).toEqual({ writer: `o18-a1-x/${SID}~${audienceDigest([a])}`, file: `o18-a1-x.${SID}~${audienceDigest([a])}.jsonl` });
    expect(streamsOf([`o18-a1-x/${SID}`, s.writer, `o18-b1-x/${OTHER}~0123456789abcdef`], SID)).toEqual([s.writer]);
  });

  it('what a withdrawn reader holds of a private session: its notice and a share’s stream from before, never the owner-only stream nor anything newer', () => {
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    const own = streamOfSession('o18-a1-x', SID, [a]).writer;
    const notice = streamOfSession('o18-a1-x', SID, [b]).writer;
    const shared = streamOfSession('o18-a1-x', SID, [a, b]).writer;
    const at = '2026-11-07T10:00:00.000Z';
    const held = [
      { writer: notice, seq: 1, kind: 'unlisted', ts: at },
      { writer: shared, seq: 1, kind: 'joined', ts: '2026-11-07T09:00:00.000Z' },
      { writer: shared, seq: 2, withheld: true },
      { writer: `o18-a1-x/${OTHER}~0123456789abcdef`, seq: 4, kind: 'say', ts: '2026-11-07T11:00:00.000Z' },
    ];
    expect(givenPastNotice(SID, own, at, [notice, shared, `o18-a1-x/${SID}`], held)).toEqual([]);
    expect(givenPastNotice(SID, own, at, [own], [])).toEqual([own]);
    expect(givenPastNotice(SID, own, at, [], [...held, { writer: shared, seq: 3, kind: 'say', ts: '2026-11-07T10:00:01.000Z' }])).toEqual([`${shared}:3`]);
    expect(givenPastNotice(SID, own, at, [], [{ writer: own, seq: 1, kind: 'joined', ts: '2026-11-07T09:00:00.000Z' }])).toEqual([own]);
  });

  it('what B’s machine holds of private S past its notice: audiences.json judged by its entry, never by the id search', () => {
    const a = 'a'.repeat(32);
    const own = { v: 1, capabilities: ['access', 'reach'], sessions: { [SID]: { owners: [a], members: [a], policyRev: 5 } } };
    const listedEntry = { v: 1, capabilities: ['access', 'reach'], sessions: { [SID]: { owners: [a], members: null, policyRev: 4 }, [OTHER]: { owners: [a], members: null, policyRev: 1 } } };
    // The rewritten document names S (its listed entry), and the search after the notice counts it: not a leak.
    expect(heldPastNotice({ files: { 'daemon/audiences.json': 1 }, total: 1 }, listedEntry, own, SID)).toEqual([]);
    expect(heldPastNotice({ files: {}, total: 0 }, { v: 1, sessions: {} }, own, SID)).toEqual([]);
    expect(heldPastNotice({ files: {}, total: 0 }, { v: 1, sessions: { [SID]: { owners: [a], policyRev: 2 } } }, own, SID)).toEqual([]);
    // Anywhere else the search stands; and an entry carrying S's private audience, or its rev, is the leak.
    expect(heldPastNotice({ files: { 'daemon/audiences.json': 1, 'projects/p/log/x.jsonl': 2 }, total: 3 }, listedEntry, own, SID)).toEqual(['S’s id in projects/p/log/x.jsonl (2 line(s))']);
    expect(heldPastNotice({ files: {}, total: 0 }, { v: 1, sessions: { [SID]: { owners: [a], members: [a], policyRev: 5 } } }, own, SID)).toEqual([
      'daemon/audiences.json gives S a member list ([' + JSON.stringify(a) + '])',
      'daemon/audiences.json holds S at policyRev 5, not below its private 5',
    ]);
    expect(heldPastNotice({ files: {}, total: 0 }, { v: 1, sessions: { [SID]: { members: null, policyRev: 6 } } }, own, SID)).toEqual(['daemon/audiences.json holds S at policyRev 6, not below its private 5']);
    // The owner's machine must hold S private for the comparison to mean anything.
    expect(() => heldPastNotice({ files: {}, total: 0 }, listedEntry, listedEntry, SID)).toThrow(/S's own machine holds no private audience/);
  });

  it('the HTTP inventory a probe is served lists no audience stream at all, a session born private’s included', () => {
    const C1 = '2b3c4d5e-7c1d-4b9e-9a61-2d4f6b8c0e13';
    const c1 = streamOfSession('o18-a1-x', C1, ['a'.repeat(32)]).writer;
    const notice = streamOfSession('o18-a1-x', SID, ['b'.repeat(32)]).writer;
    const inventory = { projects: [{ id: 'p', writers: [{ writer: `o18-a1-x/${SID}`, upTo: 3 }, { writer: c1, upTo: 1 }] }, { id: 'q', writers: [{ writer: notice, upTo: 1 }] }] };
    expect(inventoryStreams(inventory)).toEqual([c1, notice]);
    expect(inventoryStreams({ projects: [{ id: 'p', writers: [{ writer: `o18-a1-x/${SID}`, upTo: 3 }] }] })).toEqual([]);
    expect(inventoryStreams(null)).toEqual([]);
  });

  it('an archive wait that times out fails with the archiver’s own evidence: its uplink.json designation and daemon.log', async () => {
    const evidence = ['uplink {"archive":true,"archive_at":1762495200.5}', 'log 2026-11-07T06:10:00Z sync o18: archive: git fetch failed'];
    const archiver = { name: 'o18-b1-x', vm: { archiveEvidence: async () => evidence } };
    const scene = { machines: { a1: { vm: { archive: async () => null } } } } as unknown as ReachScene;
    await expect(archiveAfter(scene, archiver as never, null, [], 0, 0)).rejects.toThrow(
      'no new archive commit within 0 s; the archiver o18-b1-x: uplink {"archive":true,"archive_at":1762495200.5} | log 2026-11-07T06:10:00Z sync o18: archive: git fetch failed',
    );
    const silent = { name: 'o18-a1-x', vm: { archiveEvidence: async () => Promise.reject(new Error('scene down')) } };
    await expect(archiveAfter(scene, silent as never, null, [], 0, 0)).rejects.toThrow(/the archiver o18-a1-x: its evidence unread \(Error: scene down\)/);
  });

  it('3b’s say to S and U together adds no private marker: its public split, U’s, is the archive’s to keep', async () => {
    // Every verb succeeds but a say, which exits 1: each check runs to its say and stops there.
    const vm = { asSession: async (_s: string, change: object) => ({ rc: 'say' in change ? 1 : 0, lines: [] }), operator: async () => ({ rc: 0, lines: [] }) };
    const session = (label: string) => ({ label, session: `${label}-id`, alias: label.toLowerCase(), machine: { vm } });
    const S = session('S');
    const scene = { S, U: session('U'), T: session('T'), b: { member: 'b'.repeat(32) }, seats: { L1: session('L1') }, machines: { b1: { vm } }, privateTokens: [] as string[], tag: 't', run: {} } as unknown as ReachScene;
    const checks: string[] = [];
    const report: ReachReport = {
      check: async (_item, check, run) => {
        checks.push(check);
        await run().catch(() => {});
        return true;
      },
      add: () => {},
      bySuites: () => {},
    };
    await item3b(scene, report);
    expect(checks).toHaveLength(2);
    expect(scene.privateTokens).toEqual([]);
  });

  it('a withheld position, as a seq or within a run, wherever uplink.json keeps it', () => {
    const uplink = { withheld: { 'm/u': [2, [5, 7]] }, archive_have: { withheld: { 'm/v': [9] } } };
    const held = uplinkWithheld(uplink);
    expect([2, 5, 6, 7].every((n) => withheldHolds(held, 'm/u', n))).toBe(true);
    expect(withheldHolds(held, 'm/u', 3)).toBe(false);
    expect(withheldHolds(held, 'm/v', 9)).toBe(true);
    expect(withheldHolds(uplinkWithheld(null), 'm/u', 2)).toBe(false);
  });

  it('every scene the run may bring up is one the scene script knows', () => {
    expect([...REACH_SCENES]).toEqual(['a1', 'a2', 'b1', 'a3']);
  });
});
