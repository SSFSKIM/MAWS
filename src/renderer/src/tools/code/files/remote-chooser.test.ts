// The chooser's model for a session on another machine (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; Cards 1 to 3 as the owner answered
// them; sequences C1 to C3 and C5): a state machine with no DOM over a listing and a choice whose answers the test
// releases by hand. Invented names and paths.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import type { OutsideEntry } from '@shared/ipc/schema/files';
import { addressOf } from '@shared/machine/address';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { deferred } from '../../../test-support/code';
import { forgetOpenedThere, openedThere } from './elsewhere';
import { createRemoteChooser, forgetStarts, parentOf, startOf, type ChooseInput, type ListInput } from './remote-chooser';

const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const HOME = '/home/someone';
type Listing = CommandResult<'files.listOutside'>;
type Choice = CommandResult<'files.chooseOutside'>;

const dir = (path: string, over: Partial<OutsideEntry> = {}): OutsideEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', protected: false, ...over });
const file = (path: string): OutsideEntry => ({ ...dir(path), kind: 'file' });
const link = (path: string): OutsideEntry => ({ ...dir(path), kind: 'link' });
const other = (path: string): OutsideEntry => ({ ...dir(path), kind: 'other' });
const parentPath = (path: string) => (path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/');
const listed = (path: string, entries: OutsideEntry[], cursor: string | null = null): Listing => ({ ok: true, value: { status: 'listed', path, parent: parentPath(path), home: HOME, entries, cursor } });
const refusedListing = (reason: 'no-folder' | 'not-a-folder' | 'unreadable' | 'protected'): Listing => ({ ok: true, value: { status: 'refused', reason } });
const granted = (path: string): Choice => ({ ok: true, value: { status: 'granted', path } });
const refusedChoice = (reason: 'not-a-file' | 'no-file' | 'protected'): Choice => ({ ok: true, value: { status: 'refused', reason } });
const unreachable = { ok: false as const, error: { code: 'host_unavailable' as const, message: 'files.listOutside: machine studio is not reachable' } };

// A chooser whose listings and choices wait for the test: each ask is recorded with its input and its answer's gate.
function harness(startAt: string | null = null, offer: { words: string | null } = { words: null }) {
  const lists: { input: ListInput; answer(result: Listing): Promise<void> }[] = [];
  const chooses: { input: ChooseInput; answer(result: Choice): Promise<void> }[] = [];
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const chooser = createRemoteChooser(R, {
    list(input) {
      const gate = deferred<Listing>();
      lists.push({ input, answer: (result) => (gate.resolve(result), settle()) });
      return gate.promise;
    },
    choose(input) {
      const gate = deferred<Choice>();
      chooses.push({ input, answer: (result) => (gate.resolve(result), settle()) });
      return gate.promise;
    },
    machine: () => 'studio',
    unoffered: () => offer.words,
    startAt,
  });
  const heard = { count: 0 };
  chooser.subscribe(() => void (heard.count += 1));
  return { chooser, lists, chooses, heard, last: () => lists.at(-1)!, lastChoice: () => chooses.at(-1)! };
}

const AT_HOME = [dir(`${HOME}/Documents`, { protected: true }), dir(`${HOME}/garden-club`), dir(`${HOME}/.config`), link(`${HOME}/latest`), file(`${HOME}/roadmap.md`), file(`${HOME}/.zshrc`)];

beforeEach(() => {
  forgetOpenedThere();
  forgetStarts();
});
afterEach(() => vi.useRealTimers());

describe('the chooser opens', () => {
  it('on the machine’s home (Card 2): one listing with no path, reading until it answers, then the folder listed', async () => {
    const { chooser, lists } = harness();
    expect(lists.map((ask) => ask.input)).toEqual([{ appSessionId: R }]);
    expect(chooser.state()).toEqual({ at: 'reading', path: null });
    await lists[0].answer(listed(HOME, AT_HOME));
    expect(chooser.state()).toEqual({ at: 'listed', path: HOME, parent: '/home', home: HOME, entries: AT_HOME, cursor: null, selected: null });
  });

  it('where it was last on that machine this run, kept in memory alone (startOf)', async () => {
    expect(startOf(OTHER_MACHINE)).toBeNull();
    const first = harness();
    await first.lists[0].answer(listed(HOME, AT_HOME));
    first.chooser.enter(dir(`${HOME}/garden-club`));
    await first.last().answer(listed(`${HOME}/garden-club`, []));
    expect(startOf(OTHER_MACHINE)).toBe(`${HOME}/garden-club`);
    const second = harness(startOf(OTHER_MACHINE));
    expect(second.lists.map((ask) => ask.input)).toEqual([{ appSessionId: R, path: `${HOME}/garden-club` }]);
    forgetStarts();
    expect(startOf(OTHER_MACHINE)).toBeNull();
  });
});

describe('C1: only the newest ask’s answer lands', () => {
  it('a folder entered while another is read: the older answer lands nowhere, the newer lands', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(dir(`${HOME}/garden-club`));
    expect(chooser.state()).toEqual({ at: 'reading', path: `${HOME}/garden-club` });
    chooser.up(); // while it reads, ".." (the read folder's parent) answers at once
    expect(lists.map((ask) => ask.input.path)).toEqual([undefined, `${HOME}/garden-club`, HOME]);
    await lists[2].answer(listed(HOME, AT_HOME.slice(1)));
    await lists[1].answer(listed(`${HOME}/garden-club`, [file(`${HOME}/garden-club/rota.md`)])); // late: the folder no longer shown
    expect(chooser.state()).toMatchObject({ at: 'listed', path: HOME, entries: AT_HOME.slice(1) });
  });

  it('a typed path while a folder is read answers at once, and the folder’s answer then changes nothing', async () => {
    const { chooser, lists } = harness();
    chooser.go('/srv/shared');
    expect(chooser.state()).toEqual({ at: 'reading', path: '/srv/shared' });
    await lists[0].answer(listed(HOME, AT_HOME));
    expect(chooser.state()).toEqual({ at: 'reading', path: '/srv/shared' });
    await lists[1].answer(listed('/srv/shared', [file('/srv/shared/a.txt')]));
    expect(chooser.state()).toMatchObject({ at: 'listed', path: '/srv/shared' });
  });

  it('Cancel closes at once: a late answer lands nowhere and no listener hears it', async () => {
    const { chooser, lists, heard } = harness();
    chooser.cancel();
    const before = { state: chooser.state(), heard: heard.count };
    await lists[0].answer(listed(HOME, AT_HOME));
    expect(chooser.state()).toBe(before.state);
    expect(heard.count).toBe(before.heard);
    chooser.enter(dir(`${HOME}/garden-club`));
    chooser.go('/srv');
    expect(lists).toHaveLength(1); // nothing is asked after Cancel
  });
});

