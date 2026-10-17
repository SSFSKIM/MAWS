// P3-E1 M2 (the parent's Decision Log 11 (1); the execution document's ingress audit): the renderer's ways into a legacy
// design through A's host surface. Main's open preflight (`artifacts.get`) migrates it as the human, or refuses `invalid`
// naming why, so a window stops instead of reconnecting forever; the one document-port handler both host modes share
// migrates before it attaches, never attaches a port closed meanwhile, and closes the port of a design it cannot
// migrate; the live state main's exporters read (`artifacts.state`) is the model. Retained versions stay as they were.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { MessagePortMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_PATH } from '@artifacts/design/canvas';
import { readFiles } from '@artifacts/files';
import { PortProvider, type PortLike } from '@artifacts/provider/port';
import { slideOrder } from '@artifacts/slides/model';
import { applyV2, newDoc } from '@artifacts/yjs';
import { HostCommandError, type DocPortEnd, type DocPortHandler, type HostOn } from '@shared/host/runtime';
import { openDocuments, type Documents } from '../documents';
import { registerArtifacts } from '../documents/register';
import { registerDesigns, type Designs } from '.';
import { LEGACY_FILES, logRows, makeLegacyDesign } from './legacy.fixture';

let userData: string;
let documents: Documents;
let designs: Designs;
let surface: { close(): void };
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let docHandler: DocPortHandler;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-design-access-'));
});
afterEach(() => {
  surface.close();
  designs.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
});
function start(): void {
  documents = openDocuments(userData, () => {})!;
  designs = registerDesigns({ documents, chain: null, refresh: () => {} });
  handlers = new Map();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  surface = registerArtifacts(on, () => true, { onDocPort: (handler) => void (docHandler = handler) }, { documents, env: {} });
}
const call = (name: string, input: unknown) => handlers.get(name)!(input);
async function refusalOf(name: string, input: unknown): Promise<{ code: string; message: string; issues: { reason: string; data: Record<string, unknown> } }> {
  try {
    await call(name, input);
  } catch (error) {
    expect(error).toBeInstanceOf(HostCommandError);
    return (error as HostCommandError).ipcError as never;
  }
  throw new Error(`${name} was not refused`);
}
function asPortMain(port: MessagePort): MessagePortMain {
  return {
    postMessage: (message: unknown) => port.postMessage(message),
    on: (event: string, listener: (arg?: unknown) => void) => (event === 'message' ? port.on('message', (data) => listener({ data })) : port.on('close', () => listener())),
    start: () => port.start(),
    close: () => port.close(),
  } as unknown as MessagePortMain;
}
/** A port end whose remote side the test closes at will, synchronously. */
function fakeEnd(): DocPortEnd & { remoteClose(): void; closed: boolean } {
  const closeListeners: (() => void)[] = [];
  const end = {
    closed: false,
    postMessage: () => {},
    on: (event: 'message' | 'close', listener: never) => void (event === 'close' && closeListeners.push(listener)),
    start: () => {},
    close: () => void (end.closed = true),
    remoteClose: () => closeListeners.forEach((listener) => listener()),
  };
  return end as never;
}
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};
const stateFiles = (id: string) => {
  const doc = newDoc();
  applyV2(doc, documents.service.readState(id).state);
  return { generic: readFiles(doc), boards: slideOrder(doc) };
};

describe('main’s open preflight (`artifacts.get`) on a legacy design', () => {
  it('migrates it as the human before answering the row', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    const answer = (await call('artifacts.get', { artifactId: id })) as { artifact: { kind: string; revision: number } };
    expect(answer.artifact).toMatchObject({ kind: 'design', revision: 2 });
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', 'human']);
    expect(stateFiles(id)).toEqual({ generic: {}, boards: ['phone', 'poster'] });
  });

  it('refuses `invalid` naming the migration problem when it cannot migrate, so the window stops rather than retries', async () => {
    const { id } = await makeLegacyDesign(userData, { files: { ...LEGACY_FILES, [CANVAS_PATH]: '{"v":' } });
    start();
    const refusal = await refusalOf('artifacts.get', { artifactId: id });
    expect(refusal.code).toBe('invalid_input');
    expect(refusal.issues.reason).toBe('invalid');
    expect(refusal.message).toMatch(/cannot be opened.*canvas\.json is not JSON/);
    expect(logRows(userData, id)).toHaveLength(1);
  });

  it('answers a deleted design’s row without migrating it', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    await documents.store.delete(id);
    const answer = (await call('artifacts.get', { artifactId: id, includeDeleted: true })) as { artifact: { deletedAt: number | null } };
    expect(answer.artifact.deletedAt).not.toBeNull();
    expect(logRows(userData, id)).toHaveLength(1);
  });
});

describe('the document port handler on a legacy design', () => {
  it('migrates before it attaches: a provider on the other end syncs the model', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    const { port1, port2 } = new MessageChannel();
    docHandler({ t: 'doc', channel: 1, artifactId: id, actor: { kind: 'human' } }, asPortMain(port1));
    const doc = newDoc();
    const provider = new PortProvider(doc);
    provider.connect(port2 as unknown as PortLike);
    await until(() => provider.state.synced);
    expect(slideOrder(doc)).toEqual(['phone', 'poster']);
    expect(readFiles(doc)).toEqual({});
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', 'human']);
    provider.destroy();
  });

  it('never attaches a port its remote end closed while the migration ran', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    const attach = vi.spyOn(documents.service, 'attach');
    const end = fakeEnd();
    docHandler({ t: 'doc', channel: 2, artifactId: id, actor: { kind: 'human' } }, end);
    end.remoteClose();
    await until(() => logRows(userData, id).length === 2); // the migration still lands, for the next open
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attach).not.toHaveBeenCalled();
  });

  it('closes the port of a design it cannot migrate, logging why, and attaches nothing', async () => {
    const { id } = await makeLegacyDesign(userData, { files: { ...LEGACY_FILES, [CANVAS_PATH]: 'nope' } });
    start();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attach = vi.spyOn(documents.service, 'attach');
    const end = fakeEnd();
    docHandler({ t: 'doc', channel: 3, artifactId: id, actor: { kind: 'human' } }, end);
    await until(() => end.closed);
    expect(attach).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/channel 3.*cannot be opened/));
    error.mockRestore();
  });

  it('attaches another kind’s port at once, as before', async () => {
    start();
    const notes = await documents.store.create({ kind: 'document', title: 'Notes' }, { kind: 'human' });
    const attach = vi.spyOn(documents.service, 'attach');
    const end = fakeEnd();
    docHandler({ t: 'doc', channel: 4, artifactId: notes.id, actor: { kind: 'human' } }, end);
    expect(attach).toHaveBeenCalledTimes(1);
  });
});

describe('the live state main’s exporters read (`artifacts.state`)', () => {
  it('is the migrated model, and a retained version stays the files it was', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    start();
    const live = (await call('artifacts.state', { artifactId: id })) as { bytes: Uint8Array };
    const doc = newDoc();
    applyV2(doc, live.bytes);
    expect(slideOrder(doc)).toEqual(['phone', 'poster']);
    const old = (await call('artifacts.versionState', { artifactId: id, versionId })) as { bytes: Uint8Array };
    const version = newDoc();
    applyV2(version, old.bytes);
    expect(readFiles(version)).toEqual(LEGACY_FILES);
  });
});
