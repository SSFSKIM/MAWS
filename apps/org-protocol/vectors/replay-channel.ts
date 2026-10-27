// RL2's vectors replayed (scenario-remote.ts writes them): each handshake's key schedule and transcripts recomputed,
// each end driven through `openChannel` or `acceptChannel` against the other end's recorded messages, and the frames
// sealed and opened again. Runtime-neutral, as the package is: the hub's workerd suite runs it too.
import { base64urlDecode, base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import {
  acceptChannel,
  ChannelError,
  deviceMacInput,
  deviceTranscript,
  handshakeMac,
  handshakeSecrets,
  importEphemeral,
  machineMacInput,
  machineTranscript,
  openChannel,
  sharedSecret,
  type ByteDuplex,
} from '../src/channel.ts';
import { FrameOpener, rekeyDirection, sealFrame, type DirectionKeys } from '../src/frames.ts';
import { importSigningKey, verifyInput, type Sig } from '../src/keys.ts';
import { memoryOrgView } from '../src/org-view.ts';
import type { SignedOrgState } from '../src/types.ts';
import type { ChannelVectors, HandshakeConnection, HandshakeRun, KeysVector } from './scenario-remote.ts';

const REPLAY_TIMEOUT_MS = 5_000;
const keysOf = (k: KeysVector): DirectionKeys => ({ key: base64urlDecode(k.key), iv: base64urlDecode(k.iv) });
const json = (text: string) => JSON.parse(text) as Record<string, unknown>;
const bare = (m: Record<string, unknown>) => {
  const out = { ...m };
  delete out.sig;
  delete out.mac;
  return out;
};
const withoutSig = (m: Record<string, unknown>) => {
  const out = { ...m };
  delete out.sig;
  return out;
};

/**
 * One end of a connection, scripted: the other end's messages fed in turn (the device's end receives each after one
 * more of its own, the endpoint's before each of its own), and what this end sends kept.
 */
function scripted(side: 'device' | 'endpoint', inbound: Uint8Array[]): { io: ByteDuplex; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  let listener: ((bytes: Uint8Array) => void) | null = null;
  let fed = 0;
  let closed = false;
  const feed = () => {
    const allowed = side === 'device' ? sent.length : sent.length + 1;
    while (listener !== null && !closed && fed < inbound.length && fed < allowed) {
      const bytes = inbound[fed++];
      const deliver = listener;
      setTimeout(() => !closed && deliver(bytes), 0);
    }
  };
  return {
    sent,
    io: {
      send: (bytes) => {
        if (closed) return;
        sent.push(Uint8Array.from(bytes));
        feed();
      },
      onBytes: (l) => {
        listener = l;
        feed();
      },
      close: () => {
        closed = true;
      },
    },
  };
}

/** The bytes match, but for each handshake message's `sig`, which ECDSA makes anew. */
function sameMessage(got: Uint8Array, expected: string): boolean {
  const want = base64urlDecode(expected);
  if (got[0] !== 0x7b || want[0] !== 0x7b) return base64urlEncode(got) === expected;
  const decode = (b: Uint8Array) => new TextDecoder().decode(Uint8Array.from(b));
  try {
    return canonicalize(withoutSig(json(decode(got)))) === canonicalize(withoutSig(json(decode(want))));
  } catch {
    return false;
  }
}

async function runConnection(run: HandshakeRun, view: ReturnType<typeof memoryOrgView>, c: HandshakeConnection): Promise<string[]> {
  const { io, sent } = scripted(run.side, c.inbound.map(base64urlDecode));
  const key = await importSigningKey(run.key);
  const options = { now: () => new Date(run.now), timeoutMs: REPLAY_TIMEOUT_MS, pageBytes: run.pageBytes, ephemeral: await importEphemeral(c.ephemeral), nonce: c.nonce };
  let got: HandshakeConnection['expect'];
  try {
    if ('ref' in run.identity) {
      const { channel } = await acceptChannel(io, { ref: run.identity.ref, key, build: run.build, capabilities: run.capabilities }, view, options);
      got = { ok: true, channelId: channel.id };
    } else {
      const { org, member, device, clientClass, machine } = run.identity;
      const channel = await openChannel(io, { org, member, device, clientClass, channelKey: key, build: run.build, capabilities: run.capabilities }, view, { ...options, machine });
      got = { ok: true, channelId: channel.id };
    }
  } catch (error) {
    const failure = error instanceof ChannelError ? error : new ChannelError(String(error));
    got = failure.stateVersion === undefined ? { ok: false, reason: failure.reason } : { ok: false, reason: failure.reason, stateVersion: failure.stateVersion };
  }
  const failures: string[] = [];
  if (JSON.stringify(got) !== JSON.stringify(c.expect)) failures.push(`expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  if (sent.length !== c.outbound.length || !sent.every((b, i) => sameMessage(b, c.outbound[i]))) failures.push(`sent ${sent.length} messages unlike the ${c.outbound.length} recorded`);
  return failures;
}

export async function replayChannel(v: ChannelVectors, fixtures: Record<string, unknown>): Promise<string[]> {
  const failures: string[] = [];
  for (const t of v.transcripts) {
    const [h1, h2, h3] = [t.h1, t.h2, t.h3].map(json);
    const fail = (what: string) => failures.push(`transcript ${t.name}: ${what}`);
    if ([h1, h2, h3].some((m, i) => canonicalize(m) !== [t.h1, t.h2, t.h3][i])) fail('a message is not canonical JSON');
    const s = await handshakeSecrets(await sharedSecret(await importEphemeral(t.deviceEphemeral), h2.e as string), h1, bare(h2));
    const b = base64urlEncode;
    if (b(s.salt) !== t.salt || b(s.kmR) !== t.kmR || b(s.kmI) !== t.kmI || s.channelId !== t.channelId) fail('the key schedule');
    if (b(s.i2r.key) !== t.i2r.key || b(s.i2r.iv) !== t.i2r.iv || b(s.r2i.key) !== t.r2i.key || b(s.r2i.iv) !== t.r2i.iv) fail("the directions' keys");
    const decode = (bytes: Uint8Array<ArrayBuffer>) => new TextDecoder().decode(bytes);
    const machineInput = machineTranscript(h1, bare(h2));
    const deviceInput = deviceTranscript(h1, bare(h2), bare(h3));
    if (decode(machineInput) !== t.machineTranscript || decode(deviceInput) !== t.deviceTranscript) fail('the signed transcripts');
    const machineMac = machineMacInput(h1.machine as string, h2.keyId as string);
    const deviceMac = deviceMacInput(h1.member as string, h1.device as string);
    if (decode(machineMac) !== t.machineMacInput || decode(deviceMac) !== t.deviceMacInput) fail("the MACs' inputs");
    if ((await handshakeMac(s.kmR, machineMac)) !== h2.mac || (await handshakeMac(s.kmI, deviceMac)) !== h3.mac) fail('the MACs');
    if (!(await verifyInput(machineInput, h2.sig as Sig, t.machinePub)) || !(await verifyInput(deviceInput, h3.sig as Sig, t.devicePub))) fail('the signatures');
  }
  for (const run of v.runs) {
    const view = memoryOrgView({ chain: run.chain.map((name) => fixtures[name] as SignedOrgState) });
    for (const [i, c] of run.connections.entries()) for (const f of await runConnection(run, view, c)) failures.push(`handshake ${run.name}, connection ${i + 1}: ${f}`);
    if (view.head().state.version !== run.headAfter) failures.push(`handshake ${run.name}: head ${view.head().state.version}, expected ${run.headAfter}`);
  }
  for (const f of v.frames) {
    if (base64urlEncode(await sealFrame(keysOf(f.keys), f.epoch, f.seq, base64urlDecode(f.plaintext))) !== f.frame) failures.push(`frame ${f.name}`);
  }
  for (const r of v.rekeys) {
    const next = await rekeyDirection(keysOf(r.keys));
    if (base64urlEncode(next.key) !== r.next.key || base64urlEncode(next.iv) !== r.next.iv) failures.push('rekey');
  }
  for (const r of v.receives) {
    const opener = new FrameOpener(keysOf(r.keys), r.start);
    let opened = 0;
    let reason: string | undefined;
    for (const frame of r.frames) {
      const result = await opener.open(base64urlDecode(frame));
      if (!result.ok) {
        reason = result.reason;
        break;
      }
      opened++;
    }
    if (opened !== r.expect.opened || reason !== r.expect.reason) failures.push(`receive ${r.name}: opened ${opened} (${reason}), expected ${JSON.stringify(r.expect)}`);
  }
  return failures;
}