describe('C2: a listing that never answers', () => {
  it('at the pending bound says the machine has not answered, the path standing; Try again asks again, and only its answer lands', async () => {
    vi.useFakeTimers();
    const { chooser, lists } = harness('/srv/slow');
    vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS - 1);
    expect(chooser.state()).toEqual({ at: 'reading', path: '/srv/slow' });
    vi.advanceTimersByTime(1);
    expect(chooser.state()).toEqual({ at: 'failed', path: '/srv/slow', words: 'studio has not answered yet.' });
    chooser.retry();
    expect(lists.map((ask) => ask.input.path)).toEqual(['/srv/slow', '/srv/slow']);
    expect(chooser.state()).toEqual({ at: 'reading', path: '/srv/slow' });
    vi.useRealTimers();
    await lists[0].answer(listed('/srv/slow', [file('/srv/slow/old.txt')])); // the first ask: no longer the newest
    expect(chooser.state()).toEqual({ at: 'reading', path: '/srv/slow' });
    await lists[1].answer(listed('/srv/slow', [file('/srv/slow/new.txt')]));
    expect(chooser.state()).toMatchObject({ at: 'listed', entries: [file('/srv/slow/new.txt')] });
  });

  it('an answer that comes after the bound, to the ask still the newest, lands', async () => {
    vi.useFakeTimers();
    const { chooser, lists } = harness('/srv/slow');
    vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS);
    vi.useRealTimers();
    await lists[0].answer(listed('/srv/slow', []));
    expect(chooser.state()).toMatchObject({ at: 'listed', path: '/srv/slow' });
  });
});

