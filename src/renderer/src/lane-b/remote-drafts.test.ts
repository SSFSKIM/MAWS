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
import { dropRemoteDraftSaves, REMOTE_DRAFT_RETRIES, REMOTE_DRAFT_RETRY_MS, REMOTE_DRAFT_WORDS, unsavedRemoteDraft } from './remote-drafts';
import { WITHHELD_ATTACHMENTS } from '@shared/sessions/draft-fit';
import { useNotices } from '../stores/notices';
import { useMachines } from '../stores/machines';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const NOT_OFFERED = { refusal: 'not-offered' };
const PAPER = { id: 'a1', name: 'paper.pdf' }; // an attachment a machine's read left there, as WITHHELD_ATTACHMENTS names it
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

beforeEach(() => {
  relaunch();
  useNotices.setState({ notices: [] });
  useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-07T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
});

describe('a machine that keeps each member’s draft', () => {
  // The machine's index: this member's own draft, which outlives the app's run, each save kept on top of the draft it
  // replaces and refused stale otherwise, as the spine keeps it (src/services/index/drafts.ts); a clear is kept as a draft
  // with no document at a stamp the machine mints (M6a's re-review, K1), and read so over the link.
  function machineKeeping() {
    let kept: Draft | null = null;
    let answered = 0;
    let clears = 0;
    const fake = fakeClient({ 'session.drafts.get': () => kept });
    const cleared = (): Draft => {
      clears += 1;
      return { doc: null, attachments: [], updatedAt: `2026-11-07T11:00:00.000Z#clear-${clears}` };
    };
    const land = (input: Saved) => (input.replaces === (kept?.updatedAt ?? null) ? ((kept = input.draft ?? cleared()), true) : false);
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

  // M6a's re-review (the enumerated draft path, test/lane-b/drafts-enumerated.test.ts): two saves both past main's
  // bound, the older landing late first, left the newer refused there with nothing to send it again
  it('sends the newest again a while after a save past main’s pending bound, when nothing newer is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); // the fake client's settling, on real time
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const machine = machineKeeping();
      const port = portOf(machine.fake);
      port.save(draft('older'));
      await flush();
      const landOlder = await machine.stall();
      await flush();
      port.save(draft('newer'));
      await flush();
      const landNewer = await machine.stall();
      await flush();
      expect([landOlder(), landNewer()]).toEqual([true, false]); // both late: the older lands, the newer is refused there
      expect(textOf(machine.kept())).toBe('older');
      await vi.advanceTimersByTimeAsync(REMOTE_DRAFT_RETRY_MS);
      await machine.take(); // the newest, on top of what is kept now
      expect(machine.saved().map((input) => [textOf(input.draft), input.replaces])).toEqual([['older', null], ['newer', null], ['newer', machine.saved()[0]!.draft!.updatedAt]]);
      expect(textOf(machine.kept())).toBe('newer');
      await vi.advanceTimersByTimeAsync(10 * REMOTE_DRAFT_RETRY_MS);
      expect(machine.saved()).toHaveLength(3); // taken: nothing more
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the newest again after a save past the bound only a few times, the draft kept for this run meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); // the fake client's settling, on real time
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const machine = machineKeeping();
      const port = portOf(machine.fake);
      port.save(draft('waiting'));
      await flush();
      await machine.stall();
      for (let retry = 0; retry < 10; retry += 1) {
        await vi.advanceTimersByTimeAsync(REMOTE_DRAFT_RETRY_MS);
        if (machine.fake.pending('session.drafts.set') > 0) await machine.stall();
      }
      expect(machine.saved()).toHaveLength(1 + REMOTE_DRAFT_RETRIES);
      expect(textOf(await portOf(machine.fake).load())).toBe('waiting');
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
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

  // M6a's re-review, K1: a clear (a send's, say) is kept there with a stamp of its own, which a save sent before it can't
  // name; this device's next save reads that stamp and goes once, on top of the clear
  it('loads no draft after a clear there, and saves the next one on top of that clear', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    port.save(draft('sent'));
    await flush();
    await machine.take();
    port.save(null);
    await flush();
    await machine.take();
    expect(machine.kept()).toMatchObject({ doc: null, updatedAt: expect.stringContaining('#clear-1') });
    const after = machine.saved().length;
    port.save(draft('next thought'));
    await flush();
    await machine.take();
    expect(machine.saved().slice(after).map((input) => [textOf(input.draft), input.replaces])).toEqual([['next thought', expect.stringContaining('#clear-1')]]);
    expect(textOf(machine.kept())).toBe('next thought');
    port.save(null);
    await flush();
    await machine.take();
    expect(await portOf(machine.fake).load()).toBeNull(); // read from the machine: the clear
    relaunch();
    expect(await portOf(machine.fake).load()).toBeNull();
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

  // M6a's branch review, F3: the composer keeps up to 4 MiB of attachments in a draft, base64 in its document, past what
  // one act carries; the text is kept there whatever they weigh, and what doesn't fit stays in this run, said once
  it('keeps the text there and a 3 MiB PDF in this run, saying so once', async () => {
    const machine = machineKeeping();
    const port = portOf(machine.fake);
    const pdf = { id: 'a1', kind: 'document', name: 'paper.pdf', mediaType: 'application/pdf', bytes: 3 * 1024 * 1024, data: 'A'.repeat(4 * 1024 * 1024), persisted: true };
    const withPdf = (text: string): Draft => { const d = draft(text); return { ...d, doc: { ...(d.doc as object), attrs: { attachments: [pdf] } } }; };
    const typed = withPdf('read this');
    expect(new TextEncoder().encode(JSON.stringify({ appSessionId: REMOTE, draft: typed })).length).toBeGreaterThan(4 * 1024 * 1024); // the case that was refused
    port.save(typed);
    await flush();
    const sent = machine.saved()[0]!.draft!;
    expect([textOf(sent), (sent.doc as { attrs: { attachments: unknown[] } }).attrs.attachments]).toEqual(['read this', []]);
    await machine.take();
    expect(textOf(machine.kept())).toBe('read this');
    expect(await portOf(machine.fake).load()).toEqual(typed); // this run: whole
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual([REMOTE_DRAFT_WORDS.keptHere(['paper.pdf'], 'mini')]);
    port.save(withPdf('read this, please'));
    await flush();
    await machine.take();
    expect(useNotices.getState().notices).toHaveLength(1); // said once for the same attachments
    relaunch();
    expect(textOf(await portOf(machine.fake).load())).toBe('read this, please'); // the text outlives the run
  });

  it('says which attachments a draft read from the machine left there', async () => {
    const fake = fakeClient();
    const load = portOf(fake).load();
    const kept = draft('read this');
    await fake.reply('session.drafts.get', { ...kept, doc: { ...(kept.doc as object), attrs: { attachments: [], [WITHHELD_ATTACHMENTS]: [PAPER] } } });
    const loaded = await load;
    expect([textOf(loaded), (loaded!.doc as { attrs: Record<string, unknown> }).attrs]).toEqual(['read this', { attachments: [] }]);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual([REMOTE_DRAFT_WORDS.leftThere(['paper.pdf'], 'mini')]);
  });

  // M6a's re-review, K2: an attachment a read left on the machine is no removal; each save after it names those left
  // there (which the machine keeps, src/services/index/register.ts), until a clear (a send's, say) takes them off
  // M6a's last pass, L1 (the reviewer's case): a PDF that fit the read whole, saved with text grown past the act's
  // bound, is left out by the save's own fitting; that is no removal either, so the save names it, and the machine keeps
  // the copy it holds (src/services/index/register.ts)
  it('names the attachments its own fitting leaves out of a save, as it does those a read left there', async () => {
    const fake = fakeClient();
    const port = portOf(fake);
    const pdf = { id: 'paper', kind: 'document', name: 'paper.pdf', mediaType: 'application/pdf', bytes: 3_000_000, data: 'A'.repeat(4_000_000), persisted: true };
    const withText = (text: string): Draft => { const d = draft(text); return { ...d, doc: { ...(d.doc as object), attrs: { attachments: [pdf] } } }; };
    const load = port.load();
    await fake.reply('session.drafts.get', withText('read this')); // fits one answer whole
    expect((await load)!.doc).toMatchObject({ attrs: { attachments: [pdf] } });
    port.save(withText('x'.repeat(200_000)));
    await flush();
    const sent = (fake.invoked('session.drafts.set') as Saved[])[0]!.draft!.doc as { attrs: Record<string, unknown> };
    expect([sent.attrs.attachments, sent.attrs[WITHHELD_ATTACHMENTS]]).toEqual([[], [{ id: 'paper', name: 'paper.pdf' }]]);
  });

  it('names in each save after it the attachments a read left there, until a clear', async () => {
    const fake = fakeClient();
    const port = portOf(fake);
    const load = port.load();
    const kept = draft('read this');
    await fake.reply('session.drafts.get', { ...kept, doc: { ...(kept.doc as object), attrs: { attachments: [], [WITHHELD_ATTACHMENTS]: [PAPER] } } });
    await load;
    const noteOf = (saved: Saved) => (saved.draft?.doc as { attrs?: Record<string, unknown> } | undefined)?.attrs?.[WITHHELD_ATTACHMENTS];
    const sent = () => fake.invoked('session.drafts.set') as Saved[];
    port.save(draft('read this, please'));
    await flush();
    expect([textOf(sent()[0]!.draft), noteOf(sent()[0]!), sent()[0]!.replaces]).toEqual(['read this, please', [PAPER], kept.updatedAt]);
    await fake.reply('session.drafts.set', undefined);
    await flush();
    port.save(draft('read this, please, now'));
    await flush();
    expect(noteOf(sent()[1]!)).toEqual([PAPER]);
    await fake.reply('session.drafts.set', undefined);
    await flush();
    port.save(null);
    await flush();
    await fake.reply('session.drafts.set', undefined);
    await flush();
    port.save(draft('fresh'));
    await flush();
    await fake.reply('session.drafts.get', { doc: null, attachments: [], updatedAt: 'cleared#1' }); // read after the clear
    await flush();
    expect([textOf(sent()[3]!.draft), noteOf(sent()[3]!)]).toEqual(['fresh', undefined]);
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

// UX wave U4a (decision 13; M3's review, finding 1): a take-back's save goes once, in the session's order with its
// ordinary saves: after those handed before it, before those handed after it, and never waiting on one handed after it
describe('a take-back’s save among the session’s ordinary saves', () => {
  const CLAIM = 'claim:no-document';
  const sent = (fake: FakeClient) => (fake.invoked('session.drafts.set') as Saved[]).map((input) => (input.replaces === CLAIM ? `claim ${textOf(input.draft)}` : textOf(input.draft)));
  const portThere = (fake: FakeClient) => rememberingRemoteDrafts(local(), REMOTE, () => true, fake.client);

  it('goes at once with nothing out, and an ordinary save handed in the same tick goes after it', async () => {
    const fake = fakeClient({ 'session.drafts.get': null });
    const port = portThere(fake);
    const claim = port.save(draft('staged'), CLAIM);
    port.save(draft('typed after'));
    await flush();
    expect(sent(fake)).toEqual(['claim staged']);
    await fake.reply('session.drafts.set', undefined);
    expect(await claim).toBe(true);
    await flush();
    expect(sent(fake)).toEqual(['claim staged', 'typed after']);
  });

  it('two queued take-back saves and an ordinary one handed in one tick go in the order handed', async () => {
    const fake = fakeClient({ 'session.drafts.get': null });
    const port = portThere(fake);
    const first = port.save(draft('first stage'), CLAIM);
    const second = port.save(draft('second stage'), CLAIM);
    port.save(draft('typed'));
    await flush();
    expect(sent(fake)).toEqual(['claim first stage']);
    await fake.reply('session.drafts.set', undefined);
    await flush();
    expect(sent(fake)).toEqual(['claim first stage', 'claim second stage']);
    await fake.fail('session.drafts.set', 'kept');
    await flush();
    expect(sent(fake)).toEqual(['claim first stage', 'claim second stage', 'typed']);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
  });

  it('waits for an ordinary save out, and goes before one handed after it', async () => {
    const fake = fakeClient({ 'session.drafts.get': null });
    const port = portThere(fake);
    port.save(draft('typed'));
    await flush();
    const claim = port.save(draft('staged'), CLAIM);
    port.save(draft('typed more'));
    await flush();
    expect(sent(fake)).toEqual(['typed']);
    await fake.reply('session.drafts.set', undefined);
    await flush();
    expect(sent(fake)).toEqual(['typed', 'claim staged']);
    await fake.reply('session.drafts.set', undefined);
    await flush();
    expect(await claim).toBe(true);
    expect(sent(fake)).toEqual(['typed', 'claim staged', 'typed more']);
  });

  it.each([
    ['refused (the machine offers no drafts)', async (fake: FakeClient) => fake.fail('session.drafts.set', 'refused', 'internal', NOT_OFFERED)],
    ['dropped (a newer save went to memory)', async (fake: FakeClient) => {
      dropRemoteDraftSaves(REMOTE);
      await fake.reply('session.drafts.set', undefined);
    }],
  ])('goes once the ordinary save before it ends %s', async (_name, end) => {
    const fake = fakeClient({ 'session.drafts.get': null });
    const port = portThere(fake);
    port.save(draft('typed'));
    await flush();
    const claim = port.save(draft('staged'), CLAIM);
    await flush();
    expect(sent(fake)).toEqual(['typed']);
    await end(fake);
    await flush();
    expect(sent(fake)).toEqual(['typed', 'claim staged']);
    await fake.reply('session.drafts.set', undefined);
    expect(await claim).toBe(true);
  });
});

// the branch panel's finding 2: a take-back's save that is taken supersedes this window's older save still pending, and
// its sending again, so the older one never lands over the message it put there
describe('a take-back’s save taken over an older save past main’s bound', () => {
  it('retires the older save and its retry: the settled message stays', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); // the fake client's settling, on real time
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fake = fakeClient({ 'session.drafts.get': null });
      const port = rememberingRemoteDrafts(local(), REMOTE, () => true, fake.client);
      port.save(null); // the emptied box
      await flush();
      await fake.fail('session.drafts.set', 'mini took the request but hasn’t confirmed it', 'timeout');
      await flush();
      const stage = draft('the message');
      const claim = port.save(stage, 'claim:no-document');
      await flush();
      await fake.reply('session.drafts.set', undefined);
      expect(await claim).toBe(true);
      const settled = draft('the message');
      const settle = port.save(settled, `settle:${stage.updatedAt}`);
      await flush();
      await fake.reply('session.drafts.set', undefined);
      expect(await settle).toBe(true);
      const sent = fake.invoked('session.drafts.set').length;
      await vi.advanceTimersByTimeAsync(2 * REMOTE_DRAFT_RETRY_MS);
      expect(fake.invoked('session.drafts.set')).toHaveLength(sent); // the older null is not sent again
      expect(unsavedRemoteDraft(REMOTE)).not.toBeNull(); // no older save stands for this session's draft
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a save handed after it: that one is newer', async () => {
    const fake = fakeClient({ 'session.drafts.get': null });
    const port = rememberingRemoteDrafts(local(), REMOTE, () => true, fake.client);
    port.save(draft('typed'));
    await flush();
    const claim = port.save(draft('staged'), 'claim:no-document');
    port.save(draft('typed after'));
    await flush();
    await fake.reply('session.drafts.set', undefined); // 'typed'
    await flush();
    await fake.reply('session.drafts.set', undefined); // the claim
    expect(await claim).toBe(true);
    await flush();
    expect((fake.invoked('session.drafts.set') as Saved[]).map((input) => textOf(input.draft))).toEqual(['typed', 'staged', 'typed after']);
  });
});
