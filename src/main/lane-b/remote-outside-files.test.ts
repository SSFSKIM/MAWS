// The adapter for a file outside a session's folders on another machine (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, decisions 4 to 6, 12 to 14, 18; §D;
// the sequences R3 to R6, R8 to R10), through remote lane B as the router reaches it, over the link's fake, which records
// every call and act: the order of decision 5 for a keyed read, each branch beside its control; the read's pages and the
// marker of an answer the ledger did not keep; the four acts sent by hand; the save's send window. Who the caller is and
// whether the person owns the machine are the two seams main hands the adapter (`isAppPage`, `owns`). Every path, name
// and byte is invented.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_KEPT_REFUSAL, OUTSIDE_FILES_CAPABILITY } from '@shared/files/outside';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { FilesReadOutput } from '@shared/ipc/schema/files';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI, type FakeAct } from '../../../test/lane-b/fake-link';
import type { CallResult } from '../machines/remote/link';
import { createRemoteLaneB } from './remote';
import { REMOTE_READ_TRIES } from './remote-files-read';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const FAR = 'FarMachineRef000000000' as MachineRef; // a second machine the person does not own
const APP = 'app-elsewhere';
const NOTES = '/srv/elsewhere/notes.txt';
/** The files service's refusal of a path outside the session's folders, as it crosses a call's answer. */
const REFUSAL = "path outside the session's directories";
/** Decision 4: a read crosses in pages of 256 KiB. */
const PAGE = 256 * 1024;
const SERVES = ['rl2.executor.machine', 'rl2.session-acts', OUTSIDE_FILES_CAPABILITY];
const OLDER = ['rl2.executor.machine', 'rl2.session-acts']; // an endpoint of a build before this landing

/** An app page of the app window, and a caller that is none (main's own, dispatchLocal's, a presentation's). */
const PAGE_CLIENT = endableClientRef('page:7.1');
const NO_PAGE = endableClientRef('main');

type Result = CommandResult<CommandName>;
const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** One answer of `files.read` (or of a page of `files.readOutside`) over `text`, from `offset` for `length`. */
function answerOf(text: string, input: Record<string, unknown>, extra: Partial<FilesReadOutput> = {}): FilesReadOutput {
  const offset = typeof input.offset === 'number' ? input.offset : 0;
  const length = typeof input.length === 'number' ? input.length : 1024 * 1024;
  const content = text.slice(offset, offset + length);
  return { encoding: 'utf8', content, bytes: text.length, offset, length: content.length, truncated: offset + content.length < text.length, mime: 'text/plain', hash: input.hash === true ? hashOf(text) : null, utf8: input.hash === true ? true : null, ...extra };
}

function lab(options: { owner?: boolean | null; farOwner?: boolean | null } = {}) {
  const link = new FakeLink();
  const far = new FakeLink(FAR);
  far.name = 'far';
  const links = new Map<MachineRef, FakeLink>([
    [MINI, link],
    [FAR, far],
  ]);
  const owners = new Map<MachineRef, boolean | null>([
    [MINI, options.owner === undefined ? true : options.owner],
    [FAR, options.farOwner === undefined ? false : options.farOwner],
  ]);
  const logs: string[] = [];
  const adapter = createRemoteLaneB({
    local: LOCAL,
    layout: { get: () => null, onChange: () => () => {} },
    remote: (machine) => links.get(machine) ?? null,
    onRemote: () => () => {},
    emit: () => {},
    isAppPage: (client: ClientRef) => client === PAGE_CLIENT,
    owns: (machine: MachineRef) => owners.get(machine) ?? null,
    timing: { sendPendingMs: 60_000 },
    log: (line) => void logs.push(line),
  } as Parameters<typeof createRemoteLaneB>[0]);
  const cmd = (name: string, input: unknown, client: ClientRef = PAGE_CLIENT, machine: MachineRef = MINI): Promise<Result> => adapter.dispatch(links.get(machine)!, name as CommandName, input, { client, target: machine });
  /** The machine's `files.read` answers `answer` for every call. */
  const reads = (answer: (input: Record<string, unknown>) => CallResult | Promise<CallResult>, on: FakeLink = link) => void on.answers.set('files.read', answer);
  /** Each `files.readOutside` page is answered done over `text`, with what the page asked, and the mark given. */
  const outsideOver = (text: string, mark: Partial<FilesReadOutput> = { named: true, outside: { real: NOTES, writable: true } }, on: FakeLink = link) => {
    on.onAct = (act) => {
      if (act.request.action === 'files.readOutside') act.settle({ state: 'done', result: answerOf(text, act.request.args as Record<string, unknown>, mark) });
    };
  };
  const files = (on: FakeLink = link) => on.calls.filter((call) => call.name.startsWith('files.'));
  link.relink(SERVES);
  far.relink(SERVES);
  return { link, far, adapter, cmd, reads, outsideOver, files, logs, owners };
}

const refused: CallResult = { ok: false, error: { code: 'internal', message: REFUSAL } };
const keyed = (extra: Record<string, unknown> = {}) => ({ appSessionId: APP, path: NOTES, offset: 0, length: 4096, named: true, ...extra });
const actsOf = (link: FakeLink) => link.acts.map((act) => ({ action: act.request.action, args: act.request.args as Record<string, unknown>, oneChannel: act.request.oneChannel === true, requires: act.request.requires }));