describe('C5: the machine not reachable', () => {
  it('a listing the link could not carry says so with the path standing; Try again lists that path again', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(dir(`${HOME}/garden-club`));
    await lists[1].answer(unreachable);
    expect(chooser.state()).toEqual({ at: 'failed', path: `${HOME}/garden-club`, words: 'studio is not reachable.' });
    expect(parentOf(chooser.state())).toBe(HOME); // ".." still works
    chooser.retry();
    expect(lists[2].input).toEqual({ appSessionId: R, path: `${HOME}/garden-club` });
  });

  it('the listed folder asked again (the link dropped while it was shown) says so, the path standing', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.retry();
    await lists[1].answer(unreachable);
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: 'studio is not reachable.' });
  });

  it('a refusal in UC-7’s words stands as it is; another error as its message', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer({ ok: false, error: { code: 'internal', message: 'Not listed: studio is in read-only mode', issues: { refusal: 'read-only' } } });
    expect(chooser.state()).toEqual({ at: 'failed', path: null, words: 'Not listed: studio is in read-only mode' });
  });
});

describe('the listing’s edges (B4)', () => {
  it('a folder its service cannot read says so, and ".." still works', async () => {
    const { chooser, lists } = harness('/var/locked');
    await lists[0].answer(refusedListing('unreadable'));
    expect(chooser.state()).toEqual({ at: 'failed', path: '/var/locked', words: 'MAWS on studio cannot read this folder.' });
    chooser.up();
    expect(lists[1].input).toEqual({ appSessionId: R, path: '/var' });
  });

  it('More… asks the page after the cursor and appends it, the selection standing', async () => {
    const { chooser, lists } = harness('/srv/many');
    const first = Array.from({ length: 3 }, (_, i) => file(`/srv/many/f${i}.txt`));
    await lists[0].answer(listed('/srv/many', first, 'f2.txt'));
    chooser.select('/srv/many/f1.txt');
    chooser.more();
    expect(lists[1].input).toEqual({ appSessionId: R, path: '/srv/many', cursor: 'f2.txt' });
    expect(chooser.state()).toMatchObject({ at: 'listed', entries: first }); // the listing stays while the page is read
    await lists[1].answer(listed('/srv/many', [file('/srv/many/g.txt')]));
    expect(chooser.state()).toMatchObject({ at: 'listed', entries: [...first, file('/srv/many/g.txt')], cursor: null, selected: '/srv/many/f1.txt' });
  });

  // Fix wave (review finding 5)
  it('a typed file on a later page of its parent: the pages are read on until it is found, then it is selected', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.go('/srv/shared/zeta.txt');
    await lists[1].answer(refusedListing('not-a-folder'));
    expect(lists[2].input).toEqual({ appSessionId: R, path: '/srv/shared' });
    await lists[2].answer(listed('/srv/shared', [file('/srv/shared/alpha.txt')], 'alpha.txt'));
    expect(lists[3].input).toEqual({ appSessionId: R, path: '/srv/shared', cursor: 'alpha.txt' });
    await lists[3].answer(listed('/srv/shared', [file('/srv/shared/zeta.txt')], 'zeta.txt'));
    expect(chooser.state()).toMatchObject({ at: 'listed', path: '/srv/shared', selected: '/srv/shared/zeta.txt', cursor: 'zeta.txt', entries: [file('/srv/shared/alpha.txt'), file('/srv/shared/zeta.txt')] });
    expect(lists).toHaveLength(4); // found: no further page is asked for it
  });

  it('a typed file not in its parent stops at the listing’s end, selecting nothing; Cancel stops the paging', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.go('/srv/shared/gone.txt');
    await lists[1].answer(refusedListing('not-a-folder'));
    await lists[2].answer(listed('/srv/shared', [file('/srv/shared/alpha.txt')], 'alpha.txt'));
    await lists[3].answer(listed('/srv/shared', [file('/srv/shared/beta.txt')]));
    expect(chooser.state()).toMatchObject({ at: 'listed', selected: null, cursor: null });
    expect(lists).toHaveLength(4);
    chooser.go('/srv/other/gone.txt');
    await lists[4].answer(refusedListing('not-a-folder'));
    await lists[5].answer(listed('/srv/other', [file('/srv/other/a.txt')], 'a.txt'));
    expect(lists).toHaveLength(7);
    chooser.cancel();
    await lists[6].answer(listed('/srv/other', [file('/srv/other/gone.txt')], 'gone.txt'));
    expect(lists).toHaveLength(7); // nothing asked after Cancel
  });

  it('a typed path that names a folder shows it; a file selects it in its parent’s listing; neither says there is nothing there', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.go('/srv/shared/notes.txt');
    await lists[1].answer(refusedListing('not-a-folder'));
    expect(lists[2].input).toEqual({ appSessionId: R, path: '/srv/shared' });
    await lists[2].answer(listed('/srv/shared', [file('/srv/shared/a.txt'), file('/srv/shared/notes.txt')]));
    expect(chooser.state()).toMatchObject({ at: 'listed', path: '/srv/shared', selected: '/srv/shared/notes.txt' });
    chooser.go('/srv/nothing');
    await lists[3].answer(refusedListing('no-folder'));
    expect(chooser.state()).toEqual({ at: 'failed', path: '/srv/nothing', words: 'There is no file or folder at that path on studio.' });
  });

  it('selects a file or a link, never a folder or a special file', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, [...AT_HOME, other(`${HOME}/pipe`)]));
    chooser.select(`${HOME}/garden-club`);
    expect(chooser.state()).toMatchObject({ selected: null });
    chooser.select(`${HOME}/pipe`);
    expect(chooser.state()).toMatchObject({ selected: null });
    chooser.select(`${HOME}/latest`);
    expect(chooser.state()).toMatchObject({ selected: `${HOME}/latest` });
    chooser.select(`${HOME}/roadmap.md`);
    expect(chooser.state()).toMatchObject({ selected: `${HOME}/roadmap.md` });
  });
});

