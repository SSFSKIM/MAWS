// Every order of a lane B session's draft events, up to a bound, through the renderer's queue (src/renderer/src/lane-b/
// remote-drafts.ts, driven as `rememberingRemoteDrafts` drives it for a machine that keeps drafts) and the machine's real
// index (`DraftStore` behind `session.drafts.*`'s handlers), so the draft path's interleavings are checked together
// rather than found one review at a time (P5 O8 M6a, the architect's ask in M6a's re-review). Each run starts as a
// composer opens on a remote session, whose kept draft is either none or one holding two attachments: one past one
// answer's bound (a fitted read leaves it on the machine) and one that fits a read whole but not a save whose text has
// grown (M6a's last pass, L1). Then it plays its events, the composer saving what it holds (the attachments its last load
// gave it); then lets every act land (those out on time, then the late ones, then whatever the queue sends again once its
// retry is due), until nothing is out. Two invariants:
//   (i) the machine ends on the newest draft the person produced (the newest edit's text, or none after a clear);
//   (ii) both kept attachments are still there unless a clear was among the events (the only removal of one a device
//   didn't take off itself, ../../src/shared/sessions/draft-fit.ts).
//
// The alphabet: `edit` (the person types; the composer saves), `grow` (an edit whose text takes the draft past one act's
// bound), `clear` (a send, or Clear: the composer saves none), `read` (the composer opens again: a fitted read, or what
// this run holds unsaved), `deliver` (the oldest save out is answered as the machine took it, or refused stale),
// `timeout` (main answers the oldest save out `timeout` at its pending bound while the act goes on, remote.ts `settle`),
// and `late` (the oldest of those lands). An event with nothing to act on (a `deliver` or `timeout` with no save out, a
// `late` with none timed out) is skipped as the shorter order it equals.
// The bound: every order of up to five events over the seven (19,608 orders, of which 5,094 have something to act on at
// each event), for an owner and a member reader, from each start (from none, without `grow`: with no attachment it is an
// `edit`, so 1,650 runs). The link's bound is made small here (2 KiB), so the attachments are small and the runs fast;
// the fitting itself is the production code. The drain answers every act out, so the runs say what holds once the link
// answers again, not while it never does.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Reader } from '@shared/ipc/client';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { addressOf, bareOf } from '@shared/machine/address';
import { fakeBus, type FakeBus } from '../support/fake-bus';
import { summary } from '../support/index-fixture';
import { OTHER_MACHINE } from '../support/machine';
import { Index } from '../../src/services/index/index';
import { registerIndexHandlers } from '../../src/services/index/register';
import { resetReaderRows } from '../../src/renderer/src/lane-b/reader-rows';
import { loadRemoteDraft, resetRemoteDraftSaves, saveRemoteDraft } from '../../src/renderer/src/lane-b/remote-drafts';
import { useNotices } from '../../src/renderer/src/stores/notices';

vi.mock('@shared/ipc/schema/remote', async (original) => ({ ...(await original<object>()), REMOTE_INLINE_MAX_BYTES: 2048 }));

const EVENTS = ['edit', 'grow', 'clear', 'read', 'deliver', 'timeout', 'late'] as const;
type Event = (typeof EVENTS)[number];
const MAX_EVENTS = 5;
const MEMBER = 'b'.repeat(32);
/** Past one answer's bound: a read leaves it on the machine. */
const PDF = { id: 'kept-1', kind: 'document', name: 'paper.pdf', mediaType: 'application/pdf', bytes: 3000, data: 'A'.repeat(4000), persisted: true };
/** Fits a read whole, and a save, but not one with a grown text. */
const NOTE = { id: 'kept-2', kind: 'file', name: 'note.txt', mediaType: 'text/plain', bytes: 450, data: 'B'.repeat(600), persisted: true };
const GROWN = 'x'.repeat(1500);

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const textOf = (draft: Draft | null | undefined): string | null => {
  const doc = draft?.doc as { content?: Array<{ content?: Array<{ text?: string }> }> } | null | undefined;
  return doc?.content?.[0]?.content?.[0]?.text ?? null;
};
const attachmentsOf = (draft: Draft | null): Array<{ id: string }> => (draft?.doc as { attrs?: { attachments?: Array<{ id: string }> } } | null)?.attrs?.attachments ?? [];
const attachmentIds = (draft: Draft | null): string[] => attachmentsOf(draft).map((a) => a.id);
const draftOf = (text: string, at: number, attachments: unknown[] = []): Draft => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }], attrs: { attachments } },
  attachments: [],
  updatedAt: new Date(Date.UTC(2026, 10, 7, 10, 0, 0, at)).toISOString(),
});