describe('a keyed read to a machine whose build does not list the capability (decision 5 (i))', () => {
  it('sends one files.read holding neither named, agent, raw nor open, and no act; a file inside the folders is answered as it is', async () => {
    const l = lab();
    l.link.relink(OLDER);
    const inside = answerOf('inside the checkout\n', { offset: 0, length: 4096 });
    l.reads(() => ({ ok: true, output: inside }));
    expect(await l.cmd('files.read', keyed({ agent: true, raw: true, open: true }))).toEqual({ ok: true, value: inside });
    expect(l.files()).toEqual([{ name: 'files.read', input: { appSessionId: APP, path: NOTES, offset: 0, length: 4096 } }]);
    expect(l.link.acts).toEqual([]);
  });

  it('returns a delivered file’s answer and an unrelated error as they are', async () => {
    const l = lab();
    l.link.relink(OLDER);
    const delivered = answerOf('a delivered note\n', { offset: 0, length: 4096 });
    l.reads(() => ({ ok: true, output: delivered }));
    expect(await l.cmd('files.read', keyed())).toEqual({ ok: true, value: delivered });
    l.reads(() => ({ ok: false, error: { code: 'internal', message: `not found: ${NOTES}` } }));
    expect(await l.cmd('files.read', keyed())).toEqual({ ok: false, error: { code: 'internal', message: `not found: ${NOTES}` } });
    expect(l.link.acts).toEqual([]);
  });

  it('turns the service’s refusal of a path outside the folders into the update sentence, sending no act', async () => {
    const l = lab();
    l.link.relink(OLDER);
    l.reads(() => refused);
    expect(await l.cmd('files.read', keyed())).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(l.link.acts).toEqual([]);
  });
});

describe('a keyed read to a machine that lists the capability (decision 5 (ii) to (iv))', () => {
  it('costs one call with named and agent, no open, and no act, for a file inside the folders', async () => {
    const l = lab();
    const inside = answerOf('inside the checkout\n', { offset: 0, length: 4096 });
    l.reads(() => ({ ok: true, output: inside }));
    expect(await l.cmd('files.read', keyed({ agent: true, open: true }))).toEqual({ ok: true, value: inside });
    expect(l.files()).toEqual([{ name: 'files.read', input: { appSessionId: APP, path: NOTES, offset: 0, length: 4096, named: true, agent: true } }]);
    expect(l.link.acts).toEqual([]);
  });

  it('on the service’s refusal, for an app page of an owner, reads by files.readOutside on one channel, with agent and open as the page sent them and neither named nor raw', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'an invented line outside the folders\n';
    l.outsideOver(text);
    expect(await l.cmd('files.read', keyed({ agent: true, open: true, raw: true, hash: true }))).toEqual({ ok: true, value: answerOf(text, { offset: 0, length: 4096, hash: true }, { named: true, outside: { real: NOTES, writable: true } }) });
    expect(actsOf(l.link)).toEqual([{ action: 'files.readOutside', args: { appSessionId: APP, path: NOTES, offset: 0, length: 4096, hash: true, agent: true, open: true }, oneChannel: true, requires: OUTSIDE_FILES_CAPABILITY }]);
    // the call before it carried no open: a call asks nothing of a private folder
    expect(l.files().map((call) => call.input)).toEqual([{ appSessionId: APP, path: NOTES, offset: 0, length: 4096, named: true, agent: true, raw: true, hash: true }]);
  });

  it('on an answer marked added, for an app page of an owner, asks the act, which tells a sent file from an added one', async () => {
    const l = lab();
    const delivered = answerOf('a delivered note\n', { offset: 0, length: 4096 }, { named: true, outside: { real: NOTES, writable: false, why: 'added' } });
    l.reads(() => ({ ok: true, output: delivered }));
    l.outsideOver('a delivered note\n');
    expect(await l.cmd('files.read', keyed())).toEqual({ ok: true, value: answerOf('a delivered note\n', { offset: 0, length: 4096 }, { named: true, outside: { real: NOTES, writable: true } }) });
    expect(l.link.acts.map((act) => act.request.action)).toEqual(['files.readOutside']);
  });

  it('an added answer followed by a refused act is returned as the call answered it', async () => {
    const l = lab();
    const delivered = answerOf('a delivered note\n', { offset: 0, length: 4096 }, { named: true, outside: { real: NOTES, writable: false, why: 'added' } });
    l.reads(() => ({ ok: true, output: delivered }));
    l.link.onAct = (act) => act.settle({ state: 'refused', reason: 'read-only' });
    expect(await l.cmd('files.read', keyed())).toEqual({ ok: true, value: delivered });
    expect(l.link.acts).toHaveLength(1);
  });

  it('for an app page of a person the roster says does not own the machine, or does not yet say (R10): no act, and the ownership sentence', async () => {
    for (const owner of [false, null]) {
      const l = lab({ owner });
      l.reads(() => refused);
      expect([owner, await l.cmd('files.read', keyed())]).toEqual([owner, { ok: false, error: { code: 'internal', message: 'Not opened: only mini’s owners can', issues: { refusal: 'owners-only' } } }]);
      expect([owner, l.link.acts]).toEqual([owner, []]);
    }
  });

  it('for an app page of a person who does not own the machine, an added answer is returned as the call gave it, with no act', async () => {
    const l = lab({ owner: false });
    const delivered = answerOf('a delivered note\n', { offset: 0, length: 4096 }, { named: true, outside: { real: NOTES, writable: false, why: 'added' } });
    l.reads(() => ({ ok: true, output: delivered }));
    expect(await l.cmd('files.read', keyed())).toEqual({ ok: true, value: delivered });
    expect(l.link.acts).toEqual([]);
  });

  it('for a caller that is no app page: what the call answered, with no act and no new sentence (P1), beside the app page’s act (the control)', async () => {
    const l = lab();
    const delivered = answerOf('a delivered note\n', { offset: 0, length: 4096 }, { named: true, outside: { real: NOTES, writable: false, why: 'added' } });
    l.outsideOver('a delivered note\n');
    l.reads(() => refused);
    expect(await l.cmd('files.read', keyed(), NO_PAGE)).toEqual({ ok: false, error: { code: 'internal', message: REFUSAL } });
    l.reads(() => ({ ok: true, output: delivered }));
    expect(await l.cmd('files.read', keyed(), NO_PAGE)).toEqual({ ok: true, value: delivered });
    expect(l.link.acts).toEqual([]);
    // the control: the same read from an app page of an owner sends the act
    expect(await l.cmd('files.read', keyed())).toMatchObject({ ok: true, value: { outside: { writable: true } } });
    expect(l.link.acts).toHaveLength(1);
  });

  it('asks whether to promote on the machine of the read itself: an owner’s app page reading a file of a machine it does not own sends no act there', async () => {
    const l = lab({ owner: true, farOwner: false });
    l.reads(() => refused, l.far);
    l.outsideOver('far away\n', undefined, l.far);
    expect(await l.cmd('files.read', keyed(), PAGE_CLIENT, FAR)).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: only far’s owners can', issues: { refusal: 'owners-only' } } });
    expect(l.far.acts).toEqual([]);
    // the control: the machine it owns
    l.reads(() => refused);
    l.outsideOver('close by\n');
    expect(await l.cmd('files.read', keyed())).toMatchObject({ ok: true });
    expect(l.link.acts).toHaveLength(1);
  });

  it('with no channel current answers at once and sends nothing, a peer’s build unknown', async () => {
    const l = lab();
    l.reads(() => refused);
    l.link.lose();
    expect(await l.cmd('files.read', keyed())).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.files()).toEqual([]);
    expect(l.link.acts).toEqual([]);
  });

  it('a read with no named key takes today’s route: one call, never an act, whoever asks', async () => {
    const l = lab();
    l.reads(() => refused);
    expect(await l.cmd('files.read', { appSessionId: APP, path: NOTES })).toEqual({ ok: false, error: { code: 'internal', message: REFUSAL } });
    expect(l.link.acts).toEqual([]);
  });
});