describe('a private folder (Card 1; decision 18)', () => {
  it('asks before it is read, and nothing is asked of the machine meanwhile; Back returns to the listing', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    const shown = chooser.state();
    chooser.enter(AT_HOME[0]);
    expect(chooser.state()).toEqual({ at: 'asking', folder: AT_HOME[0] });
    expect(lists).toHaveLength(1);
    chooser.back();
    expect(chooser.state()).toBe(shown);
    expect(lists).toHaveLength(1);
  });

  it('Open reads it with open, the folder joins openedThere, and only paths under it carry open after', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(AT_HOME[0]);
    chooser.confirm();
    expect(lists[1].input).toEqual({ appSessionId: R, path: `${HOME}/Documents`, open: true });
    expect(openedThere(OTHER_MACHINE).has(`${HOME}/Documents`)).toBe(true);
    await lists[1].answer(listed(`${HOME}/Documents`, [dir(`${HOME}/Documents/minutes`), file(`${HOME}/Documents/rota.ods`)]));
    chooser.enter(dir(`${HOME}/Documents/minutes`));
    expect(lists[2].input).toEqual({ appSessionId: R, path: `${HOME}/Documents/minutes`, open: true });
    await lists[2].answer(listed(`${HOME}/Documents/minutes`, []));
    chooser.up();
    expect(lists[3].input).toEqual({ appSessionId: R, path: `${HOME}/Documents`, open: true });
    await lists[3].answer(listed(`${HOME}/Documents`, [file(`${HOME}/Documents/rota.ods`)]));
    chooser.up();
    expect(lists[4].input).toEqual({ appSessionId: R, path: HOME }); // above it: none
    await lists[4].answer(listed(HOME, AT_HOME));
    chooser.enter(AT_HOME[0]); // confirmed once this run: entered with no question
    expect(lists[5].input).toEqual({ appSessionId: R, path: `${HOME}/Documents`, open: true });
  });

  // Fix wave (review finding 4; C1): the question invalidates what was still asked for the listing behind it
  it('a More… still out when a private folder asks: its answer and its bound land nowhere, and the question stays', async () => {
    vi.useFakeTimers();
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME, 'roadmap.md'));
    chooser.more();
    expect(lists[1].input).toEqual({ appSessionId: R, path: HOME, cursor: 'roadmap.md' });
    chooser.enter(AT_HOME[0]);
    expect(chooser.state()).toEqual({ at: 'asking', folder: AT_HOME[0] });
    await lists[1].answer(listed(HOME, [file(`${HOME}/zeta.txt`)]));
    expect(chooser.state()).toEqual({ at: 'asking', folder: AT_HOME[0] });
    vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS);
    expect(chooser.state()).toEqual({ at: 'asking', folder: AT_HOME[0] });
    chooser.back();
    expect(chooser.state()).toMatchObject({ at: 'listed', path: HOME, entries: AT_HOME, cursor: 'roadmap.md' }); // the listing as shown, More… to ask again
  });

  // Fix wave (review finding 1): a path the walk would leave the confirmed folder by inherits nothing
  it('a typed path that leaves a confirmed folder by ".." is sent with no open, beside one inside it', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(AT_HOME[0]);
    chooser.confirm();
    await lists[1].answer(listed(`${HOME}/Documents`, []));
    chooser.go(`${HOME}/Documents/minutes`);
    expect(lists[2].input).toEqual({ appSessionId: R, path: `${HOME}/Documents/minutes`, open: true }); // the control
    await lists[2].answer(listed(`${HOME}/Documents/minutes`, []));
    chooser.go(`${HOME}/Documents/../Downloads`);
    expect(lists[3].input).toEqual({ appSessionId: R, path: `${HOME}/Documents/../Downloads` });
  });

  // Fix wave (review finding 3): the folder a listing that carried open ended at joins openedThere, the request's open
  // inherited from a confirmed folder included
  it('a folder listed under an inherited open joins openedThere at the real path the walk ended at', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(AT_HOME[0]);
    chooser.confirm();
    await lists[1].answer(listed(`${HOME}/Documents`, [dir(`${HOME}/Documents/minutes`)]));
    chooser.enter(dir(`${HOME}/Documents/minutes`)); // a link to a folder elsewhere: its open inherited, not asked
    expect(lists[2].input).toEqual({ appSessionId: R, path: `${HOME}/Documents/minutes`, open: true });
    await lists[2].answer(listed('/data/minutes-real', []));
    expect(openedThere(OTHER_MACHINE).has('/data/minutes-real/2026.ods')).toBe(true);
    chooser.go('/srv/plain');
    await lists[3].answer(listed('/srv/plain-real', []));
    expect(openedThere(OTHER_MACHINE).has('/srv/plain-real')).toBe(false); // the control: a listing with no open adds nothing
  });

  it('a folder entered through a link, a typed path, into a private folder asks as that folder does, then reads with open', async () => {
    const { chooser, lists } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.go('/srv/to-documents');
    await lists[1].answer(refusedListing('protected'));
    expect(chooser.state()).toEqual({ at: 'asking', folder: { name: 'to-documents', path: '/srv/to-documents', kind: 'dir', protected: true } });
    chooser.confirm();
    expect(lists[2].input).toEqual({ appSessionId: R, path: '/srv/to-documents', open: true });
    await lists[2].answer(listed(`${HOME}/Documents`, [file(`${HOME}/Documents/rota.ods`)]));
    expect(chooser.state()).toMatchObject({ at: 'listed', path: `${HOME}/Documents` });
    expect(openedThere(OTHER_MACHINE).has(`${HOME}/Documents/rota.ods`)).toBe(true); // the folder the walk ended at
  });
});

