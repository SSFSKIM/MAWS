// The fake machine as the machine-side wave's MW5 producer (`producer: 'mw5'`), on the local runtime through the
// stand-in: a bridged session's presence carries `media` among its ops and available among its controls, the machine's
// desk names the RPC; an upload is answered `queued` with the upload (the RPC's nonce), the root under the session's
// live working directory and each file's name there, and each attachment's states follow as `op` messages, read then
// forwarded, the last `phase: 'end'`, in the order the MW5 live check recorded them on 2.1.310; the hub relays every
// one, `rpc` and `id` the upload; a malformed upload is `bad-shape` before anything runs (`text`, a sixth file, a
// signature that is not its type), a stale session's and a read-only machine's before anything is saved; the same nonce
// twice runs once; and an MW4 producer knows no `media`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyMemory, FakeMachine, loadRecording, MW5_CAPABILITIES, MW5_MEDIA, TWO_SUBAGENTS, type Producer } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { importOrgKey, newNonce, sealRpc } from '../../src/protocol/codes';
import type { RpcDraft, RpcName } from '../../src/protocol/rpc';
import { CONTROL_KEYS, type MediaOpBody, type SessionMessage, type SessionPresence } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(15);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `9c3e0a8e-3b2d-4c5e-9f74-${(++count).toString(16).padStart(12, '0')}`;

/** A PNG's and a PDF's first bytes: the signatures the daemon checks each type against. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n').toString('base64');
const png = (name = 'diagram.png') => ({ name, mediaType: 'image/png', data: PNG });
const pdf = (name = 'brief') => ({ name, mediaType: 'application/pdf', data: PDF });

async function setUp(options: { producer?: Producer; readOnly?: boolean; staleSessions?: string[] } = {}) {
  const project = newProject();
  const name = `mw5-${count}`;
  const recording = loadRecording(TWO_SUBAGENTS);
  const credentials = await enroll(hub, ADMIN, name);
  await hub.timing(name, { heartbeatMs: 250, leaseMs: 45_000 });
  const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [recording], member, memory: emptyMemory(), producer: options.producer ?? 'mw5', readOnly: options.readOnly, staleSessions: options.staleSessions });
  await fm.connect();
  const b = await BrowserClient.open(hub, ADMIN, project);
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
  const S = recording.session;
  const seal = async (rpc: RpcName, args: Record<string, unknown>) =>
    sealRpc(await KEY, { rpc, project, machine: fm.name, member, created: new Date().toISOString(), nonce: newNonce(), args: { session: S, ...args } } as unknown as RpcDraft);
  const send = async (sealed: Awaited<ReturnType<typeof seal>>) => {
    b.send({ t: 'rpc', rpc: sealed });
    return (await b.next((f) => f.t === 'rpc-state' && f.nonce === sealed.nonce && f.state !== 'forwarded', `the ${sealed.rpc}`, 0, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
  };
  const call = async (rpc: RpcName, args: Record<string, unknown>) => send(await seal(rpc, args));
  return { fm, b, S, call, seal, send, recording };
}

const sessionMessages = (b: BrowserClient, kind: SessionMessage['kind']) => b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === kind ? [f.message] : []));
const presences = (b: BrowserClient) => sessionMessages(b, 'presence').map((m) => m.body as SessionPresence);
const mediaOps = (b: BrowserClient, upload: string) => sessionMessages(b, 'op').map((m) => m.body as unknown as MediaOpBody).filter((o) => o.op === 'media' && o.upload === upload);
/** What a body says beyond its own ids and time: the states as the recording orders them. */
const shapeOf = (o: MediaOpBody) => ({ index: o.index, state: o.state, phase: o.phase, attachments: o.attachments.map((a) => [a.index, a.state]) });

describe('the MW5 recording', () => {
  it('is the file the README names, byte for byte', () => {
    const at = (name: string) => fileURLToPath(new URL(`../../fake-machine/dx4/${name}`, import.meta.url));
    const sha = createHash('sha256').update(readFileSync(at('mw5-media.json'))).digest('hex');
    expect(readFileSync(at('README.md'), 'utf8')).toContain(sha);
  });

  it("holds the live check's upload: queued with its root and paths, each attachment read then forwarded, the last the end", () => {
    const { result } = MW5_MEDIA.queued;
    expect(result).toMatchObject({ queued: true, intake: 'native-read', paths: [`${result.upload}.0.png`, `${result.upload}.1.pdf`] });
    expect(result.root).toMatch(/\/\.claude\/desk-uploads\/[0-9a-f-]{36}$/);
    expect(MW5_MEDIA.states.map((o) => [o.index, o.state, o.phase])).toEqual([[0, 'read', 'start'], [1, 'read', 'start'], [0, 'forwarded', 'start'], [1, 'forwarded', 'end']]);
    for (const o of MW5_MEDIA.states) expect(o).toMatchObject({ rpc: result.upload, op: 'media', id: result.upload, upload: result.upload, toolUseId: expect.stringMatching(/^toolu_sminos_[0-9a-f]{24}$/) });
    expect(MW5_MEDIA.states[0]!.attachments).toEqual([{ index: 0, state: 'read', toolUseId: MW5_MEDIA.states[0]!.toolUseId }, { index: 1, state: 'pending' }]);
  });

  it('holds the ends the bridge observed: a denied Read failed, an Esc aborted, a reload that found no result indeterminate', () => {
    expect(MW5_MEDIA.failed).toMatchObject({ op: 'media', state: 'failed', phase: 'end', reason: expect.any(String) });
    expect(MW5_MEDIA.aborted.attachments.map((a) => [a.state, a.reason])).toEqual([['aborted', 'its step was cancelled before the Read ran'], ['forwarded', undefined]]);
    expect(MW5_MEDIA.indeterminate).toMatchObject({ state: 'aborted', phase: 'end', reason: 'indeterminate after reload' });
    expect(MW5_MEDIA.prelude).toBe("[sminos bridge] The person attached diagram.png from the desk: this Read is the bridge's, not your choice.");
    expect(MW5_MEDIA.wake).toBe('[sminos bridge]\nThe person attached diagram.png and brief from the desk: the bridge reads them into the conversation now.');
  });
});