// M3's fix waves (Decision Log 27; the review's Important 1; the architect's condition 2): a keyed read goes only on the
// channel whose peer's list was read for it, so a call carrying `named`, `agent` or `open` is never carried by the link to
// the next channel's peer. When that channel ends before the read is answered, the adapter waits for the next one within
// the hold the link gives a carried call, and reads afresh there: a new check of the peer's list, a new call, the act if
// one is due; once. The person sees what today's carried read shows: the answer, or at the hold's end today's sentence.
// The link's fake fails a bound call at its channel's end, as the real link does.
describe('the channel a keyed read is bound to (Decision Log 27; condition 2)', () => {
  const PENDING = 'still pending';
  /** The read's answer once the microtasks ran, or PENDING. */
  async function answered(read: Promise<Result>): Promise<Result | typeof PENDING> {
    let out: Result | typeof PENDING = PENDING;
    void read.then((value) => void (out = value));
    for (let i = 0; i < 50; i++) await Promise.resolve();
    return out;
  }
  /** What today's read held across a lasting loss answers at its hold's end (the link's `offline`, as refusalError words it). */
  const lasting = { ok: false, error: { code: 'host_unavailable', message: 'files.read: machine mini is not reachable' } };
  const HOLD = 10_000; // the link's hold of a carried call with no budget of its own (CALL_TIMEOUT_MS)
  /** The machine takes the first read and never answers it on that channel; every later one is answered. */
  function firstHeld(l: ReturnType<typeof lab>, answer: (input: Record<string, unknown>) => CallResult) {
    let n = 0;
    l.reads((input) => (++n === 1 ? new Promise<CallResult>(() => {}) : answer(input)));
  }
  const inside = (input: Record<string, unknown>): CallResult => ({ ok: true, output: answerOf('inside the checkout\n', input) });

  it('a keyed read whose channel ends before it answers is asked afresh on the next channel: one new call with named, and the answer, never an error between', async () => {
    const l = lab();
    firstHeld(l, inside);
    const read = l.cmd('files.read', keyed({ agent: true, open: true }));
    await answered(read);
    l.link.lose();
    expect(await answered(read)).toBe(PENDING); // waiting for the next channel, as today's carried read does
    l.link.relink([...SERVES]);
    expect(await answered(read)).toEqual({ ok: true, value: answerOf('inside the checkout\n', { offset: 0, length: 4096 }) });
    const sent = { appSessionId: APP, path: NOTES, offset: 0, length: 4096, named: true, agent: true };
    expect(l.files()).toEqual([
      { name: 'files.read', input: sent },
      { name: 'files.read', input: sent },
    ]);
    expect(l.link.acts).toEqual([]);
  });

  it('with an older build on the next channel, the fresh call is today’s read to the byte, and its refusal the update sentence (decision 5 (i))', async () => {
    const l = lab();
    firstHeld(l, () => refused);
    const read = l.cmd('files.read', keyed({ agent: true, open: true }));
    await answered(read);
    l.link.lose();
    l.link.relink([...OLDER]);
    expect(await answered(read)).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(l.files().map((call) => call.input)).toEqual([
      { appSessionId: APP, path: NOTES, offset: 0, length: 4096, named: true, agent: true },
      { appSessionId: APP, path: NOTES, offset: 0, length: 4096 },
    ]);
    expect(l.link.acts).toEqual([]);
  });

  it('with no channel back within the link’s hold: today’s sentence at the hold’s end, and nothing sent again', async () => {
    const l = lab();
    firstHeld(l, inside);
    const read = l.cmd('files.read', keyed());
    await answered(read);
    l.link.lose();
    await vi.advanceTimersByTimeAsync(HOLD - 1);
    expect(await answered(read)).toBe(PENDING);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answered(read)).toEqual(lasting);
    l.link.relink([...SERVES]);
    await answered(read);
    expect(l.files()).toHaveLength(1);
  });

  it('a second end under the fresh read answers today’s sentence; nothing is asked a third time', async () => {
    const l = lab();
    l.reads(() => new Promise<CallResult>(() => {}));
    const read = l.cmd('files.read', keyed());
    await answered(read);
    l.link.lose();
    l.link.relink([...SERVES]);
    await answered(read);
    expect(l.files()).toHaveLength(2);
    l.link.lose();
    expect(await answered(read)).toEqual(lasting);
    l.link.relink([...SERVES]);
    await answered(read);
    expect(l.files()).toHaveLength(2);
  });

  it('a read whose pages were under way when the channel ended is read afresh, whole, on the next channel', async () => {
    const l = lab();
    let held = false;
    l.reads((input) => {
      if (input.length === 4 * 1024 * 1024) return { ok: false, error: { code: 'too-large' } };
      if (!held) return (held = true), new Promise<CallResult>(() => {});
      return inside(input);
    });
    const read = l.cmd('files.read', keyed({ length: 4 * 1024 * 1024 }));
    await answered(read);
    expect(l.files()).toHaveLength(2); // the whole read, refused too-large, and the first page, held
    l.link.lose();
    l.link.relink([...SERVES]);
    expect(await answered(read)).toMatchObject({ ok: true, value: { content: 'inside the checkout\n' } });
    expect(l.files().map((call) => (call.input as { length: number }).length)).toEqual([4 * 1024 * 1024, expect.any(Number), 4 * 1024 * 1024, expect.any(Number)]);
  });

  // Fix wave 3 (the re-review's first Important): the attempt whose keys a peer's list chose is bound, whole, to that
  // channel; a channel replaced between two of its requests (the link's switch from the relay to the direct carrier is
  // one, at once) ends it, and decision 5 starts again on the channel current now. Nothing of the old keys goes on.
  /** The link's switch right after the first request's answer came in, before the next is asked (relay to direct). */
  function switchAfterFirst(l: ReturnType<typeof lab>, peers: string[]) {
    const call = l.link.call.bind(l.link);
    let n = 0;
    l.link.call = async (name, input, options) => {
      const result = await call(name, input, options);
      if (name === 'files.read' && ++n === 1) {
        l.link.lose();
        l.link.relink([...peers]);
      }
      return result;
    };
  }
  /** The whole read is too large for the channel; a page is answered; an older build refuses the keys it does not read. */
  const pagedFile = (input: Record<string, unknown>): CallResult => {
    if (input.length === 4 * 1024 * 1024) return { ok: false, error: { code: 'too-large' } };
    return inside(input);
  };

  it('a channel replaced by an older build between the too-large answer and the first page: no page is asked of it, and the read starts again with today’s keys', async () => {
    const l = lab();
    switchAfterFirst(l, OLDER);
    // as the older build answers: a key its schema does not hold is malformed
    l.reads((input) => (!l.link.peers.includes(OUTSIDE_FILES_CAPABILITY) && ['named', 'agent', 'open'].some((key) => key in input) ? { ok: false, error: { code: 'malformed' } } : pagedFile(input)));
    expect(await answered(l.cmd('files.read', keyed({ length: 4 * 1024 * 1024, agent: true })))).toMatchObject({ ok: true, value: { content: 'inside the checkout\n' } });
    const [checked, ...older] = l.files().map((call) => call.input as Record<string, unknown>);
    expect(checked).toMatchObject({ named: true, agent: true, length: 4 * 1024 * 1024 }); // the one request on the checked channel
    expect(older.length).toBeGreaterThan(0);
    for (const input of older) expect(['named', 'agent', 'open'].filter((key) => key in input)).toEqual([]);
  });

  it('a channel replaced by a capable build between the too-large answer and the first page: the attempt ends, and the read starts again, whole, on the channel current now', async () => {
    const l = lab();
    switchAfterFirst(l, SERVES);
    l.reads(pagedFile);
    expect(await answered(l.cmd('files.read', keyed({ length: 4 * 1024 * 1024 })))).toMatchObject({ ok: true, value: { content: 'inside the checkout\n' } });
    expect(l.files().map((call) => (call.input as { length: number }).length)).toEqual([4 * 1024 * 1024, 4 * 1024 * 1024, expect.any(Number)]);
  });

  // Fix wave 3 (the re-review's second Important): the hold's end binds a channel already current too.
  it('a channel replaced after the hold’s end, the next one already current: today’s sentence, and no request after the hold', async () => {
    const l = lab();
    l.reads(() => refused);
    l.link.onAct = () => {}; // the first page of the act goes out, and its answer never comes
    const read = l.cmd('files.read', keyed());
    await answered(read);
    expect(l.link.acts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HOLD + 1);
    l.link.lose(); // the act's channel replaced, the next one current at once
    l.link.relink([...SERVES]);
    expect(await answered(read)).toEqual(lasting);
    expect(l.files()).toHaveLength(1);
    expect(l.link.acts).toHaveLength(1);
  });

  it('the control: the same replacement inside the hold reads afresh on the channel current now', async () => {
    const l = lab();
    l.reads(() => refused);
    let acts = 0;
    l.link.onAct = (act) => {
      if (++acts === 1) return;
      act.settle({ state: 'done', result: answerOf('far\n', act.request.args as Record<string, unknown>, { named: true, outside: { real: NOTES, writable: true } }) });
    };
    const read = l.cmd('files.read', keyed());
    await answered(read);
    await vi.advanceTimersByTimeAsync(HOLD - 1);
    l.link.lose();
    l.link.relink([...SERVES]);
    expect(await answered(read)).toMatchObject({ ok: true, value: { content: 'far\n' } });
    expect(l.files()).toHaveLength(2);
    expect(l.link.acts).toHaveLength(2);
  });

  it('a promoted read whose act’s channel ends before it answers is read afresh on the next: a new plain call, a new act, the file', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'an invented line outside the folders\n';
    let acts = 0;
    l.link.onAct = (act) => {
      if (++acts === 1) return; // the first page went out and its answer never came
      act.settle({ state: 'done', result: answerOf(text, act.request.args as Record<string, unknown>, { named: true, outside: { real: NOTES, writable: true } }) });
    };
    const read = l.cmd('files.read', keyed());
    await answered(read);
    expect(l.link.acts).toHaveLength(1);
    l.link.lose(); // the act ends unknown: its channel ended with its copy out
    l.link.relink([...SERVES]);
    expect(await answered(read)).toMatchObject({ ok: true, value: { content: text, outside: { real: NOTES, writable: true } } });
    expect(l.files()).toHaveLength(2);
    expect(l.link.acts).toHaveLength(2);
  });

  // The branch review (scalpel-3#1; Decision Log 33 (2)): the whole keyed read is bound to the channel of its first page;
  // a channel change mid-read discards the pages and restarts from page 0 under the new channel's own decision
  /** Each page of `files.readOutside` answered over the text of the channel current when it is asked; after the first page's answer, `then` runs once. */
  function pagesByChannel(l: ReturnType<typeof lab>, textOf: () => string, then: () => void) {
    let first = true;
    l.link.onAct = (act) => {
      if (act.request.action !== 'files.readOutside') return;
      if (!l.link.peers.includes(OUTSIDE_FILES_CAPABILITY)) return act.settle({ state: 'refused', reason: 'not-offered' }); // as an older build answers a name it has no row for
      act.settle({ state: 'done', result: answerOf(textOf(), act.request.args as Record<string, unknown>, { named: true, outside: { real: NOTES, writable: true } }) });
      if (!first) return;
      first = false;
      then();
    };
  }
  const switchTo = (l: ReturnType<typeof lab>, peers: string[]) => () => {
    l.link.lose();
    l.link.relink([...peers]);
  };

  it('a channel replaced after the first page of a promoted read: its pages are discarded and the read starts again from page 0 on the new channel, never joining two channels’ bytes', async () => {
    const l = lab();
    l.reads(() => refused);
    const before = 'A'.repeat(300_000); // two pages of 256 KiB
    const after = 'B'.repeat(300_000);
    let current = before;
    pagesByChannel(l, () => current, () => void ((current = after), switchTo(l, SERVES)()));
    const read = await l.cmd('files.read', keyed({ length: 1024 * 1024 }));
    expect(read).toMatchObject({ ok: true, value: { bytes: after.length, length: after.length, outside: { real: NOTES, writable: true } } });
    const content = (read as { value: FilesReadOutput }).value.content;
    expect({ A: content.split('A').length - 1, B: content.split('B').length - 1 }, 'the bytes of each channel').toEqual({ A: 0, B: after.length });
    expect(actsOf(l.link).map((act) => act.args.offset)).toEqual([0, 0, PAGE]); // the new channel's read from page 0
    expect(l.files()).toHaveLength(2); // and its own decision: a fresh plain call first
  });

  it('a channel replaced by an older build after the first page: no page is asked of it; the read takes the ordinary reconnect, today’s read to the byte, and its refusal says to update', async () => {
    const l = lab();
    l.reads((input) => (!l.link.peers.includes(OUTSIDE_FILES_CAPABILITY) && ['named', 'agent', 'open'].some((key) => key in input) ? { ok: false, error: { code: 'malformed' } } : refused));
    pagesByChannel(l, () => 'A'.repeat(300_000), switchTo(l, OLDER));
    expect(await l.cmd('files.read', keyed({ length: 1024 * 1024, agent: true }))).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(l.link.acts).toHaveLength(1); // the first page alone, on the channel that listed the capability
    expect(l.files().map((call) => call.input)).toEqual([
      { appSessionId: APP, path: NOTES, offset: 0, length: 1024 * 1024, named: true, agent: true },
      { appSessionId: APP, path: NOTES, offset: 0, length: 1024 * 1024 },
    ]);
  });

  it('a page the ledger did not keep, asked again after the channel was replaced: not asked of the new channel; the read starts again from page 0 there', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'C'.repeat(1000);
    const marker = { code: 'internal', message: 'the answer was not kept: ask again', issues: { refusal: NOT_KEPT_REFUSAL } };
    let n = 0;
    l.link.onAct = (act) => {
      if (++n === 1) {
        act.settle({ state: 'failed', error: marker });
        return switchTo(l, SERVES)();
      }
      act.settle({ state: 'done', result: answerOf(text, act.request.args as Record<string, unknown>, { named: true, outside: { real: NOTES, writable: true } }) });
    };
    expect(await l.cmd('files.read', keyed())).toMatchObject({ ok: true, value: { content: text } });
    expect(l.files()).toHaveLength(2); // the retry was not sent on the new channel: decision 5 ran there afresh
    expect(l.link.acts).toHaveLength(2);
  });

  it('a files.readOutside the page sends by hand, its channel replaced after the first page: no page goes on the new channel, and the read fails as the machine not reachable', async () => {
    const l = lab();
    pagesByChannel(l, () => 'A'.repeat(300_000), switchTo(l, SERVES));
    expect(await l.cmd('files.readOutside', { appSessionId: APP, path: NOTES, offset: 0, length: 1024 * 1024 })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.link.acts).toHaveLength(1);
  });

  it('the control: a promoted read of two pages on one channel joins its pages and asks no more', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'D'.repeat(300_000);
    pagesByChannel(l, () => text, () => {});
    expect(await l.cmd('files.read', keyed({ length: 1024 * 1024 }))).toMatchObject({ ok: true, value: { content: text } });
    expect(actsOf(l.link).map((act) => act.args.offset)).toEqual([0, PAGE]);
    expect(l.files()).toHaveLength(1);
  });

  it('with no channel current when it is made, a keyed read answers at once (decision 6), and waits for none', async () => {
    const l = lab();
    l.link.lose();
    expect(await answered(l.cmd('files.read', keyed()))).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.files()).toEqual([]);
  });

  it('the control: a read with no named key (today’s route) is not bound, and waits under the link’s hold', async () => {
    const l = lab();
    l.reads(() => new Promise<CallResult>(() => {}));
    const read = l.cmd('files.read', { appSessionId: APP, path: NOTES });
    await answered(read);
    l.link.lose();
    expect(await answered(read)).toBe(PENDING);
  });
});

