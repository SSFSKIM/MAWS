// The chooser's sheet for a session on another machine (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E "The chooser's layout"; Card 1 as the
// owner answered it). Structure only: which element holds what in each state, More… outside the list's element, the
// titles, the mark's component and a link row's second act; the sizes are the scene's. Over the real model, whose
// listings and choices the test answers by hand. Invented names and paths.
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import type { OutsideEntry } from '@shared/ipc/schema/files';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { deferred } from '../../../test-support/code';
import { leaveRl2, overRl2, rosterSays } from '../../../test-support/code-disk';
import { forgetOpenedThere } from './elsewhere';
import { RemoteChooser } from './RemoteChooser';
import { createRemoteChooser, forgetStarts, type ChooseInput, type ListInput } from './remote-chooser';

const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const HOME = '/home/someone';
type Listing = CommandResult<'files.listOutside'>;
type Choice = CommandResult<'files.chooseOutside'>;
const entry = (path: string, kind: OutsideEntry['kind'] = 'file', isPrivate = false): OutsideEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind, protected: isPrivate });
const listed = (path: string, entries: OutsideEntry[], cursor: string | null = null): Listing => ({ ok: true, value: { status: 'listed', path, parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/', home: HOME, entries, cursor } });
const LONG = 'north-field-watering-rota-plots-one-to-forty-eight-autumn-term-final-copy.ods';
const AT_HOME = [entry(`${HOME}/Documents`, 'dir', true), entry(`${HOME}/garden-club`, 'dir'), entry(`${HOME}/latest`, 'link'), entry(`${HOME}/roadmap.md`), entry(`${HOME}/${LONG}`), entry(`${HOME}/pipe`, 'other')];

let lists: { input: ListInput; answer(result: Listing): Promise<void> }[];
let chooses: { input: ChooseInput; answer(result: Choice): Promise<void> }[];
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function open() {
  lists = [];
  chooses = [];
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
    startAt: null,
  });
  const onClose = vi.fn();
  const onChosen = vi.fn();
  render(<RemoteChooser appSessionId={R} chooser={chooser} onClose={onClose} onChosen={onChosen} />);
  return { chooser, onClose, onChosen };
}

const sheet = () => document.querySelector<HTMLElement>('[data-remote-chooser]')!;
const list = () => sheet().querySelector<HTMLElement>('[data-chooser-list]');
const rows = () => [...(list()?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])];
const row = (name: string) => rows().find((element) => element.getAttribute('title') === name)!;
const more = () => sheet().querySelector<HTMLButtonElement>('[data-chooser-more]')!;
const field = () => sheet().querySelector<HTMLInputElement>('[data-chooser-path]')!;
const button = (name: string) => within(sheet()).getByRole('button', { name });

beforeEach(() => {
  resetRemoteLaneBStore();
  overRl2(R);
  forgetOpenedThere();
  forgetStarts();
});
afterEach(() => {
  cleanup();
  leaveRl2();
});

