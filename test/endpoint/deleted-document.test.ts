// A deleted artifact takes no content over the machine link either (UX wave U10b, M4;
// docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.5, "the fence"): a `document` read open of the endpoint,
// its channel bridged to a real document service over a real store, so the host's refusal is what the device meets. An
// update the host admitted before a delete is a row of the person's (the agent's delete then refused, the Library's
// taking it into the deleted state); one that arrives after either delete is refused, its channel closed `host`, with no
// row and no acknowledgement; and a new open of the deleted artifact's document is closed the same way.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame } from '@artifacts/provider/frames';
import { applyV2, diffV1, newDoc, stateVector } from '@artifacts/yjs';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../../src/engine-host/documents';
import type { HostPort } from '../../src/engine-host/documents/ports';
import { fakeDocuments, fakeServices } from './fake-services';
import { makeOrg, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];
const opened: Documents[] = [];
beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const documents of opened.splice(0)) documents.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const AGENT = 'app-1' as AppSessionId;

/** The endpoint, its document channels attached to a real store's document service as `mawsd`'s socket attaches them. */
async function machine() {
  const dir = mkdtempSync(join(tmpdir(), 'maws-deleted-doc-'));
  dirs.push(dir);
  const documents = openDocuments(dir, () => {})!;
  opened.push(documents);
  const services = fakeServices();
  const docs = fakeDocuments(services);
  const channels = services.documents;
  const ends = new Map<number, { message: ((data: unknown) => void) | null; close: (() => void) | null }>();
  services.documents = {
    ...channels,
    open(message) {
      if (!channels.open(message)) return false;
      const end: { message: ((data: unknown) => void) | null; close: (() => void) | null } = { message: null, close: null };
      ends.set(message.channel, end);
      const port: HostPort = {
        send: (frame) => docs.send(message.channel, frame),
        close: () => docs.end(message.channel, 'host'),
        onMessage: (listener) => void (end.message = listener),
        onClose: (listener) => void (end.close = listener),
      };
      setImmediate(() => documents.service.attach(message.artifactId, port, message.actor)); // the host's socket, a turn later
      return true;
    },
    frame(channel, bytes) {
      if (!channels.frame(channel, bytes)) return false;
      ends.get(channel)?.message?.(bytes.slice());
      return true;
    },
    close(channel) {
      channels.close(channel);
      ends.get(channel)?.close?.();
    },
  };
  const f = await startEndpoint(org, started, { services });
  const { id } = await documents.store.create({ kind: 'document', title: 'Draft plan' }, { kind: 'session', appSessionId: AGENT });
  await documents.service.writeAs(id, { kind: 'session', appSessionId: AGENT }, (doc) => doc.get('root').insert(0, 'An agent wrote this.'));
  f.host.artifact(id); // the endpoint's read of it before the open
  const a = await openRemote(f, org.a1, org.A, { capabilities: ['rl2.read-open'] });
  return { f, documents, id, a, dir };
}

/** Frames as the stream carries them, each prefixed by its u32be length. */
const prefixed = (frame: Uint8Array) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(frame.byteLength);
  return Buffer.concat([length, Buffer.from(frame)]);
};
/** The whole frames the device read on a stream so far, decoded. */
function framesOf(r: Remote, id: string) {
  const bytes = Buffer.concat(r.inbox.filter((m) => (m as Msg).id === id && (m as Msg).t === 'streamData').map((m) => Buffer.from((m as Msg).data as string, 'base64url')));
  const frames: ReturnType<typeof decodeFrame>[] = [];
  for (let at = 0; at + 4 <= bytes.byteLength; ) {
    const length = bytes.readUInt32BE(at);
    if (at + 4 + length > bytes.byteLength) break;
    frames.push(decodeFrame(bytes.subarray(at + 4, at + 4 + length)));
    at += 4 + length;
  }
  return frames;
}
const closeOf = (r: Remote, id: string) => (r.inbox.find((m) => (m as Msg).id === id && (m as Msg).t === 'streamClose') as Msg | undefined)?.reason;