describe('the read’s pages (decision 4; R3, R4)', () => {
  it('reads a file of three pages, each an act on one channel, into the one answer the page asked for, outside and named from the pages', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'abcdefghij'.repeat(60_000); // 600,000 bytes: three pages of 256 KiB
    l.outsideOver(text);
    expect(await l.cmd('files.read', keyed({ length: 1024 * 1024 }))).toEqual({
      ok: true,
      value: { encoding: 'utf8', content: text, bytes: text.length, offset: 0, length: text.length, truncated: false, mime: 'text/plain', hash: null, utf8: null, named: true, outside: { real: NOTES, writable: true } },
    });
    expect(actsOf(l.link).map((act) => [act.args.offset, act.args.length, act.oneChannel])).toEqual([
      [0, PAGE, true],
      [PAGE, PAGE, true],
      [2 * PAGE, PAGE, true],
    ]);
  });

  it('reads again a file whose pages answer different hashes, at most REMOTE_READ_TRIES times, then fails with “kept changing”, assembling nothing from two versions (R3)', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'x'.repeat(PAGE + 10);
    let n = 0;
    l.link.onAct = (act) => {
      const args = act.request.args as Record<string, unknown>;
      // every second page reads a file that changed under it
      act.settle({ state: 'done', result: { ...answerOf(text, args), hash: (n++ % 2 === 0 ? 'a' : 'b').repeat(64), utf8: true, named: true, outside: { real: NOTES, writable: true } } });
    };
    const read = await l.cmd('files.read', keyed({ hash: true, length: 1024 * 1024 }));
    expect(read).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('kept changing') } });
    expect(l.link.acts).toHaveLength(2 * REMOTE_READ_TRIES);
  });

  it('asks a page the ledger answered with the not-kept marker once more, under a new operation, and a second marker is the read’s failure (R4)', async () => {
    const l = lab();
    l.reads(() => refused);
    const text = 'a page asked twice\n';
    const marker = { code: 'internal', message: 'the answer was not kept: ask again', issues: { refusal: NOT_KEPT_REFUSAL } };
    let n = 0;
    l.link.onAct = (act) => (n++ === 0 ? act.settle({ state: 'failed', error: marker }) : act.settle({ state: 'done', result: answerOf(text, act.request.args as Record<string, unknown>, { named: true, outside: { real: NOTES, writable: true } }) }));
    expect(await l.cmd('files.read', keyed())).toMatchObject({ ok: true, value: { content: text } });
    expect(l.link.acts).toHaveLength(2);
    expect(new Set(l.link.acts.map((act) => act.opId)).size).toBe(2);
    // a second marker: the read's failure, and no third act
    const m = lab();
    m.reads(() => refused);
    m.link.onAct = (act) => act.settle({ state: 'failed', error: marker });
    expect(await m.cmd('files.read', keyed())).toEqual({ ok: false, error: { code: 'internal', message: 'the answer was not kept: ask again', issues: { refusal: NOT_KEPT_REFUSAL } } });
    expect(m.link.acts).toHaveLength(2);
  });
});