describe('the fake machine as the MW5 producer', () => {
  it('advertises image and PDF intake: the op, the control available, the RPC in its desk', async () => {
    const { fm, b } = await setUp();
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk).toEqual({ sminos: '1.15.0', rpcs: expect.arrayContaining(['media', 'stop-agent', 'tell', 'btw', 'command']), reads: [] });
    const capabilities = presences(b).at(-1)?.capabilities;
    expect(capabilities).toEqual(MW5_CAPABILITIES);
    expect(capabilities?.ops).toContain('media');
    const controls = capabilities?.controls ?? {};
    expect(Object.keys(controls)).toEqual([...CONTROL_KEYS]);
    expect(controls.media).toEqual({ available: true });
    b.close();
    await fm.close();
  });

  it("answers an upload queued, then sends each attachment's states as op, in the recorded order; the hub relays them all", async () => {
    const { fm, b, S, call, recording } = await setUp();
    const state = await call('media', { attachments: [png(), pdf()], delivery: 'queued-turn' });
    const upload = state.nonce;
    const root = `${recording.cwd}/.claude/desk-uploads/${S}`;
    expect(state.outcome).toEqual({ state: 'done', result: { queued: true, upload, intake: 'native-read', root, paths: [`${upload}.0.png`, `${upload}.1.pdf`] } });
    await b.next(() => mediaOps(b, upload).some((o) => o.phase === 'end'), 'the upload ended');
    const ops = mediaOps(b, upload);
    expect(ops.map(shapeOf)).toEqual(MW5_MEDIA.states.map(shapeOf));
    for (const o of ops) expect(o).toMatchObject({ rpc: upload, op: 'media', id: upload, upload, toolUseId: expect.stringMatching(/^toolu_sminos_[0-9a-f]{24}$/) });
    expect(fm.uploads).toEqual([{ session: S, upload, root, paths: [`${upload}.0.png`, `${upload}.1.pdf`], names: ['diagram.png', 'brief'] }]);
    b.close();
    await fm.close();
  });

  it('runs an upload once: the same nonce sent again is answered from the ledger', async () => {
    const { fm, b, seal, send } = await setUp();
    const sealed = await seal('media', { attachments: [png('a'), png('a')], delivery: 'queued-turn' });
    const first = await send(sealed);
    expect(first.outcome).toMatchObject({ state: 'done', result: { queued: true, paths: [`${sealed.nonce}.0.png`, `${sealed.nonce}.1.png`] } });
    b.send({ t: 'rpc', rpc: sealed });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fm.uploads).toHaveLength(1);
    b.close();
    await fm.close();
  });

  it('refuses a malformed upload bad-shape before anything runs', async () => {
    const { fm, b, call } = await setUp();
    for (const args of [
      { attachments: [png()], delivery: 'queued-turn', text: 'look at this' },
      { attachments: [png()] },
      { attachments: [], delivery: 'queued-turn' },
      { attachments: [png(), png(), png(), png(), png()], delivery: 'queued-turn' },
      { attachments: [{ ...png(), mediaType: 'application/pdf' }], delivery: 'queued-turn' },
      { attachments: [{ ...png(), name: '../shot.png' }], delivery: 'queued-turn' },
      { attachments: [{ ...png(), data: '%%%' }], delivery: 'queued-turn' },
      { attachments: [{ ...png(), mediaType: 'image/tiff' }], delivery: 'queued-turn' },
    ]) {
      expect((await call('media', args)).outcome, JSON.stringify(args).slice(0, 120)).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    }
    expect(fm.uploads).toEqual([]);
    b.close();
    await fm.close();
  });

  it("refuses a stale session's upload and a read-only machine's before anything is saved", async () => {
    const stale = await setUp({ staleSessions: [loadRecording(TWO_SUBAGENTS).session] });
    expect((await stale.call('media', { attachments: [png()], delivery: 'queued-turn' })).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    expect(stale.fm.uploads).toEqual([]);
    stale.b.close();
    await stale.fm.close();
    const readOnly = await setUp({ readOnly: true });
    expect((await readOnly.call('media', { attachments: [png()], delivery: 'queued-turn' })).outcome).toMatchObject({ state: 'failed', error: { code: 'read-only' } });
    expect(readOnly.fm.uploads).toEqual([]);
    readOnly.b.close();
    await readOnly.fm.close();
  });

  it('as an MW4 producer, knows no media', async () => {
    const { fm, b, call } = await setUp({ producer: 'mw4' });
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk?.rpcs).not.toContain('media');
    expect(presences(b).at(-1)?.capabilities?.ops).not.toContain('media');
    expect((await call('media', { attachments: [png()], delivery: 'queued-turn' })).outcome).toEqual({ state: 'failed', error: { code: 'bad-shape', message: 'no RPC "media"' } });
    b.close();
    await fm.close();
  });
});
