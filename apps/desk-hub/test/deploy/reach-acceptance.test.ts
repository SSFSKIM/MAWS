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
import { BUNDLE_PATH, bundleSteps, nodePin, reachItemsFor, reachMode, reachSetupHead, reachSetupPayload } from '../../deploy/reach-acceptance.ts';
import { draftOf, policyOf, readingOf, recordAct, recordResult } from '../../deploy/reach-acts.ts';
import { archiveAfter, givenPastNotice, heldPastNotice, inventoryStreams, item3b, itemCutover, itemReader, itemVisibility, policyRevOf, REACH_ITEMS, refusedReachLine, refusedThroughApp, setAccess, shareS, streamOfSession, streamsOf, uplinkWithheld, withheldHolds, type ReachReport, type ReachScene } from '../../deploy/reach-items.ts';

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
    expect(REACH_ITEMS).toEqual(['2', '8', 'm6b-cutover', '3a', '3b', '3c', '7', '1', '5', '4', '3e', '3d', '6b', '6c', '6d', '6e', 'm6b-visibility', 'm6b-reader']);
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

  it('stages lane B’s client for A1’s lane B session (O8 M6b), which the reach stage requires and installs with a marketplace of the new sminos', () => {
    const payload = reachSetupPayload(join(import.meta.dirname, '../..'), join(import.meta.dirname, '../../../..'), { new: Buffer.from('n'), old: Buffer.from('o') });
    expect(Object.keys(payload).sort()).toEqual(['lane-b.mjs', 'scene.sh', 'sminos-new.tar', 'sminos-old.tar', 'stub-api.mjs', 'stub-model.mjs']);
    const reach = readFileSync(join(deploy, 'vm', 'setup.sh'), 'utf8').split('reach_setup() {')[1].split('\n}\n')[0];
    expect(reach).toMatch(/for f in [^;]*\blane-b\.mjs\b[^;]*; do \[\[ -s \$STAGE\/\$f \]\]/);
    expect(reach).toContain('cp -R $O/sminos-new $O/market/sminos');
    expect(reach).toContain('"name": "o10-m11"');
  });
});