describe('the four acts sent by hand', () => {
  const READ = { appSessionId: APP, path: NOTES };
  const LIST = { appSessionId: APP, path: '/srv/elsewhere' };
  const CHOOSE = { appSessionId: APP, path: NOTES };
  const SAVE = { appSessionId: APP, path: NOTES, content: 'an invented line\n', expectedHash: 'a'.repeat(64), real: NOTES };
  const LISTED = { status: 'listed', path: '/srv/elsewhere', parent: '/srv', home: '/home/someone', entries: [], cursor: null };

  it('go to a machine that lists the capability, for an owner: the read in pages and the listing and the choice on one channel, the save as files.write goes', async () => {
    const l = lab();
    l.link.onAct = (act) => {
      const args = act.request.args as Record<string, unknown>;
      if (act.request.action === 'files.readOutside') act.settle({ state: 'done', result: answerOf('an invented line\n', args, { named: true, outside: { real: NOTES, writable: true } }) });
      if (act.request.action === 'files.listOutside') act.settle({ state: 'done', result: LISTED });
      if (act.request.action === 'files.chooseOutside') act.settle({ state: 'done', result: { status: 'granted', path: NOTES } });
      if (act.request.action === 'files.writeOutside') act.settle({ state: 'done', result: { status: 'ok', hash: 'b'.repeat(64) } });
    };
    expect(await l.cmd('files.readOutside', READ)).toMatchObject({ ok: true, value: { content: 'an invented line\n' } });
    expect(await l.cmd('files.listOutside', LIST)).toEqual({ ok: true, value: LISTED });
    expect(await l.cmd('files.chooseOutside', CHOOSE)).toEqual({ ok: true, value: { status: 'granted', path: NOTES } });
    expect(await l.cmd('files.writeOutside', SAVE)).toEqual({ ok: true, value: { status: 'ok', hash: 'b'.repeat(64) } });
    expect(actsOf(l.link)).toEqual([
      { action: 'files.readOutside', args: { ...READ, offset: 0, length: PAGE }, oneChannel: true, requires: OUTSIDE_FILES_CAPABILITY },
      { action: 'files.listOutside', args: LIST, oneChannel: true, requires: OUTSIDE_FILES_CAPABILITY },
      { action: 'files.chooseOutside', args: CHOOSE, oneChannel: true, requires: OUTSIDE_FILES_CAPABILITY },
      { action: 'files.writeOutside', args: SAVE, oneChannel: false, requires: OUTSIDE_FILES_CAPABILITY },
    ]);
    expect(l.files()).toEqual([]);
  });

  it('are refused not-offered, unsent, by a machine whose build does not list the capability, each in its own words (B6; R9)', async () => {
    const l = lab();
    l.link.relink(OLDER);
    expect(await l.cmd('files.readOutside', READ)).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(await l.cmd('files.listOutside', LIST)).toEqual({ ok: false, error: { code: 'internal', message: 'Not listed: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(await l.cmd('files.chooseOutside', CHOOSE)).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    // R9: the daemon replaced by an older build under an edited tab; no files.write goes in its place
    expect(await l.cmd('files.writeOutside', SAVE)).toEqual({ ok: false, error: { code: 'internal', message: 'Not saved: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(l.link.acts).toEqual([]);
    expect(l.files()).toEqual([]);
  });

  it('are refused owners-only, unsent, for a person the roster does not say owns the machine (R10), beside an owner’s act (the control)', async () => {
    for (const owner of [false, null]) {
      const l = lab({ owner });
      for (const [name, input] of [['files.readOutside', READ], ['files.listOutside', LIST], ['files.chooseOutside', CHOOSE], ['files.writeOutside', SAVE]] as const) {
        expect([owner, name, await l.cmd(name, input)]).toMatchObject([owner, name, { ok: false, error: { code: 'internal', issues: { refusal: 'owners-only' } } }]);
      }
      expect(await l.cmd('files.writeOutside', SAVE)).toEqual({ ok: false, error: { code: 'internal', message: 'Not saved: only mini’s owners can', issues: { refusal: 'owners-only' } } });
      expect([owner, l.link.acts]).toEqual([owner, []]);
    }
    const owner = lab();
    owner.link.onAct = (act) => act.settle({ state: 'done', result: LISTED });
    expect(await owner.cmd('files.listOutside', LIST)).toEqual({ ok: true, value: LISTED });
  });

  it('with no channel current: the read, the listing and the choice answer at once and send nothing (decision 6)', async () => {
    const l = lab();
    l.link.lose();
    for (const [name, input] of [['files.readOutside', READ], ['files.listOutside', LIST], ['files.chooseOutside', CHOOSE]] as const) {
      expect([name, await l.cmd(name, input)]).toMatchObject([name, { ok: false, error: { code: 'host_unavailable' } }]);
    }
    expect(l.link.acts).toEqual([]);
  });

  it('a save with no channel current waits for one: its page ended and a channel made inside its send window, it is sent once and written once (R8)', async () => {
    const l = lab();
    l.link.lose();
    l.link.onAct = (act) => act.move('waiting'); // held under the link's hold until a channel takes it
    const page = endableClientRef('page:9.1');
    const saving = l.cmd('files.writeOutside', SAVE, page);
    await vi.advanceTimersByTimeAsync(10);
    page.end(); // the window that asked closed: nothing withdraws the act
    await vi.advanceTimersByTimeAsync(20_000);
    l.link.relink(SERVES);
    const [act] = l.link.acts as [FakeAct];
    act.move('sent');
    act.settle({ state: 'done', result: { status: 'ok', hash: 'b'.repeat(64) } });
    expect(await saving).toEqual({ ok: true, value: { status: 'ok', hash: 'b'.repeat(64) } });
    expect(l.link.acts).toHaveLength(1);
    expect(act.request).toMatchObject({ action: 'files.writeOutside', args: SAVE, sendBy: expect.any(Number) });
  });

  it('a save whose send window passes with no channel is never sent, and was answered “Not saved: mini is offline” (R8)', async () => {
    const l = lab();
    l.link.lose();
    l.link.onAct = (act) => act.move('waiting');
    const saving = l.cmd('files.writeOutside', SAVE);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await saving).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not saved: mini is offline', issues: { refusal: 'offline' } } });
    l.link.relink(SERVES);
    await vi.advanceTimersByTimeAsync(10);
    expect(l.link.acts).toHaveLength(1);
    expect(l.link.acts[0]!.settled).toEqual({ state: 'refused', reason: 'offline' });
  });

  it('a save the channel carried whose answer is lost is answered at the pending bound, and the link goes on asking (R5)', async () => {
    const l = lab();
    const saving = l.cmd('files.writeOutside', SAVE);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await saving).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
    const [act] = l.link.acts as [FakeAct];
    act.settle({ state: 'done', result: { status: 'ok', hash: 'b'.repeat(64) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.logs.some((line) => line.includes('files.writeOutside') && line.includes('settled late: done'))).toBe(true);
  });

  it('a save made after the link dropped and came back carries the pin and the hash the page held (R6)', async () => {
    const l = lab();
    l.link.lose();
    l.link.relink(SERVES);
    l.link.onAct = (act) => act.settle({ state: 'done', result: { status: 'ok', hash: 'b'.repeat(64) } });
    expect(await l.cmd('files.writeOutside', SAVE)).toMatchObject({ ok: true });
    expect(l.link.acts.map((act) => act.request.args)).toEqual([SAVE]);
  });

  it('words a refusal the endpoint or the service gives by the act’s own row; protected crosses as that word', async () => {
    const l = lab();
    l.link.onAct = (act) => act.settle({ state: 'refused', reason: 'read-only' });
    expect(await l.cmd('files.writeOutside', SAVE)).toEqual({ ok: false, error: { code: 'internal', message: 'Not saved: mini is in read-only mode', issues: { refusal: 'read-only' } } });
    l.link.onAct = (act) => act.settle({ state: 'failed', error: { code: 'internal', message: 'the file is in a folder macOS protects', issues: { refusal: 'protected' } } });
    expect(await l.cmd('files.readOutside', READ)).toEqual({ ok: false, error: { code: 'internal', message: 'Not opened: the file is in a folder macOS protects on mini', issues: { refusal: 'protected' } } });
    expect(await l.cmd('files.writeOutside', { ...SAVE, open: true })).toEqual({ ok: false, error: { code: 'internal', message: 'Not saved: the file is in a folder macOS protects on mini', issues: { refusal: 'protected' } } });
    expect(l.link.acts.at(-1)!.request.args).toEqual({ ...SAVE, open: true }); // `open` passed through as the page sent it
  });
});
