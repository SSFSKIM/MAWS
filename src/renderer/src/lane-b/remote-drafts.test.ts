// A lane B session's draft on its machine (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §P; the architect's ruling 2 on `session.reader.update`; Task 2's item 6): where the machine keeps each
// member's draft it is saved there, one save of a session after another, and loads back after a relaunch; where it
// doesn't (`not-offered`), this run's memory keeps it exactly as before (`rememberingRemoteDrafts`).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Draft } from '@shared/ipc/schema/session';
import { addressOf } from '@shared/machine/address';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { docOf, paragraph, textNode } from '../composer/editor/doc';
import { rememberingRemoteDrafts, rememberRemoteDraft, resetRemoteDrafts } from '../composer/editor/drafts';
import { readerRowsOf, resetReaderRows } from './reader-rows';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const NOT_OFFERED = { refusal: 'not-offered' };
const draft = (text: string): Draft => ({ doc: docOf([paragraph(textNode(text))]), attachments: [], updatedAt: '2026-11-07T10:00:00.000Z' });
const textOf = (d: Draft | null | undefined) => (d === null || d === undefined ? null : JSON.stringify(d.doc).match(/"text":"([^"]*)"/)?.[1]);
const local = () => ({ load: vi.fn(async (): Promise<Draft | null> => null), save: vi.fn() });
const portOf = (fake: FakeClient) => rememberingRemoteDrafts(local(), REMOTE, () => true, fake.client);
const relaunch = () => {
  resetRemoteDrafts();
  resetReaderRows();
};

beforeEach(() => relaunch());

describe('a machine that keeps each member’s draft', () => {
  // The machine's index: this member's own draft, which outlives the app's run.
  function machineKeeping() {
    let kept: Draft | null = null;
    const fake = fakeClient({ 'session.drafts.get': () => kept });
    return { fake, kept: () => kept, take: async () => {
      kept = (fake.invoked('session.drafts.set').at(-1) as { draft: Draft | null }).draft;
      await fake.reply('session.drafts.set', undefined);
    } };
  }

  it('saves it there, and a relaunch loads it back from there', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('half a thought'));
    expect(machine.fake.invoked('session.drafts.set')).toEqual([{ appSessionId: REMOTE, draft: draft('half a thought') }]);
    await machine.take();
    expect(readerRowsOf(REMOTE)).toBe('kept');
    relaunch();
    expect(textOf(await portOf(machine.fake).load())).toBe('half a thought');
    expect(machine.fake.invoked('session.drafts.get')).toEqual([{ appSessionId: REMOTE }]);
  });

  it('sends one session’s saves one after another, the newest of those waiting, and loads what was typed meanwhile', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('one'));
    port.save(draft('one two'));
    port.save(draft('one two three'));
    expect(machine.fake.pending('session.drafts.set')).toBe(1); // the next waits for the machine's answer
    expect(textOf(await portOf(machine.fake).load())).toBe('one two three'); // a remount while they go
    expect(machine.fake.invoked('session.drafts.get')).toEqual([]);
    await machine.take();
    expect(machine.fake.invoked('session.drafts.set').map((input) => textOf((input as { draft: Draft }).draft))).toEqual(['one', 'one two three']);
    await machine.take();
    expect(textOf(machine.kept())).toBe('one two three');
    expect(machine.fake.pending('session.drafts.set')).toBe(0);
    expect(textOf(await portOf(machine.fake).load())).toBe('one two three'); // read from the machine again
    expect(machine.fake.invoked('session.drafts.get')).toHaveLength(1);
  });

  it('keeps a save the machine couldn’t take for this run’s loads, until a later one is taken', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('not lost'));
    await machine.fake.fail('session.drafts.set', 'Not sent: mini is offline', 'host_unavailable');
    expect(warn).toHaveBeenCalledOnce();
    expect(readerRowsOf(REMOTE)).toBeNull();
    expect(textOf(await portOf(machine.fake).load())).toBe('not lost');
    expect(machine.fake.invoked('session.drafts.get')).toEqual([]);
    port.save(draft('not lost, and more'));
    await machine.take();
    expect(textOf(await portOf(machine.fake).load())).toBe('not lost, and more');
    expect(machine.fake.invoked('session.drafts.get')).toHaveLength(1);
    warn.mockRestore();
  });

  it('loads first the document a spawn handed the session, which its first save replaces there', async () => {
    const machine = machineKeeping();
    rememberRemoteDraft(REMOTE, docOf([paragraph(textNode('handed'))]));
    expect(textOf(await portOf(machine.fake).load())).toBe('handed');
    expect(machine.fake.invoked('session.drafts.get')).toEqual([]);
    portOf(machine.fake).save(draft('handed, edited'));
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
    await fake.fail('session.drafts.set', 'refused', 'internal', NOT_OFFERED);
    expect(readerRowsOf(REMOTE)).toBe('refused');
    expect(textOf(await port.load())).toBe('first, then'); // the newest, which never went
    port.save(draft('more'));
    expect(textOf(await portOf(fake).load())).toBe('more');
    expect(fake.invoked('session.drafts.set')).toHaveLength(1);
    expect(fake.invoked('session.drafts.get')).toEqual([]);
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
