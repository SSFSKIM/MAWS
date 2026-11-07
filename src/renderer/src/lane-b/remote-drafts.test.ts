// A lane B session's draft on its machine (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §P; the architect's ruling 2 on `session.reader.update`; Task 2's item 6): where the machine keeps each
// member's draft it is saved there, one save of a session after another, each on top of the draft it replaces (M6a's
// branch review, F1), and loads back after a relaunch; where it doesn't (`not-offered`), this run's memory keeps it
// exactly as before (`rememberingRemoteDrafts`).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { addressOf } from '@shared/machine/address';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { docOf, paragraph, textNode } from '../composer/editor/doc';
import { rememberingRemoteDrafts, rememberRemoteDraft, resetRemoteDrafts } from '../composer/editor/drafts';
import { readerRowsOf, resetReaderRows } from './reader-rows';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const NOT_OFFERED = { refusal: 'not-offered' };
let written = 0; // each draft its own `updatedAt`, as the composer stamps each write
const draft = (text: string): Draft => {
  written += 1;
  return { doc: docOf([paragraph(textNode(text))]), attachments: [], updatedAt: new Date(Date.UTC(2026, 10, 7, 10, 0, 0, written)).toISOString() };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
type Saved = { appSessionId: AppSessionId; draft: Draft | null; replaces: string | null };
const textOf = (d: Draft | null | undefined) => (d === null || d === undefined ? null : JSON.stringify(d.doc).match(/"text":"([^"]*)"/)?.[1]);
const local = () => ({ load: vi.fn(async (): Promise<Draft | null> => null), save: vi.fn() });
const portOf = (fake: FakeClient) => rememberingRemoteDrafts(local(), REMOTE, () => true, fake.client);
const relaunch = () => {
  resetRemoteDrafts();
  resetReaderRows();
};

beforeEach(() => relaunch());

describe('a machine that keeps each member’s draft', () => {
  // The machine's index: this member's own draft, which outlives the app's run, each save kept on top of the draft it
  // replaces and refused stale otherwise, as the spine keeps it (src/services/index/drafts.ts).
  function machineKeeping() {
    let kept: Draft | null = null;
    let answered = 0;
    const fake = fakeClient({ 'session.drafts.get': () => kept });
    const land = (input: Saved) => (input.replaces === (kept?.updatedAt ?? null) ? ((kept = input.draft), true) : false);
    const saved = () => fake.invoked('session.drafts.set') as Saved[];
    return {
      fake,
      saved,
      kept: () => kept,
      /** The oldest save out lands, or is refused stale. */
      take: async () => {
        const input = saved()[answered]!;
        answered += 1;
        if (land(input)) await fake.reply('session.drafts.set', undefined);
        else await fake.fail('session.drafts.set', STALE_DRAFT_WORDS);
        await flush();
      },
      /** The oldest save out never reaches the machine. */
      lose: async () => {
        answered += 1;
        await fake.fail('session.drafts.set', 'Not sent: mini is offline', 'host_unavailable');
      },
      /** The oldest save out is answered `timeout` at main's pending bound (`pendingResult`); it lands when told. */
      stall: async () => {
        const input = saved()[answered]!;
        answered += 1;
        await fake.fail('session.drafts.set', 'mini took the request but hasn’t confirmed it', 'timeout');
        return () => land(input);
      },
    };
  }

  it('saves it there, and a relaunch loads it back from there', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    const typed = draft('half a thought');
    port.save(typed);
    await flush();
    expect(machine.saved()).toEqual([{ appSessionId: REMOTE, draft: typed, replaces: null }]); // nothing kept there yet
    await machine.take();
    expect(readerRowsOf(REMOTE)).toBe('kept');
    relaunch();
    expect(textOf(await portOf(machine.fake).load())).toBe('half a thought');
  });

  it('sends one session’s saves one after another, the newest of those waiting, and loads what was typed meanwhile', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('one'));
    port.save(draft('one two'));
    port.save(draft('one two three'));
    await flush();
    expect(machine.fake.pending('session.drafts.set')).toBe(1); // the next waits for the machine's answer
    const reads = machine.fake.invoked('session.drafts.get').length;
    expect(textOf(await portOf(machine.fake).load())).toBe('one two three'); // a remount while they go
    expect(machine.fake.invoked('session.drafts.get')).toHaveLength(reads);
    await machine.take();
    expect(machine.saved().map((input) => [textOf(input.draft), input.replaces])).toEqual([['one', null], ['one two three', machine.saved()[0]!.draft!.updatedAt]]);
    await machine.take();
    expect(textOf(machine.kept())).toBe('one two three');
    expect(machine.fake.pending('session.drafts.set')).toBe(0);
    expect(textOf(await portOf(machine.fake).load())).toBe('one two three'); // read from the machine again
    expect(machine.fake.invoked('session.drafts.get')).toHaveLength(reads + 1);
  });

  // M6a's branch review, F1: main answers a draft act still out at its pending bound `timeout` (remote.ts `settle`,
  // remote-outcomes.ts `pendingResult`), and only logs its late outcome, so the renderer never hears it land
  it('keeps the newer text when a save past main’s pending bound lands after it', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('older'));
    await flush();
    port.save(draft('newer'));
    const landOlder = await machine.stall();
    await flush();
    expect(machine.saved().map((input) => [textOf(input.draft), input.replaces])).toEqual([['older', null], ['newer', null]]); // what is kept read again: none yet
    await machine.take();
    expect(textOf(machine.kept())).toBe('newer');
    expect(landOlder()).toBe(false); // the older one, late: refused there
    expect(textOf(machine.kept())).toBe('newer');
  });

  it('sends a newer save again on top of a late one that landed first', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('older'));
    await flush();
    port.save(draft('newer'));
    const landOlder = await machine.stall();
    await flush(); // the newer one is out, on top of none
    expect(landOlder()).toBe(true); // the older one lands first
    await machine.take(); // so the newer is refused stale, and goes again on top of the older
    expect(machine.saved().map((input) => [textOf(input.draft), input.replaces])).toEqual([['older', null], ['newer', null], ['newer', machine.saved()[0]!.draft!.updatedAt]]);
    await machine.take();
    expect(textOf(machine.kept())).toBe('newer');
    expect(textOf(await portOf(machine.fake).load())).toBe('newer');
    warn.mockRestore();
  });

  it('keeps a save the machine couldn’t take for this run’s loads, until a later one is taken', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('not lost'));
    await flush();
    await machine.lose();
    expect(warn).toHaveBeenCalledOnce();
    expect(readerRowsOf(REMOTE)).toBe('kept'); // its read before the save was answered
    const reads = machine.fake.invoked('session.drafts.get').length;
    expect(textOf(await portOf(machine.fake).load())).toBe('not lost');
    expect(machine.fake.invoked('session.drafts.get')).toHaveLength(reads);
    port.save(draft('not lost, and more'));
    await flush();
    await machine.take();
    expect(textOf(machine.kept())).toBe('not lost, and more');
    expect(textOf(await portOf(machine.fake).load())).toBe('not lost, and more');
    warn.mockRestore();
  });

  it('loads first the document a spawn handed the session, which its first save replaces there', async () => {
    const machine = machineKeeping();
    rememberRemoteDraft(REMOTE, docOf([paragraph(textNode('handed'))]));
    expect(textOf(await portOf(machine.fake).load())).toBe('handed');
    expect(machine.fake.invoked('session.drafts.get')).toEqual([]);
    portOf(machine.fake).save(draft('handed, edited'));
    await flush();
    await machine.take();
    expect(textOf(await portOf(machine.fake).load())).toBe('handed, edited');
  });
});