/** An `edit` open of the artifact's document, synced to the host's first frame; and a person's update to send on it. */
async function open(m: Awaited<ReturnType<typeof machine>>) {
  const id = randomBytes(16).toString('base64url');
  const from = m.a.inbox.length;
  await m.a.channel.send({ t: 'streamOpen', id, kind: 'document', credit: 1024 * 1024, document: { artifactId: m.id, mode: 'edit' } });
  expect(await waitFor(m.a, (x) => x.id === id && (x.t === 'streamOpened' || x.t === 'streamRefused'), 'the answer', from)).toMatchObject({ t: 'streamOpened' });
  await until(() => framesOf(m.a, id).some((frame) => frame.type === 'step1') || undefined, 'the host’s step 1');
  const doc = newDoc();
  applyV2(doc, m.documents.service.readState(m.id).state);
  const sv = stateVector(doc);
  doc.get('root').insert(0, 'Typed on another machine. ');
  let offset = 0;
  const send = async (frame: Uint8Array) => {
    const bytes = prefixed(frame);
    await m.a.channel.send({ t: 'streamData', id, offset, data: bytes.toString('base64url') });
    offset += bytes.byteLength;
  };
  return { id, type: () => send(encodeFrame({ type: 'update', update: diffV1(doc, sv) })) };
}
// The rows the store's file holds, read through a separate read-only connection, as the local tests read them.
const rows = (m: Awaited<ReturnType<typeof machine>>) => {
  const db = new DatabaseSync(join(m.dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return (db.prepare('SELECT actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(m.id) as { actor: string }[]).map((row) => row.actor);
  } finally {
    db.close();
  }
};
const agentDelete = (m: Awaited<ReturnType<typeof machine>>) =>
  m.documents.store.writeCommitted(() => m.documents.store.deleteOwnDraft(m.id, [AGENT])).then(
    () => 'deleted',
    (error: { data?: { why?: string } }) => error.data?.why ?? 'refused',
  );
const libraryDelete = (m: Awaited<ReturnType<typeof machine>>) => m.documents.store.writeCommitted(() => m.documents.store.delete(m.id)).then(() => 'deleted');

describe('a document over the link and a delete', () => {
  it('an update admitted before the agent’s delete is the person’s row, and the delete is refused', async () => {
    const m = await machine();
    const stream = await open(m);
    await stream.type();
    await until(() => framesOf(m.a, stream.id).some((frame) => frame.type === 'ack') || undefined, 'the ack');
    expect(rows(m).at(-1)).toBe('human');
    expect(await agentDelete(m)).toBe('edited');
    expect(m.documents.store.get(m.id)).not.toBeNull();
  });

  it('an update admitted before the Library’s delete is in the deleted state', async () => {
    const m = await machine();
    const stream = await open(m);
    await stream.type();
    await until(() => framesOf(m.a, stream.id).some((frame) => frame.type === 'ack') || undefined, 'the ack');
    expect(await libraryDelete(m)).toBe('deleted');
    const doc = newDoc();
    applyV2(doc, m.documents.service.readState(m.id).state);
    expect(doc.get('root').toString()).toBe('Typed on another machine. An agent wrote this.');
  });

  for (const by of ['agent', 'Library'] as const) {
    it(`an update after the ${by}’s delete is refused: the channel closed \`host\`, no row, no ack`, async () => {
      const m = await machine();
      const stream = await open(m);
      const before = rows(m);
      expect(await (by === 'agent' ? agentDelete(m) : libraryDelete(m))).toBe('deleted');
      await stream.type();
      await until(() => closeOf(m.a, stream.id), 'the stream’s close');
      expect(closeOf(m.a, stream.id)).toBe('host');
      expect(framesOf(m.a, stream.id).filter((frame) => frame.type === 'ack')).toEqual([]);
      expect(rows(m)).toEqual(before);
      expect(m.documents.service.stats.rejected.at(-1)?.reason).toBe('deleted: the artifact was deleted');
    });
  }

  it('a new open of the deleted artifact’s document is closed `host`', async () => {
    const m = await machine();
    expect(await agentDelete(m)).toBe('deleted');
    const id = randomBytes(16).toString('base64url');
    await m.a.channel.send({ t: 'streamOpen', id, kind: 'document', credit: 1024 * 1024, document: { artifactId: m.id, mode: 'edit' } });
    await until(() => closeOf(m.a, id) ?? (m.a.inbox.find((x) => (x as Msg).id === id && (x as Msg).t === 'streamRefused') ? 'refused' : undefined), 'the stream’s end');
    expect(framesOf(m.a, id)).toEqual([]);
  });
});