describe('the chooser’s sheet', () => {
  it('is a sheet titled by the machine, with the path field, Go, the list’s area, More…, the foot, Cancel and Open', async () => {
    open();
    await lists[0].answer(listed(HOME, AT_HOME, 'pipe'));
    expect(within(sheet()).getByRole('heading', { name: 'Open a file on studio' })).toBeTruthy();
    expect(field()).toBeTruthy();
    expect(button('Go')).toBeTruthy();
    expect(list()).toBeTruthy();
    expect(more().textContent).toBe('More…');
    expect(list()!.contains(more())).toBe(false); // under the list, outside its scroll
    expect(sheet().textContent).toContain('Files on studio, read as its MAWS service can read them.');
    expect(button('Cancel')).toBeTruthy();
    expect(button('Open')).toBeTruthy();
  });

  it('draws a row per entry, ".." first: a folder’s mark the Files list’s chevron, every other mark slot empty, private and link at the right, the whole name as the title', async () => {
    open();
    await lists[0].answer(listed(HOME, AT_HOME));
    const up = list()!.querySelector<HTMLElement>('[data-up]')!;
    expect(up.textContent).toContain('..');
    expect(list()!.firstElementChild).toBe(up);
    expect(rows().map((element) => [element.getAttribute('title'), element.getAttribute('data-kind')])).toEqual(AT_HOME.map((e) => [e.name, e.kind]));
    for (const element of rows()) {
      const mark = element.firstElementChild!;
      if (element.getAttribute('data-kind') === 'dir') {
        expect(mark.tagName.toLowerCase()).toBe('svg');
        expect(mark.getAttribute('class')).not.toContain('rotate-90'); // closed, never rotated
      } else expect(mark.tagName.toLowerCase()).toBe('span');
    }
    expect(row('Documents').textContent).toBe('Documentsprivate');
    expect(row('latest').textContent).toBe('latestlink'); // and no target
    expect(row(LONG).querySelector('.truncate')?.textContent).toBe(LONG); // cut at its end by the row's own truncation
    expect((row('pipe') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps More…’s place with no further page, and shows it with one', async () => {
    const { chooser } = open();
    await lists[0].answer(listed(HOME, AT_HOME));
    expect(more().className).toContain('invisible');
    expect(more().disabled).toBe(true);
    chooser.go('/srv/many');
    await lists[1].answer(listed('/srv/many', [entry('/srv/many/a.txt')], 'a.txt'));
    expect(more().className).not.toContain('invisible');
    fireEvent.click(more());
    expect(lists[2].input).toEqual({ appSessionId: R, path: '/srv/many', cursor: 'a.txt' });
  });

  it('holds its states inside the list’s area: the reading words and the failures with Try again, ".." first where a parent is known', async () => {
    const { chooser } = open();
    expect(list()!.textContent).toContain('Reading the folders…');
    await lists[0].answer(listed(HOME, AT_HOME));
    chooser.enter(entry(`${HOME}/garden-club`, 'dir'));
    await settle();
    expect(list()!.querySelector('[data-up]')).not.toBeNull();
    expect(list()!.textContent).toContain('Reading the folders…');
    await lists[1].answer({ ok: true, value: { status: 'refused', reason: 'unreadable' } });
    expect(list()!.textContent).toContain('MAWS on studio cannot read this folder.');
    expect(list()!.querySelector('[data-up]')).not.toBeNull();
    fireEvent.click(within(list()!).getByRole('button', { name: 'Try again' }));
    expect(lists[2].input).toEqual({ appSessionId: R, path: `${HOME}/garden-club` });
    await lists[2].answer({ ok: false, error: { code: 'host_unavailable', message: 'gone' } });
    expect(list()!.textContent).toContain('studio is not reachable.');
    expect(within(list()!).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a private folder’s question takes the place of the list and the footer, with Back and Open', async () => {
    open();
    await lists[0].answer(listed(HOME, AT_HOME));
    fireEvent.click(row('Documents'));
    await settle();
    expect(list()).toBeNull();
    expect(sheet().textContent).toContain('Open Documents on studio? macOS protects this folder, and opening it may show a privacy prompt on studio’s own screen.');
    expect(sheet().textContent).not.toContain('Files on studio, read as');
    expect(within(sheet()).getAllByRole('button', { name: 'Open' })).toHaveLength(1);
    fireEvent.click(button('Back'));
    await settle();
    expect(list()).not.toBeNull();
    fireEvent.click(row('Documents'));
    await settle();
    fireEvent.click(button('Open'));
    expect(lists[1].input).toEqual({ appSessionId: R, path: `${HOME}/Documents`, open: true });
  });

  it('a click on a folder enters it; on a file or a link selects it, Open then choosing it; a double click chooses at once', async () => {
    const { onChosen } = open();
    await lists[0].answer(listed(HOME, AT_HOME));
    expect(button('Open').hasAttribute('disabled')).toBe(true);
    fireEvent.click(row('roadmap.md'));
    await settle();
    expect(row('roadmap.md').getAttribute('aria-selected')).toBe('true');
    expect(button('Open').hasAttribute('disabled')).toBe(false);
    fireEvent.click(button('Open'));
    await settle();
    expect(chooses.map((ask) => ask.input)).toEqual([{ appSessionId: R, path: `${HOME}/roadmap.md` }]);
    expect(button('Open').hasAttribute('disabled')).toBe(true); // busy until it answers
    expect(button('Open').getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button('Open'));
    expect(chooses).toHaveLength(1);
    await chooses[0].answer({ ok: true, value: { status: 'granted', path: '/data/roadmap.md' } });
    expect(onChosen).toHaveBeenCalledExactlyOnceWith('/data/roadmap.md');
  });

  it('a link row’s double click asks the machine to choose it; where it leads to a folder, the sheet shows that folder', async () => {
    const { onChosen } = open();
    await lists[0].answer(listed(HOME, AT_HOME));
    fireEvent.doubleClick(row('latest'));
    await settle();
    expect(chooses.map((ask) => ask.input)).toEqual([{ appSessionId: R, path: `${HOME}/latest` }]);
    await chooses[0].answer({ ok: true, value: { status: 'refused', reason: 'not-a-file' } });
    expect(lists[1].input).toEqual({ appSessionId: R, path: `${HOME}/latest` });
    await lists[1].answer(listed('/data/rota', [entry('/data/rota/week-01.ods')]));
    expect(rows().map((element) => element.getAttribute('title'))).toEqual(['week-01.ods']);
    expect(field().value).toBe('/data/rota'); // the folder’s real path
    expect(onChosen).not.toHaveBeenCalled();
    fireEvent.click(rows()[0]);
    await settle();
    fireEvent.doubleClick(rows()[0]);
    expect(chooses).toHaveLength(2);
  });

  it('the path field holds the folder shown (the home as ~), and a typed path is asked on Enter or Go', async () => {
    open();
    await lists[0].answer(listed(`${HOME}/garden-club`, []));
    expect(field().value).toBe('~/garden-club');
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '/srv/shared' } });
    fireEvent.submit(field().closest('form')!);
    expect(lists[1].input).toEqual({ appSessionId: R, path: '/srv/shared' });
    fireEvent.change(field(), { target: { value: '~/notes' } });
    fireEvent.click(button('Go'));
    expect(lists[2].input).toEqual({ appSessionId: R, path: '~/notes' });
  });

  it('".." lists the folder above', async () => {
    open();
    await lists[0].answer(listed(`${HOME}/garden-club`, []));
    fireEvent.click(list()!.querySelector('[data-up]')!);
    expect(lists[1].input).toEqual({ appSessionId: R, path: HOME });
  });

  it('Cancel closes the sheet; a late answer lands nowhere', async () => {
    const { onClose } = open();
    fireEvent.click(button('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('C5: the link dropping while a folder is shown asks that folder again, and the list’s place says the machine is not reachable, the path standing', async () => {
    open();
    await lists[0].answer(listed(`${HOME}/garden-club`, [entry(`${HOME}/garden-club/a.txt`)]));
    act(() => rosterSays(R, { state: 'down', generation: 1, since: new Date(Date.now() - 120_000).toISOString(), capabilities: undefined }));
    expect(lists[1].input).toEqual({ appSessionId: R, path: `${HOME}/garden-club` });
    await lists[1].answer({ ok: false, error: { code: 'host_unavailable', message: 'files.listOutside: machine studio is not reachable' } });
    expect(list()!.textContent).toContain('studio is not reachable.');
    expect(field().value).toBe('~/garden-club');
  });
});