describe('the choice (C3)', () => {
  it('Open sends one choice, busy until it answers; a second Open sends nothing; the answer is the granted real path', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/roadmap.md`);
    const chosen = chooser.choose();
    expect(chooser.state()).toEqual({ at: 'choosing', path: `${HOME}/roadmap.md` });
    void chooser.choose();
    chooser.enter(dir(`${HOME}/garden-club`)); // nothing moves while the choice is in flight
    expect(chooses.map((ask) => ask.input)).toEqual([{ appSessionId: R, path: `${HOME}/roadmap.md` }]);
    expect(lists).toHaveLength(1);
    await chooses[0].answer(granted('/data/roadmap.md'));
    expect(await chosen).toBe('/data/roadmap.md');
  });

  it('Cancel while the choice is in flight answers nothing, and a grant that arrives then opens nothing', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/roadmap.md`);
    const chosen = chooser.choose();
    chooser.cancel();
    expect(await chosen).toBeNull();
    await chooses[0].answer(granted(`${HOME}/roadmap.md`));
    expect(chooser.state()).toEqual({ at: 'choosing', path: `${HOME}/roadmap.md` });
  });

  it('nothing is chosen with nothing selected', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    expect(await chooser.choose()).toBeNull();
    expect(chooses).toEqual([]);
  });

  it('a link that leads to a folder: the choice answers not-a-file, and the sheet shows that folder', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/latest`);
    const chosen = chooser.choose();
    await chooses[0].answer(refusedChoice('not-a-file'));
    expect(await chosen).toBeNull();
    expect(lists[1].input).toEqual({ appSessionId: R, path: `${HOME}/latest` });
    await lists[1].answer(listed('/data/rota/2026', [file('/data/rota/2026/week-01.ods')]));
    expect(chooser.state()).toMatchObject({ at: 'listed', path: '/data/rota/2026' });
  });

  it('a file row the machine will not grant as a file says U6e’s sentence; a file gone says there is nothing there', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/roadmap.md`);
    const chosen = chooser.choose();
    await chooses[0].answer(refusedChoice('not-a-file'));
    expect(await chosen).toBeNull();
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: 'Open File opens one file. A folder or an app’s package cannot be opened here.' });
    expect(lists).toHaveLength(1);
    chooser.retry();
    await lists[1].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/.zshrc`);
    const again = chooser.choose();
    await chooses[1].answer(refusedChoice('no-file'));
    expect(await again).toBeNull();
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: 'There is no file or folder at that path on studio.' });
  });

  it('a link whose target lies in a private folder asks first; Open chooses it again with open, and that answer is the choice’s', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/latest`);
    const chosen = chooser.choose();
    await chooses[0].answer(refusedChoice('protected'));
    expect(chooser.state()).toEqual({ at: 'asking', folder: link(`${HOME}/latest`) });
    chooser.confirm();
    expect(chooses[1].input).toEqual({ appSessionId: R, path: `${HOME}/latest`, open: true });
    await chooses[1].answer(granted('/data/Private/rota.ods'));
    expect(await chosen).toBe('/data/Private/rota.ods');
    // Fix wave (review finding 3): the granted real path, chosen under open, is one the person opened, so the tab's first
    // read of it carries open and asks nothing (viewer.test.tsx follows it through the read)
    expect(openedThere(OTHER_MACHINE).has('/data/Private/rota.ods')).toBe(true);
  });

  it('a grant chosen with no open adds nothing to openedThere', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/roadmap.md`);
    const chosen = chooser.choose();
    await chooses[0].answer(granted('/data/roadmap.md'));
    expect(await chosen).toBe('/data/roadmap.md');
    expect(openedThere(OTHER_MACHINE).has('/data/roadmap.md')).toBe(false);
  });

  it('Back from that question answers no choice, and nothing more is asked', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/latest`);
    const chosen = chooser.choose();
    await chooses[0].answer(refusedChoice('protected'));
    chooser.back();
    expect(await chosen).toBeNull();
    expect(chooser.state()).toMatchObject({ at: 'listed', path: HOME });
    expect(chooses).toHaveLength(1);
  });

  it('a choice under a folder confirmed this run carries open', async () => {
    const { chooser, lists, chooses } = harness();
    openedThere(OTHER_MACHINE).add(`${HOME}/Documents`);
    await lists[0].answer(listed(`${HOME}/Documents`, [file(`${HOME}/Documents/rota.ods`)]));
    chooser.select(`${HOME}/Documents/rota.ods`);
    void chooser.choose();
    expect(chooses[0].input).toEqual({ appSessionId: R, path: `${HOME}/Documents/rota.ods`, open: true });
  });

  it('a choice that could not be carried says so, and returns no path', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/roadmap.md`);
    const chosen = chooser.choose();
    await chooses[0].answer({ ok: false, error: { code: 'host_unavailable', message: 'files.chooseOutside: machine studio is not reachable' } });
    expect(await chosen).toBeNull();
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: 'studio is not reachable.' });
  });
});

// Fix wave (review finding 2): the outside acts are offered to the machine's owners alone, asked again before each request
describe('the offer withdrawn while the chooser is open', () => {
  const ONLY = 'Only studio’s owners can open a file there.';

  it('withdraw shows the sentence where the list stands, and no listing, choice or Try again sends anything after', async () => {
    const offer = { words: null as string | null };
    const { chooser, lists, chooses } = harness(null, offer);
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.more(); // no cursor: nothing
    offer.words = ONLY;
    chooser.withdraw(ONLY);
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: ONLY });
    chooser.retry();
    chooser.go('/srv/shared');
    chooser.enter(dir(`${HOME}/garden-club`));
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: ONLY });
    expect(lists).toHaveLength(1);
    expect(chooses).toHaveLength(0);
  });

  it('a request is not sent while the offer has a sentence, even before the sheet heard of it; with none it is (the control)', async () => {
    const offer = { words: null as string | null };
    const { chooser, lists, chooses } = harness(null, offer);
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(dir(`${HOME}/garden-club`));
    expect(lists).toHaveLength(2); // the control
    await lists[1].answer(listed(`${HOME}/garden-club`, [file(`${HOME}/garden-club/a.txt`)]));
    chooser.select(`${HOME}/garden-club/a.txt`);
    offer.words = ONLY;
    expect(await chooser.choose()).toBeNull();
    expect(chooses).toHaveLength(0);
    expect(chooser.state()).toEqual({ at: 'failed', path: `${HOME}/garden-club`, words: ONLY });
  });

  it('a choice in flight when the offer is withdrawn answers nothing, and its grant opens nothing', async () => {
    const { chooser, lists, chooses } = harness();
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.select(`${HOME}/roadmap.md`);
    const chosen = chooser.choose();
    chooser.withdraw(ONLY);
    await chooses[0].answer(granted('/data/roadmap.md'));
    expect(await chosen).toBeNull();
    expect(chooser.state()).toEqual({ at: 'failed', path: HOME, words: ONLY });
  });
});

describe('parentOf: where ".." leads', () => {
  it('the listing’s parent; the asked path’s while it reads or failed; none at the root or with no path', () => {
    expect(parentOf({ at: 'listed', path: '/srv/a', parent: '/srv', home: HOME, entries: [], cursor: null, selected: null })).toBe('/srv');
    expect(parentOf({ at: 'listed', path: '/', parent: null, home: HOME, entries: [], cursor: null, selected: null })).toBeNull();
    expect(parentOf({ at: 'reading', path: '/srv/a/b' })).toBe('/srv/a');
    expect(parentOf({ at: 'failed', path: '/srv', words: '' })).toBe('/');
    expect(parentOf({ at: 'failed', path: '~/notes', words: '' })).toBe('~');
    expect(parentOf({ at: 'reading', path: null })).toBeNull();
    expect(parentOf({ at: 'reading', path: '/' })).toBeNull();
  });
});