describe('a machine older than M6a, which offers no drafts', () => {
  // Task 3's review, H1: another session's refusal teaches the machine's before this session's own save hears its own; a
  // save made after that goes to memory, and the queue's late refusal must not put an older draft over it
  it.each([['new text'], [null]])('keeps the newest save, %s, over a refusal heard late by a save before it', async (newest) => {
    const fake = fakeClient();
    const port = portOf(fake);
    const other = rememberingRemoteDrafts(local(), addressOf(OTHER_MACHINE, 'app-s' as AppSessionId), () => true, fake.client);
    const loaded = port.load(); // the composer's load at its mount: nothing kept there
    await fake.reply('session.drafts.get', null);
    await loaded;
    port.save(draft('first'));
    port.save(draft('second')); // waiting behind the first
    const otherLoad = other.load();
    await fake.fail('session.drafts.get', 'refused', 'internal', NOT_OFFERED);
    await otherLoad;
    expect(readerRowsOf(REMOTE)).toBe('refused');
    expect(textOf(await port.load())).toBe('second'); // the newest handed to save, still unsaved
    const last = newest === null ? null : draft(newest);
    port.save(last); // into memory: the machine is known to refuse
    expect(await port.load()).toEqual(last);
    await fake.fail('session.drafts.set', 'refused', 'internal', NOT_OFFERED); // the first save's own refusal, late
    expect(await port.load()).toEqual(last);
    expect(fake.invoked('session.drafts.set')).toHaveLength(1);
  });

  it('keeps the draft in this run’s memory as before, asking nothing more once it refused, and forgets it at a relaunch', async () => {
    const fake = fakeClient();
    const port = portOf(fake);
    port.save(draft('first'));
    port.save(draft('first, then'));
    await fake.fail('session.drafts.get', 'refused', 'internal', NOT_OFFERED); // what is kept there, read before the first save
    expect(readerRowsOf(REMOTE)).toBe('refused');
    expect(textOf(await port.load())).toBe('first, then'); // the newest, which never went
    port.save(draft('more'));
    expect(textOf(await portOf(fake).load())).toBe('more');
    expect(fake.invoked('session.drafts.set')).toEqual([]);
    expect(fake.invoked('session.drafts.get')).toHaveLength(1);
    relaunch();
    const load = portOf(fake).load();
    await fake.fail('session.drafts.get', 'refused', 'internal', NOT_OFFERED);
    expect(await load).toBeNull();
  });

  it('takes a refused load as the machine’s answer: the saves after it stay in memory', async () => {
    const fake = fakeClient();
    const port = portOf(fake);
    const load = port.load();
    await fake.fail('session.drafts.get', 'refused', 'internal', NOT_OFFERED);
    expect(await load).toBeNull();
    port.save(draft('kept here'));
    expect(fake.invoked('session.drafts.set')).toEqual([]);
    expect(textOf(await port.load())).toBe('kept here');
  });

  it('leaves this Mac’s sessions to their own port', async () => {
    const fake = fakeClient();
    const own = local();
    const port = rememberingRemoteDrafts(own, REMOTE, () => false, fake.client);
    port.save(draft('here'));
    await port.load();
    expect(own.save).toHaveBeenCalledOnce();
    expect(own.load).toHaveBeenCalledOnce();
    expect(fake.calls).toEqual([]);
  });
});