describe('what the items read', () => {
  it('a report line’s policyRev, the last named', () => {
    expect(policyRevOf(['S: access private, policyRev 3; its unlisted notice written, then its snapshot'])).toBe(3);
    expect(policyRevOf(['widening reach needs its owner: run this in a terminal, or use MAWS'])).toBeNull();
  });

  it('names no check in a word staging-run.sh’s filter drops (token, secret, bearer): its line would never reach the log', () => {
    const filter = readFileSync(join(deploy, 'staging-run.sh'), 'utf8').match(/^filter\(\) \{ perl -ne .*\/(token\|secret\|bearer)\/i/m)?.[1];
    expect(filter).toBe('token|secret|bearer');
    const titles = [...readFileSync(join(deploy, 'reach-items.ts'), 'utf8').matchAll(/report\.check\((?:'[0-9a-e]+'|[A-Z]+), [`']([^`']*)[`']/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(40);
    expect(titles.filter((t) => new RegExp(filter as string, 'i').test(t))).toEqual([]);
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

// ---- P5 O8 M6b's live proof, layer 1 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b): the reach scenes
// on a build whose endpoint says `record`, where sminos widens only through MAWS's record acts.

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const APP = '3c4d5e6f-7c1d-4b9e-9a61-2d4f6b8c0e13';
/** sminos 1.39.0's refusal of a widening once its endpoint said `record` (sminos_visibility.py's THROUGH_APP). */
const THROUGH_APP = "widening reach on this machine is the app's: use MAWS (the session's Share sheet), where its owner confirms it; narrowing still runs here";

type Act = { machine: string; action: string; args: Record<string, unknown>; opId: string; stepUp?: unknown; session?: string; context?: unknown };
type Answer = { ok: true; output: unknown } | { ok: false; code: string };

/** A device's channel, faked: every act and call kept; acts answered by `ack` and `outcome`, calls by `answer`. */
function fakeChannel(o: { ack?: (a: Act) => string; outcome?: (a: Act) => unknown; answer?: (name: string, input: Record<string, unknown>) => Answer } = {}) {
  const acts: Act[] = [];
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let n = 0;
  let closed = 0;
  const remote = {
    device: {
      action: (fields: Omit<Act, 'opId'>) => ({ v: 1, org: 'staging-ssfskim', device: 'd1', opId: `op-${++n}`, opCreated: 't', nonce: 'n', created: 't', ...fields }),
      stepUp: async (a: Act) => ({ ...a, stepUp: { kid: 'k', sig: 's' } }),
    },
    act: async (a: Act) => {
      acts.push(a);
      return o.ack?.(a) ?? 'accepted';
    },
    done: async (opId: string) => o.outcome?.(acts.find((a) => a.opId === opId)!) ?? { state: 'done', result: { changed: true, policyRev: 4 } },
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      return o.answer?.(name, input) ?? { ok: false as const, code: 'not-offered' };
    },
    close: () => void closed++,
  };
  return { remote, acts, calls, closed: () => closed };
}

/** A report that records each check's verdict. */
function recordingReport(): ReachReport & { checks: Array<{ item: string; check: string; status: 'pass' | 'fail'; detail: string }> } {
  const checks: Array<{ item: string; check: string; status: 'pass' | 'fail'; detail: string }> = [];
  return {
    checks,
    check: async (item, check, run) => {
      try {
        const detail = await run();
        checks.push({ item, check, status: 'pass', detail: typeof detail === 'string' ? detail : detail.skip });
        return true;
      } catch (error) {
        checks.push({ item, check, status: 'fail', detail: (error as Error).message });
        return false;
      }
    },
    add: (item, status, check, detail) => void checks.push({ item, check, status: status === 'pass' ? 'pass' : 'fail', detail }),
    bySuites: () => {},
  };
}

/**
 * S on A1 and the run's machines, faked: S's policy as sminos keeps it (`access`, `shares`, `policyRev`), moved by the
 * session's own shell (narrowing) and by A's record acts, read back by A's `record.policy`; A1's listings to b1.
 */
function fakeScene(o: { operator?: (change: Record<string, unknown>) => { rc: number; lines: string[] }; capabilities?: string[]; bAck?: (a: Act) => string; ignored?: (args: Record<string, unknown>) => boolean } = {}) {
  const policy = { access: 'listed', shares: [] as Array<{ member: string; grade: string }>, policyRev: 3 };
  const shell: unknown[] = [];
  const operator: unknown[] = [];
  const apply = (change: Record<string, unknown>) => {
    const before = JSON.stringify(policy);
    if ('access' in change) policy.access = change.access as string;
    else {
      policy.shares = policy.shares.filter((s) => s.member !== change.member);
      if (change.grade !== null) policy.shares.push({ member: change.member as string, grade: change.grade as string });
    }
    const changed = JSON.stringify(policy) !== before;
    if (changed) policy.policyRev += 1;
    return { changed, policyRev: policy.policyRev };
  };
  const vm = {
    asSession: async (session: string, change: Record<string, unknown>) => {
      shell.push(change);
      if ('access' in change) apply({ access: (change.access as { level: string }).level });
      if ('share' in change) apply({ member: (change.share as { person: string }).person, grade: (change.share as { grade: string }).grade === 'none' ? null : (change.share as { grade: string }).grade });
      return { rc: 0, lines: [`S: access ${policy.access}, policyRev ${policy.policyRev}; its snapshot written`] };
    },
    operator: async (change: Record<string, unknown>) => {
      operator.push(change);
      const answer = o.operator?.(change) ?? { rc: 1, lines: [THROUGH_APP, 'operator: not asked'] };
      if (answer.rc === 0 && 'access' in change) apply({ access: (change.access as { level: string }).level });
      return { ...answer, lines: answer.lines.map((l) => l.replace('<rev>', String(policy.policyRev))) };
    },
    json: async (which: string) => (which === 'audiences' ? { capabilities: o.capabilities ?? ['access', 'reach', 'record'] } : null),
    count: async () => 0,
  };
  const a1 = { scene: 'a1', vm, name: 'o18-a1-t', ref: 'ref-a1', owner: A };
  const S = { label: 'S', session: SID, alias: 's', short: 'q1', launch: 'L-s', machine: a1 };
  const listing = () => ({ body: { org: 'staging-ssfskim', machine: 'ref-a1', session: SID, revision: 10 + policy.policyRev, issued: 't', fields: { owners: [A], project: 'p', lane: 'A', state: 'idle', title: 's', ...(policy.access === 'private' ? { audience: [A, ...policy.shares.map((s) => s.member)].sort(), policyRev: policy.policyRev } : {}) } } });
  const a = fakeChannel({
    // an act `ignored` says is answered done, unchanged, and moves nothing
    outcome: (act) => ({ state: 'done', result: o.ignored?.(act.args) ? { changed: false, policyRev: policy.policyRev } : apply(Object.fromEntries(Object.entries(act.args).filter(([k]) => k !== 'session' && k !== 'appSessionId'))) }),
    answer: (name, input) => (name === 'record.policy' && input.session === SID ? { ok: true, output: { supported: true, policies: [{ session: SID, ...structuredClone(policy) }] } } : { ok: false, code: 'not-offered' }),
  });
  const b = fakeChannel({
    ack: o.bAck,
    answer: (name) => (name === 'endpoint.listings' ? { ok: true, output: { listings: policy.access === 'private' && !policy.shares.some((s) => s.member === B) ? [] : [listing()] } } : { ok: false, code: 'not-offered' }),
  });
  const opened: string[] = [];
  const scene = {
    S,
    a: { member: A },
    b: { member: B },
    machines: { a1 },
    run: { hub: { host: STAGING_HOST, org: STAGING_ORG }, scenes: ['a1', 'a2', 'b1'] },
    tag: 't1',
    channel: async (who: 'a' | 'b', m: { ref: string }) => {
      opened.push(`${who}:${m.ref}`);
      return who === 'a' ? a.remote : b.remote;
    },
    cleanup: { add: () => {} },
    log: () => {},
  } as unknown as ReachScene;
  return { scene, policy, shell, operator, a, b, opened };
}

/** A1's lane B session APP and the run's two members, faked per member: each one's reading and draft of it, as the
 * reader rule keeps them; `forgets` names a field of the reading an update never persists. */
function readerScene(o: { forgets?: 'lastSeen' } = {}) {
  // A1's endpoint, faked per member: each one's reading and draft of APP, as the reader rule keeps them.
  const readings = new Map<string, Record<string, unknown>>([[A, { pinned: false, unread: true, lastSeen: { messageUuid: null, at: null } }]]);
  const drafts = new Map<string, unknown>();
  const shares: Array<Record<string, unknown>> = [];
  const of = (member: string) => readings.get(member) ?? { pinned: false, unread: false, lastSeen: { messageUuid: null, at: null } };
  const endpointOf = (member: string) =>
    fakeChannel({
      outcome: (act) => {
        if (act.action === 'record.shares') {
          shares.push(act.args);
          return { state: 'done', result: { changed: true, policyRev: 2 } };
        }
        drafts.set(member, act.args.draft);
        return { state: 'done' };
      },
      answer: (name, input) => {
        if (input.appSessionId !== APP) return { ok: false, code: 'grade' };
        if (name === 'session.get') return { ok: true, output: { appId: APP, title: 'notes', ...of(member) } };
        if (name === 'session.drafts.get') return { ok: true, output: drafts.get(member) ?? null };
        if (name === 'session.reader.update') {
          const patch = { ...(input.patch as Record<string, unknown>) };
          if (o.forgets !== undefined) delete patch[o.forgets];
          readings.set(member, { ...of(member), ...patch });
          return { ok: true, output: { appSessionId: APP, ...of(member) } };
        }
        return { ok: false, code: 'not-offered' };
      },
    });
  const a = endpointOf(A);
  const b = endpointOf(B);
  const cleanups: string[] = [];
  const a1 = { scene: 'a1', name: 'o18-a1-t', ref: 'ref-a1', owner: A };
  const scene = {
    a: { member: A },
    b: { member: B },
    machines: { a1 },
    tag: 't1',
    bringLaneB: async () => ({ app: APP, engine: OTHER, alias: 'notes', launch: 'L-b' }),
    channel: async (who: 'a' | 'b') => (who === 'a' ? a.remote : b.remote),
    cleanup: { add: (what: string) => void cleanups.push(what) },
    log: () => {},
  } as unknown as ReachScene;
  return { scene, readings, shares, cleanups, a, b };
}

describe('the reach scenes on a build whose endpoint says `record` (P5 O8 M6b)', () => {
  it('widen as a member’s MAWS does, by A’s record act over A’s channel to the session’s machine; narrow from the session’s own shell; never at the terminal', async () => {
    const f = fakeScene();
    await setAccess(f.scene, f.scene.S, 'private');
    expect(f.shell).toEqual([{ access: { member: SID, level: 'private' } }]);
    expect(f.a.acts).toEqual([]);
    await setAccess(f.scene, f.scene.S, 'listed');
    await shareS(f.scene, 'view');
    expect(f.a.acts.map(({ machine, action, args, stepUp }) => ({ machine, action, args, stepped: stepUp !== undefined }))).toEqual([
      { machine: 'ref-a1', action: 'record.access', args: { session: SID, access: 'listed' }, stepped: true },
      { machine: 'ref-a1', action: 'record.shares', args: { session: SID, member: B, grade: 'view' }, stepped: true },
    ]);
    expect(f.opened).toEqual(['a:ref-a1', 'a:ref-a1']);
    expect(f.a.closed()).toBe(2);
    await shareS(f.scene, 'none');
    expect(f.shell.at(-1)).toEqual({ share: { member: SID, person: B, grade: 'none' } });
    expect(f.operator).toEqual([]);
    expect(f.policy).toEqual({ access: 'listed', shares: [], policyRev: 7 });
  });

  it('a record act’s answer is §Q’s `done` and its revision; a refusal, or anything else, fails named', async () => {
    expect(recordResult('record.access', { state: 'done', result: { changed: false, policyRev: 0 } })).toEqual({ changed: false, policyRev: 0 });
    for (const outcome of [{ state: 'done', result: { changed: true } }, { state: 'done', result: { changed: 'yes', policyRev: 2 } }, { state: 'refused', reason: 'read-only' }, { state: 'done' }, null]) {
      expect(() => recordResult('record.access', outcome), JSON.stringify(outcome)).toThrow(/^record\.access answered /);
    }
    const refused = fakeChannel({ ack: () => 'step-up' });
    await expect(recordAct(refused.remote as never, 'ref-a1', { appSessionId: APP }, { member: B, grade: 'converse' })).rejects.toThrow('record.shares refused step-up');
    expect(refused.acts[0]).toMatchObject({ action: 'record.shares', args: { appSessionId: APP, member: B, grade: 'converse' }, stepUp: expect.anything() });
    expect(refused.acts[0]).not.toHaveProperty('session');
    expect(refused.acts[0]).not.toHaveProperty('context');
    const owner = fakeChannel({ ack: () => 'step-up' });
    await expect(recordAct(owner.remote as never, 'ref-a1', { session: SID }, { add: true, member: B })).rejects.toThrow('record.owners refused step-up');
    expect(owner.acts[0]).toMatchObject({ action: 'record.owners', args: { session: SID, add: true, member: B }, stepUp: expect.anything() });
  });

  it('reads a session’s policy from record.policy, and fails an unsupported machine or an unreadable entry', () => {
    const policies = [{ session: SID, access: 'private', shares: [{ member: B, grade: 'list' }], policyRev: 5 }, { session: OTHER, unavailable: true }];
    expect(policyOf({ supported: true, policies }, SID)).toEqual({ access: 'private', shares: [{ member: B, grade: 'list' }], policyRev: 5 });
    expect(() => policyOf({ supported: true, policies }, OTHER)).toThrow(/no readable policy/);
    expect(() => policyOf({ supported: false }, SID)).toThrow(/record\.policy answered/);
  });

  it('reads a reading from a ReaderState or a record, and writes a draft as the composer does', () => {
    const lastSeen = { messageUuid: null, at: '2026-11-07T10:00:00.000Z' };
    expect(readingOf({ appSessionId: APP, pinned: true, unread: false, lastSeen })).toEqual({ pinned: true, unread: false, lastSeen });
    expect(readingOf({ appId: APP, title: 't', pinned: false, unread: true, lastSeen, archived: false })).toEqual({ pinned: false, unread: true, lastSeen });
    expect(() => readingOf({ appSessionId: APP })).toThrow(/no reading/);
    expect(draftOf('o8-x', 'T')).toEqual({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'o8-x' }] }] }, attachments: [], updatedAt: 'T' });
  });

  it('reads sminos 1.39.0’s cutover refusal: a failed widening naming MAWS, never the operator’s older gate', () => {
    expect(refusedThroughApp({ rc: 1, lines: [THROUGH_APP, 'operator: not asked'] })).toBe(true);
    expect(refusedThroughApp({ rc: 0, lines: [THROUGH_APP] })).toBe(false);
    expect(refusedThroughApp({ rc: 1, lines: ['widening reach needs its owner: run this in a terminal, or use MAWS'] })).toBe(false);
  });

  it('the cutover item: A1 kept `record`; the terminal’s widenings refused “use MAWS”, nothing asked or moved; its narrowing runs', async () => {
    const f = fakeScene({ operator: (change) => ('access' in change && (change.access as { level: string }).level === 'private' ? { rc: 0, lines: ['S: access private, policyRev <rev>; its snapshot written', 'operator: not asked'] } : { rc: 1, lines: [THROUGH_APP, 'operator: not asked'] }) });
    const report = recordingReport();
    await itemCutover(f.scene, report);
    expect(report.checks.map((c) => [c.status, c.check, c.detail])).toEqual([
      ['pass', 'A1’s sminos keeps its endpoint’s welcome with `record`', expect.stringContaining('record')],
      ['pass', 'the terminal’s widening refused “use MAWS”, nothing asked or written: listed', expect.stringMatching(/S private, policyRev still \d+$/)],
      ['pass', 'the terminal’s widening refused “use MAWS”, nothing asked or written: a share with B', expect.stringMatching(/S private, policyRev still \d+$/)],
      ['pass', 'narrowing at the terminal still runs', expect.stringMatching(/private/)],
    ]);
    expect(f.operator).toEqual([{ access: { member: SID, level: 'listed' } }, { share: { member: SID, person: B, grade: 'view' } }, { access: { member: SID, level: 'private' } }]);
    expect(f.policy.access).toBe('private');
  });

  it('the cutover item fails where the terminal still widens (an endpoint without `record`)', async () => {
    const f = fakeScene({ capabilities: ['access', 'reach'], operator: () => ({ rc: 0, lines: ['S: access listed, policyRev <rev>', 'operator: confirmed'] }) });
    const report = recordingReport();
    await itemCutover(f.scene, report);
    expect(report.checks.filter((c) => c.status === 'fail').map((c) => c.check)).toEqual([
      'A1’s sminos keeps its endpoint’s welcome with `record`',
      'the terminal’s widening refused “use MAWS”, nothing asked or written: listed',
      'the terminal’s widening refused “use MAWS”, nothing asked or written: a share with B',
    ]);
  });

  it('the visibility item: b1 is listed S by its access, and at listed b1’s converse and approve acts are refused `grade`', async () => {
    const f = fakeScene({ bAck: (a) => (a.action === 'sminos.steer' || a.action === 'sminos.decide' ? 'grade' : 'accepted') });
    const report = recordingReport();
    await itemVisibility(f.scene, report);
    expect(report.checks.map((c) => [c.status, c.check])).toEqual([
      ['pass', 'b1 is listed S by its access: private (not shared)'],
      ['pass', 'b1 is listed S by its access: listed'],
      ['pass', 'b1 is listed S by its access: org-view'],
      ['pass', 'b1 is listed S by its access: org-converse'],
      ['pass', 'at listed, shared with no one: b1’s converse and approve acts on S refused `grade`'],
    ]);
    expect(f.a.acts.map((a) => a.args.access)).toEqual(['private', 'listed', 'org-view', 'org-converse', 'listed']);
    expect(f.b.acts.map(({ action, session, context }) => ({ action, session, context }))).toEqual([
      { action: 'sminos.steer', session: SID, context: { lane: 'A', session: SID, launch: 'L-s' } },
      { action: 'sminos.decide', session: SID, context: { lane: 'A', session: SID, launch: 'L-s' } },
    ]);
    expect(f.b.acts.every((a) => a.stepUp === undefined)).toBe(true);
  });

  it('the visibility item fails where b1 may converse with a session not shared with it', async () => {
    const f = fakeScene();
    const report = recordingReport();
    await itemVisibility(f.scene, report);
    expect(report.checks.at(-1)).toMatchObject({ status: 'fail', detail: 'sminos.steer accepted; sminos.decide accepted' });
  });

  it('the visibility item fails a level A’s act answered done but never set, as A’s record.policy reads it back', async () => {
    // At org-view and org-talk the listing alone can't tell: S listed is listed at each.
    for (const level of ['org-view', 'org-converse']) {
      const f = fakeScene({ bAck: (a) => (a.action === 'sminos.steer' || a.action === 'sminos.decide' ? 'grade' : 'accepted'), ignored: (args) => args.access === level });
      const report = recordingReport();
      await itemVisibility(f.scene, report);
      expect(report.checks.filter((c) => c.status === 'fail').map((c) => c.check), level).toEqual([`b1 is listed S by its access: ${level}`]);
      expect(report.checks.find((c) => c.status === 'fail')!.detail, level).toMatch(new RegExp(`record\\.policy reads S at ${level === 'org-view' ? 'listed' : 'org-view'}, not ${level}$`));
    }
  });

  it('the reader item: A shares a lane B session with B at Converse; B’s pin, reading and draft are B’s, and A’s read back unchanged', async () => {
    const { scene, readings, shares, cleanups, b } = readerScene();
    const report = recordingReport();
    await itemReader(scene, report);
    expect(report.checks.map((c) => [c.status, c.check])).toEqual([
      ['pass', 'a lane B session on A1, shared with B at Converse by A’s record.shares act'],
      ['pass', 'A’s own draft and reading, before B'],
      ['pass', 'B pins it, reads it and keeps a draft of it through b1’s channel'],
      ['pass', 'A’s reading and draft read back unchanged through A’s keys'],
    ]);
    expect(shares).toEqual([{ appSessionId: APP, member: B, grade: 'converse' }]);
    expect(cleanups).toEqual(['remove the lane B session’s share with B']);
    expect(readings.get(B)).toEqual({ pinned: true, unread: false, lastSeen: { messageUuid: null, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) } });
    expect(readings.get(A)).toEqual({ pinned: false, unread: true, lastSeen: { messageUuid: null, at: null } });
    expect(b.acts.map((x) => x.action)).toEqual(['session.drafts.set']);
    expect(b.calls.map((c) => c.name)).toEqual(['session.reader.update', 'session.drafts.get', 'session.get']);
  });

  it('the reader item fails a reading persisted without B’s own lastSeen', async () => {
    const { scene } = readerScene({ forgets: 'lastSeen' });
    const report = recordingReport();
    await itemReader(scene, report);
    expect(report.checks.filter((c) => c.status === 'fail').map((c) => c.check)).toEqual(['B pins it, reads it and keeps a draft of it through b1’s channel']);
    expect(report.checks.find((c) => c.status === 'fail')!.detail).toMatch(/lastSeen/);
  });
});