/** The machine: its index's handlers behind a link that holds each draft act until told to answer, time out, or land. */
function machine(bus: FakeBus, reader: Reader) {
  type Act = { input: unknown; answer(result: CommandResult<CommandName>): void };
  const out: Act[] = [];
  const late: Act[] = [];
  const context = { client: { id: 'endpoint:1' }, remote: true, reader } as never;
  const lowered = (input: { appSessionId: string }) => ({ ...input, appSessionId: bareOf(input.appSessionId as AppSessionId) });
  const run = (input: unknown) => bus.invoke('session.drafts.set', lowered(input as { appSessionId: string }), context) as Promise<CommandResult<CommandName>>;
  const client = {
    localMachine: 'this-mac',
    invoke: (name: CommandName, input: { appSessionId: string }) => {
      if (name === 'session.drafts.get') return bus.invoke(name, lowered(input), context);
      if (name === 'session.drafts.set') return new Promise<CommandResult<CommandName>>((answer) => out.push({ input, answer }));
      throw new Error(`the run asked ${name}`);
    },
    on: () => () => {},
  } as unknown as MawsBridge;
  return {
    client,
    out: () => out.length,
    late: () => late.length,
    deliver: async () => {
      const act = out.shift()!;
      act.answer(await run(act.input));
    },
    timeout: () => {
      const act = out.shift()!;
      late.push(act);
      act.answer({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
    },
    land: async () => void (await run(late.shift()!.input)),
  };
}

let dir: string;
let index: Index;
let bus: FakeBus;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drafts-enumerated-'));
  index = new Index(join(dir, 'index.sqlite'));
  bus = fakeBus();
  registerIndexHandlers(index, bus);
});
afterEach(() => {
  index.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers(); // the queue's retry, run at the drain
});
afterEach(() => vi.useRealTimers());

/** One order's run: the violations it ends with, or none; null when an event in it had nothing to act on. */
async function play(events: readonly Event[], reader: Reader, start: 'kept' | 'none'): Promise<string[] | null> {
  if (start === 'none' && events.includes('grow')) return null; // with no attachment, `grow` is an `edit`
  resetRemoteDraftSaves();
  resetReaderRows();
  useNotices.setState({ notices: [] }); // what the queue said in the run before
  const bare = index.sessions.upsertFromSummary(summary()).record.appId;
  const app = addressOf(OTHER_MACHINE, bare);
  if (start === 'kept') index.drafts.set(bare, draftOf('kept there', 0, [PDF, NOTE]), reader);
  const m = machine(bus, reader);
  let held: unknown[] = []; // the attachments the composer holds: those its last load gave it
  const port = {
    load: async () => void (held = attachmentsOf(await loadRemoteDraft(m.client, app, () => null))),
    save: (draft: Draft | null) => saveRemoteDraft(m.client, app, draft, () => {}),
  };
  await port.load(); // the composer opens
  await settle();
  let newest: string | null = start === 'kept' ? 'kept there' : null;
  let typed = 0;
  let cleared = false;
  for (const event of events) {
    if (event === 'edit' || event === 'grow') {
      typed += 1;
      newest = event === 'edit' ? `typed ${typed}` : `typed ${typed} ${GROWN}`;
      port.save(draftOf(newest, typed, held));
    } else if (event === 'clear') {
      newest = null;
      cleared = true;
      held = [];
      port.save(null);
    } else if (event === 'read') await port.load();
    else if (event === 'deliver') {
      if (m.out() === 0) return null;
      await m.deliver();
    } else if (event === 'timeout') {
      if (m.out() === 0) return null;
      m.timeout();
    } else {
      if (m.late() === 0) return null;
      await m.land();
    }
    await settle();
  }
  // every act lands: those out on time (and what the queue sends after them), then the late ones, then what the queue
  // sends again once its retry is due, until nothing is out
  for (let round = 0; round < 6; round++) {
    for (let guard = 0; m.out() > 0 && guard < 50; guard++) {
      await m.deliver();
      await settle();
    }
    while (m.late() > 0) await m.land();
    if (vi.getTimerCount() > 0) {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await settle();
    }
    if (m.out() === 0) break;
  }
  const kept = index.drafts.get(bare, reader);
  index.sessions.remove(bare); // the next run's index as small as this one's
  const keptText = textOf(kept);
  const violations: string[] = [];
  if (keptText !== newest) violations.push(`(i) kept ${JSON.stringify(keptText)}, newest ${JSON.stringify(newest)}`);
  for (const attachment of [PDF, NOTE]) if (start === 'kept' && !cleared && !attachmentIds(kept).includes(attachment.id)) violations.push(`(ii) ${attachment.name} is gone, with no clear`);
  return violations;
}

function* orders(length: number): Generator<Event[]> {
  if (length === 0) return yield [];
  for (const shorter of orders(length - 1)) for (const event of EVENTS) yield [...shorter, event];
}

describe('every order of draft events, up to five', () => {
  it('sizes its attachments as the bound needs: the PDF past a read, the note within a save, not a grown one', () => {
    const size = (attachments: unknown[], text = 'typed 1') => new TextEncoder().encode(JSON.stringify(draftOf(text, 1, attachments))).length;
    expect([size([PDF]) > 2048, size([NOTE], 'kept there') <= 2048, size([NOTE]) <= 2048, size([NOTE], `typed 1 ${GROWN}`) > 2048, size([], `typed 1 ${GROWN}`) <= 2048]).toEqual([true, true, true, true, true]);
  });

  it.each([
    ['an owner', 'with a draft kept there', 'owner' as Reader, 'kept' as const],
    ['a member', 'with a draft kept there', MEMBER as Reader, 'kept' as const],
    ['an owner', 'with none', 'owner' as Reader, 'none' as const],
    ['a member', 'with none', MEMBER as Reader, 'none' as const],
  ])('keeps the newest draft and the kept attachment, for %s, %s', async (_who, _start, reader, start) => {
    const failed: string[] = [];
    let runs = 0;
    for (let length = 0; length <= MAX_EVENTS; length++) {
      for (const events of orders(length)) {
        const violations = await play(events, reader, start);
        if (violations === null) continue;
        runs += 1;
        if (violations.length > 0) failed.push(`${events.join(' ') || '(none)'}: ${violations.join('; ')}`);
      }
    }
    expect(runs).toBeGreaterThan(1000);
    expect(failed.slice(0, 40)).toEqual([]);
  }, 300_000);
});
