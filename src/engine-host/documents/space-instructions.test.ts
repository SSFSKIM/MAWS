// UX wave U10b (docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M9 and §E.1): a Space's instructions are
// held in the store's `meta` table under one key, beside the entity and not in it, so no migration is taken and older
// builds keep a writable store. Two engine-host commands read and write them; a write announces `spaces.changed`
// `updated`; an empty text removes them; deleting a Space removes its text, and a text whose Space is gone (deleted under
// an older build, which never reads the key) is never answered and is dropped at the next write.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostCommandError, type HostEmit, type HostOn } from '@shared/host/runtime';
import { type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { openDocuments, type Documents } from '.';
import { registerArtifacts } from './register';

let dir: string;
let documents: Documents;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let emitted: { name: EventName; payload: unknown }[];
let surface: { close(): void };

const T0 = Date.UTC(2026, 10, 15, 12, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  dir = mkdtempSync(join(tmpdir(), 'maws-space-instructions-'));
  documents = openDocuments(dir, () => {})!;
  handlers = new Map();
  emitted = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    expect(validateEventPayload(name, payload).ok, name).toBe(true);
    emitted.push({ name, payload });
    return true;
  };
  surface = registerArtifacts(on, emit, { onDocPort: () => {} }, { documents, env: {} });
});
afterEach(() => {
  surface.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

// A call as the runtime makes it: the input validated first, the output checked against the registry after.
async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}
const instructions = async () => (await call('spaces.instructions', {})).instructions;
const spaceChanges = () => emitted.filter((e) => e.name === 'spaces.changed').map((e) => e.payload);
// What is durable, read through a connection of its own, as an older build opening the file would.
function durable<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}
const metaValue = () => durable((db) => (db.prepare("SELECT value FROM meta WHERE key = 'spaceInstructions'").get() as { value: string } | undefined)?.value ?? null);

describe('a Space’s instructions in the store (M9, §E.1)', () => {
  it('are written and read by their two commands, announced as the Space updated, and held in meta with no migration', async () => {
    const { space } = await call('spaces.create', { name: 'Field notes' });
    emitted.length = 0;
    await call('spaces.setInstructions', { spaceId: space.id, text: 'Write dates as 14 March.\nUse metres.' });
    expect(await instructions()).toEqual([{ spaceId: space.id, text: 'Write dates as 14 March.\nUse metres.', at: T0 }]);
    expect(documents.store.spaceInstructions(space.id)).toEqual({ text: 'Write dates as 14 March.\nUse metres.', at: T0 });
    expect(spaceChanges()).toEqual([{ spaceId: space.id, change: 'updated' }]);
    // the entity and its table are as before: the Space carries no new field, the store no new version
    expect((await call('spaces.list', undefined)).spaces).toEqual([space]);
    expect(durable((db) => db.prepare('PRAGMA user_version').get())).toEqual({ user_version: 4 });
    expect(durable((db) => (db.prepare('PRAGMA table_info(spaces)').all() as { name: string }[]).map((c) => c.name))).toEqual(['id', 'name', 'linkedDir', 'createdAt']);
    expect(JSON.parse(metaValue()!)).toEqual({ [space.id]: { text: 'Write dates as 14 March.\nUse metres.', at: T0 } });
    expect(await call('artifacts.status', undefined)).toEqual({ status: 'ok', reason: null });
  });

  it('refuses 8,001 characters at the command and takes 8,000', async () => {
    const { space } = await call('spaces.create', { name: 'Field notes' });
    expect(validateCommandInput('spaces.setInstructions', { spaceId: space.id, text: 'x'.repeat(8001) }).ok).toBe(false);
    await expect(call('spaces.setInstructions', { spaceId: space.id, text: 'x'.repeat(8001) })).rejects.toThrow(/invalid input/);
    expect(await instructions()).toEqual([]);
    await call('spaces.setInstructions', { spaceId: space.id, text: 'x'.repeat(8000) });
    expect((await instructions())[0]?.text).toHaveLength(8000);
  });

  it('removes a Space’s instructions when the text saved is empty, and announces it', async () => {
    const { space } = await call('spaces.create', { name: 'Field notes' });
    await call('spaces.setInstructions', { spaceId: space.id, text: 'Use metres.' });
    emitted.length = 0;
    await call('spaces.setInstructions', { spaceId: space.id, text: '' });
    expect(await instructions()).toEqual([]);
    expect(documents.store.spaceInstructions(space.id)).toBeNull();
    expect(spaceChanges()).toEqual([{ spaceId: space.id, change: 'updated' }]);
  });

  it('refuses a Space that does not exist, by the store’s notFound', async () => {
    const missing = '22222222-2222-4222-8222-222222222222';
    let refusal: unknown = null;
    try {
      await call('spaces.setInstructions', { spaceId: missing, text: 'Use metres.' });
    } catch (error) {
      refusal = (error as HostCommandError).ipcError;
    }
    expect(refusal).toMatchObject({ issues: { reason: 'notFound' } });
    expect(metaValue()).toBeNull();
  });

  it('stamps a changed text later than the one before even within one millisecond, and keeps the stamp of a text saved again unchanged', async () => {
    const { space } = await call('spaces.create', { name: 'Field notes' });
    await call('spaces.setInstructions', { spaceId: space.id, text: 'Use metres.' });
    await call('spaces.setInstructions', { spaceId: space.id, text: 'Use metres and Celsius.' });
    expect(documents.store.spaceInstructions(space.id)).toEqual({ text: 'Use metres and Celsius.', at: T0 + 1 });
    vi.setSystemTime(T0 + 60_000);
    await call('spaces.setInstructions', { spaceId: space.id, text: 'Use metres and Celsius.' });
    expect(documents.store.spaceInstructions(space.id)).toEqual({ text: 'Use metres and Celsius.', at: T0 + 1 });
  });

  it('keeps each Space’s text apart, and removes a Space’s text with the Space', async () => {
    const one = (await call('spaces.create', { name: 'Field notes' })).space;
    const two = (await call('spaces.create', { name: 'Grant writing' })).space;
    await call('spaces.setInstructions', { spaceId: one.id, text: 'Use metres.' });
    await call('spaces.setInstructions', { spaceId: two.id, text: 'Cite the call by its number.' });
    expect(documents.store.spaceInstructions(two.id)?.text).toBe('Cite the call by its number.');
    await call('spaces.delete', { spaceId: one.id });
    expect(await instructions()).toEqual([{ spaceId: two.id, text: 'Cite the call by its number.', at: T0 }]);
    expect(Object.keys(JSON.parse(metaValue()!) as object)).toEqual([two.id]);
  });

  it('never answers a text whose Space an older build deleted, and drops it at the next write', async () => {
    const kept = (await call('spaces.create', { name: 'Field notes' })).space;
    const gone = '33333333-3333-4333-8333-333333333333'; // deleted under a build that never reads the key
    documents.storage.setMeta('spaceInstructions', JSON.stringify({ [gone]: { text: 'Old rules.', at: T0 - 1 } }));
    expect(await instructions()).toEqual([]);
    expect(documents.store.spaceInstructions(gone)).toBeNull();
    await call('spaces.setInstructions', { spaceId: kept.id, text: 'Use metres.' });
    expect(JSON.parse(metaValue()!)).toEqual({ [kept.id]: { text: 'Use metres.', at: T0 } });
  });
});
