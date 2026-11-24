// The Channel tab (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's Proves, "The renderer":
// the tab opens once per project; Channel shows only with a smnsId; the composer is withdrawn offline; the inline native
// ask answers), with the tab's hold paired with its mount, main's deltas over the open answer, words sent and refused,
// and "Not sent" where main says a word wasn't (each word's state is main's alone).
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDayTime } from '@shared/app/date-format';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelHost, ChannelSession, OrgMember } from '@shared/ipc/schema/org';
import { tabId } from '@shared/ipc/schema/layout';
import type { OrgKey } from '@shared/machine/org-key';
import { project, record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { registerSlot, resetSlots } from '../app/slots';
import { RequestCard } from '../request-card';
import { askItemFor, askOpened } from '../request-card/test-requests';
import { Sidebar } from '../sidebar/Sidebar';
import { useAttention } from '../stores/attention';
import { useHubAccess, type HubAccess } from '../stores/hub-access';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { fillStores, resetShellStores } from '../test-support/shell-stores';
import { resetAskSheets } from '../tools/maws/ask/store';
import { ChannelView } from './ChannelView';
import { useChannelTitle } from './title';
import { ipc } from '../ipc/client'; // the question sheet's C3 M4
import { CLASH, FIXTURE, sheetOf } from '../sheet/test-support/questions';
import { connectSheets, resetSheetStore } from '../stores/sheet';

const SMNS = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const KEY = `smns:${SMNS}` as OrgKey;
const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ME: OrgMember = { id: 'owner0000000000000000000000000000', email: 'sam@example.com', name: 'Sam' };
const ANA: OrgMember = { id: 'ana00000000000000000000000000000', email: 'ana@example.com', name: 'Ana' };
const T = (minute: number) => new Date(Date.UTC(2026, 10, 6, 12, minute)).toISOString();
const SESSIONS: ChannelSession[] = [
  { session: S1, alias: 'maws-45', machine: 'mini', title: 'Fix the relay', member: true, authenticated: true },
  { session: S2, alias: 'ci-opt', machine: 'mini', title: null, member: true, authenticated: true },
];
const say = (offset: number, from: string, to: string, minute: number, extra: Partial<ChannelEvent> = {}): ChannelEvent => ({
  offset, writer: `mini/${from}`, seq: offset, session: from, label: 'verified', owners: [ME],
  event: { kind: 'say', writer: `mini/${from}`, seq: offset, from: 'x', to: [{ session: to, alias: 'y' }], text: `say ${offset}`, ts: T(minute) }, ...extra,
});
const human = (offset: number, member: OrgMember, text: string, extra: Record<string, unknown> = {}): ChannelEvent => ({
  offset, writer: `hub/${member.id}`, seq: offset, label: 'verified', author: member,
  event: { kind: 'human', writer: `hub/${member.id}`, seq: offset, from: 'human', member: member.id, to: '*', text, ts: T(offset), ...extra },
});
const opened = (over: Partial<Extract<ChannelAnswer, { ok: true }>> = {}): ChannelAnswer => ({ ok: true, rev: 10, events: [], sessions: SESSIONS, pending: [], unverified: 0, asOf: T(30), live: true, ...over });
let rev = 10; // main's count: each change numbered past the open answers' 10
const change = (over: Partial<Extract<ChannelChanged, { ok: true }>> = {}): ChannelChanged => ({ project: SMNS, ok: true, rev: (rev += 1), upserts: [], removed: [], sessions: SESSIONS, pending: [], unverified: 0, asOf: T(30), live: true, ...over });

let fake: FakeClient;
const install = (given: Parameters<typeof fakeClient>[0] = {}) => {
  fake = fakeClient({ 'org.channel.close': undefined, ...given });
  window.maws = fake.client as unknown as PreloadBridge;
};
const stream = () => document.querySelector<HTMLElement>(`[data-channel="${SMNS}"]`)!;
const entries = () => [...stream().querySelectorAll<HTMLElement>('[data-channel-entry]')].map((e) => `${e.dataset.channelEntry}:${e.dataset.offset ?? '-'}`);
const tell = (payload: ChannelChanged) => act(() => fake.event('org.channel.changed', payload));

beforeEach(() => {
  resetShellStores();
  useHubAccess.setState({ access: 'connected', member: ME.id });
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the tab’s hold', () => {
  it('opens the project’s channel at mount and closes it at unmount, once each', async () => {
    install();
    const view = render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened()));
    expect(fake.invoked('org.channel.open')).toEqual([{ project: SMNS }]);
    expect(fake.invoked('org.channel.close')).toEqual([]);
    view.unmount();
    expect(fake.invoked('org.channel.close')).toEqual([{ project: SMNS }]);
  });

  it('draws the open answer, then each delta over it; a change heard before the answer applies on top of it', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    tell({ ...change({ upserts: [human(2, ANA, 'stale')], reset: true, unverified: 7, live: false }), rev: 4 }); // told before the answer: older than it
    tell(change({ upserts: [human(9, ANA, 'early')] })); // told after the answer, heard before it: applied on top
    tell({ ...change({ upserts: [human(50, ANA, 'another project')] }), project: 'other' });
    await act(() => fake.reply('org.channel.open', opened({ events: [say(1, S1, S2, 0), say(2, S2, S1, 1), human(3, ANA, 'hi all')] })));
    expect(entries()).toEqual(['exchange:1', 'words:3', 'words:9']);
    expect(screen.queryByText(/didn’t verify/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message the project' })).toBeTruthy();
    tell(change({ upserts: [human(4, ME, 'mine')], removed: [3], unverified: 2 }));
    expect(entries()).toEqual(['exchange:1', 'words:4', 'words:9']);
    expect(screen.getByText('2 events didn’t verify')).toBeTruthy();
    expect(within(stream()).getByText('You')).toBeTruthy();
    tell(change({ upserts: [say(7, S1, S2, 3, { label: 'migrated', by: 'mini' })], reset: true }));
    expect(entries()).toEqual(['say:7']);
    expect(screen.getByText('attested at migration by mini')).toBeTruthy();
  });

  it('a folded exchange opens its messages in place on a click', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened({ events: [say(1, S1, S2, 0), say(2, S2, S1, 1), say(3, S1, S2, 2)] })));
    // the word cut (P448): "<name> and <name> · 3", the count named by its meaning
    const fold = screen.getByRole('button', { name: /maws-45/ });
    expect(fold.textContent).not.toContain('messages');
    const count = within(fold).getByRole('img', { name: '3 messages' });
    expect(count.textContent).toBe('3');
    // in order: the one name, "and", the other, the dot, the count, then the time
    expect(fold.textContent!.slice(0, fold.textContent!.indexOf('·'))).toMatch(/maws-45.*and.*ci-opt/);
    expect(count.previousElementSibling!.textContent).toBe('·');
    // pair review of M3's pictures: the count follows the names, in their group, and the group's room is left after it,
    // so the count is not carried to the far end beside the time
    const names = count.closest<HTMLElement>('[data-names]')!;
    expect(names.parentElement).toBe(fold);
    expect(names.lastElementChild).toBe(count);
    expect(names.nextElementSibling!.tagName).toBe('TIME');
    act(() => fold.focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe('3 messages');
    expect(screen.queryByText('say 2')).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(within(stream().querySelector<HTMLElement>('[data-channel-exchange-messages]')!).getAllByRole('listitem')).toHaveLength(3);
  });

  // the word cut (P447): the default audience is not said, on a message nor on a folded run of them
  it('a message to the whole project, and a folded run of them, carry no “to everyone”', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    const all = (offset: number, minute: number): ChannelEvent => {
      const event = say(offset, S1, S2, minute);
      return { ...event, event: { ...event.event, to: '*' } as ChannelEvent['event'] };
    };
    await act(() => fake.reply('org.channel.open', opened({ events: [all(1, 0)] })));
    expect(entries()).toEqual(['say:1']);
    expect(stream().textContent).not.toContain('to everyone');
    tell(change({ upserts: [all(1, 0), all(2, 1), all(3, 2)], reset: true }));
    expect(entries()).toEqual(['exchange:1']);
    const run = screen.getByRole('button', { name: /maws-45/ });
    expect(run.textContent).not.toMatch(/everyone|messages/);
    const runCount = within(run).getByRole('img', { name: '3 messages' });
    expect(runCount.textContent).toBe('3');
    expect(runCount.closest('[data-names]')?.lastElementChild).toBe(runCount); // "<name> · 3", the count beside the name
  });

  // the word cut (P457): the first read is a quiet spinner named by its words
  it('while the channel is first read, a quiet spinner stands in the stream’s place', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    expect(stream().textContent).not.toContain('Reading the channel…');
    expect(await within(stream()).findByRole('progressbar', { name: 'Reading the channel…' })).toBeTruthy();
    await act(() => fake.reply('org.channel.open', opened()));
    expect(within(stream()).queryByRole('progressbar')).toBeNull();
  });

  it('says why there is nothing to draw', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', { ok: false, reason: 'unknown-project', rev: 10 }));
    expect(stream().querySelector('[data-channel-closed="unknown-project"]')).toBeTruthy();
  });

  // N169: a channel this Mac cannot reach the hub for and never loaded reads as the open one never loaded does (N168)
  it('says a channel with no hub and nothing loaded is not connected and not loaded on this Mac yet', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', { ok: false, reason: 'no-hub', rev: 10 }));
    expect(stream().querySelector('[data-channel-closed="no-hub"]')?.textContent).toBe('Not connected to the hub, and not loaded on this Mac yet.');
  });
});

describe('offline', () => {
  it('withdraws the composer and draws what main holds as of its last catch-up', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened({ events: [human(1, ANA, 'cached')], live: false })));
    act(() => useHubAccess.setState({ access: 'unreachable' }));
    expect(screen.queryByRole('textbox', { name: 'Message the project' })).toBeNull();
    expect(stream().querySelector(`[data-channel-as-of="${T(30)}"]`)?.textContent).toBe(`As of ${formatDayTime(Date.parse(T(30)))}`);
    expect(within(stream().querySelector<HTMLElement>('[data-channel-offline]')!).getByText('Offline · retrying')).toBeTruthy();
    tell(change({ live: true }));
    expect(screen.getByRole('textbox', { name: 'Message the project' })).toBeTruthy();
  });

  it('an ended hub sign-in offers Sign in to the hub again, the Org page’s own action', async () => {
    install({ 'org.signIn': { ok: false, reason: { code: 'access' } } });
    useHubAccess.setState({ access: 'expired' });
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened({ live: false })));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to the hub again' }));
    expect(fake.invoked('org.signIn')).toEqual([undefined]);
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t sign in · access');
  });
});

// UX wave U11a M4 (S-09; Interfaces §F, "The footer"): while not live, after "As of <time>", the first that holds: signed
// out; the hub sign-in ended (its button) from the channel's refusal or the org's hub status; the hub no longer admitting
// the member, the same; "Offline · retrying" from the channel's reach or the hub status; else "Connecting…".
describe('the footer’s words', () => {
  type Given = { member?: string | null; access: HubAccess | null; reach?: 'connecting' | 'unreachable'; refused?: 'credentials' | 'removed' };
  const SIGN_IN = 'Sign in to the hub again';
  const footers: Array<[string, Given, string]> = [
    ['signed out, whatever the channel says', { member: null, access: 'connected', reach: 'unreachable', refused: 'credentials' }, 'Signed out'],
    ['refused for the sign-in while the hub status reads connected and the reach unreachable', { access: 'connected', reach: 'unreachable', refused: 'credentials' }, `The hub sign-in has ended.${SIGN_IN}`],
    ['the hub status expired', { access: 'expired', reach: 'connecting' }, `The hub sign-in has ended.${SIGN_IN}`],
    ['the ended sign-in before a member no longer admitted', { access: 'expired', reach: 'unreachable', refused: 'removed' }, `The hub sign-in has ended.${SIGN_IN}`],
    ['refused for a member no longer admitted while the hub status reads connected and the reach unreachable', { access: 'connected', reach: 'unreachable', refused: 'removed' }, 'The hub no longer admits you.'],
    ['the hub status denied', { access: 'denied', reach: 'connecting' }, 'The hub no longer admits you.'],
    ['the channel unreachable while the hub status reads connected', { access: 'connected', reach: 'unreachable' }, 'Offline · retrying'],
    ['the hub status unreachable while the channel is connecting', { access: 'unreachable', reach: 'connecting' }, 'Offline · retrying'],
    ['the channel connecting', { access: 'connected', reach: 'connecting' }, 'Connecting…'],
    ['the hub status connecting, with no reach told', { access: 'connecting' }, 'Connecting…'],
  ];
  const footer = () => stream().querySelector<HTMLElement>('[data-channel-offline]')!;
  const asOf = `As of ${formatDayTime(Date.parse(T(30)))}·`;

  it.each(footers)('reads, while not live: %s', async (_, given, words) => {
    install();
    useHubAccess.setState({ access: given.access, member: given.member === undefined ? ME.id : given.member });
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened({ live: false, ...(given.reach === undefined ? {} : { reach: given.reach }), ...(given.refused === undefined ? {} : { refused: given.refused }) })));
    expect(footer().textContent).toBe(`${asOf}${words}`);
  });

  it('follows each change: connecting, then offline and retrying, then the refusal, and the composer back once live', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened({ live: false, reach: 'connecting' })));
    expect(footer().textContent).toBe(`${asOf}Connecting…`);
    tell(change({ live: false, reach: 'unreachable' }));
    expect(footer().textContent).toBe(`${asOf}Offline · retrying`);
    tell(change({ live: false, reach: 'unreachable', refused: 'credentials' }));
    expect(footer().textContent).toBe(`${asOf}The hub sign-in has ended.${SIGN_IN}`);
    tell(change({ live: false, reach: 'connecting' }));
    expect(footer().textContent).toBe(`${asOf}Connecting…`);
    tell(change({ live: true }));
    expect(stream().querySelector('[data-channel-offline]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message the project' })).toBeTruthy();
  });

  it('says a channel open with nothing held and never caught up is not loaded on this Mac yet; one caught up with nothing says it is empty (N168)', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened({ asOf: null, live: false, reach: 'unreachable' })));
    expect(within(stream()).getByText('Not loaded on this Mac yet.')).toBeTruthy();
    expect(within(stream()).queryByText('Nothing in this channel yet.')).toBeNull();
    expect(footer().textContent).toBe('Offline · retrying'); // no "As of" before it: never caught up
    tell(change({ asOf: T(31), live: true }));
    expect(within(stream()).getByText('Nothing in this channel yet.')).toBeTruthy();
    expect(within(stream()).queryByText('Not loaded on this Mac yet.')).toBeNull();
  });
});

describe('people’s words', () => {
  const composer = () => screen.getByRole('textbox', { name: 'Message the project' }) as HTMLTextAreaElement;
  const mount = async (answer = opened()) => {
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', answer));
  };

  it('sends on Enter and clears; a refusal of main’s shows under the field and keeps the text', async () => {
    install({ 'org.channel.send': ({ text }: { text: string }) => (text.startsWith('@nobody') ? { ok: false, reason: 'no-member', detail: '@nobody' } : { ok: true, nonce: 'n1' }) });
    await mount();
    await userEvent.type(composer(), '@nobody hello{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('No session here answers to @nobody');
    expect(composer().value).toBe('@nobody hello');
    await userEvent.clear(composer());
    await userEvent.type(composer(), 'line one{Shift>}{Enter}{/Shift}line two{Enter}');
    await waitFor(() => expect(fake.invoked('org.channel.send').at(-1)).toEqual({ project: SMNS, text: 'line one\nline two' }));
    await waitFor(() => expect(composer().value).toBe(''));
  });

  it('a word reads sending until main lets it go, its refusal under it, and the logged copy replaces it', async () => {
    install({ 'org.channel.send': { ok: true, nonce: 'n1' } });
    await mount();
    await userEvent.type(composer(), 'status?{Enter}');
    tell(change({ pending: [{ nonce: 'n1', text: 'status?', to: '*', state: 'sending' }, { nonce: 'n0', text: 'hidden', to: [{ session: S2, alias: 'ci-opt' }], state: { refused: 'not-reachable' } }] }));
    const words = () => [...stream().querySelectorAll<HTMLElement>('[data-channel-entry="words"]')].map((e) => [e.textContent?.includes('status?') ? 'status?' : 'hidden', e.dataset.wordState]);
    expect(words()).toEqual([['status?', 'sending'], ['hidden', 'refused']]);
    expect(screen.getByText('Not reachable')).toBeTruthy();
    tell(change({ pending: [{ nonce: 'n1', text: 'status?', to: '*', state: 'sent' }, { nonce: 'n0', text: 'hidden', to: [{ session: S2, alias: 'ci-opt' }], state: { refused: 'not-reachable' } }] })); // acknowledged
    expect(words()).toEqual([['status?', 'sent'], ['hidden', 'refused']]);
    tell(change({ upserts: [human(5, ME, 'status?', { nonce: 'n1' })], pending: [] }));
    expect(entries()).toEqual(['words:5']);
  });

  // the word cut (P460): Send is the message box's round arrow, "Send" its name and tooltip; while it goes, a spinner
  it('Send is the message box’s arrow, named Send; while a word goes it is a spinner', async () => {
    install(); // each send answered when the test says
    await mount();
    const send = () => screen.getByRole('button', { name: /^Send/ }) as HTMLButtonElement;
    expect(send().textContent).toBe('');
    expect(send().getAttribute('aria-label')).toBe('Send');
    // greyed with nothing typed, yet in the Tab order, its tooltip reached by the keyboard, its press sending nothing
    expect(send().getAttribute('aria-disabled')).toBe('true');
    expect(send().disabled).toBe(false);
    await userEvent.click(composer());
    await userEvent.tab();
    expect(document.activeElement).toBe(send());
    expect((await screen.findByRole('tooltip')).textContent).toBe('Send');
    await userEvent.keyboard('{Enter}');
    expect(fake.invoked('org.channel.send')).toHaveLength(0);
    await userEvent.type(composer(), 'first');
    expect(send().getAttribute('aria-disabled')).toBeNull();
    act(() => send().focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe('Send');
    await userEvent.type(composer(), '{Enter}');
    await waitFor(() => expect(fake.invoked('org.channel.send')).toHaveLength(1));
    expect(send().getAttribute('aria-label')).toBe('Sending…');
    expect(send().getAttribute('aria-busy')).toBe('true');
    expect(send().querySelector('.animate-spin')).not.toBeNull();
    await act(() => fake.reply('org.channel.send', { ok: true, nonce: 'n1' }));
    expect(send().getAttribute('aria-label')).toBe('Send');
  });

  it('keeps what is typed while a send is in flight, clearing only the text it sent', async () => {
    install(); // each send answered when the test says
    await mount();
    await userEvent.type(composer(), 'first{Enter}');
    await waitFor(() => expect(fake.invoked('org.channel.send')).toHaveLength(1));
    await userEvent.type(composer(), ' and more');
    await act(() => fake.reply('org.channel.send', { ok: true, nonce: 'n1' }));
    expect(composer().value).toBe('first and more');
    await userEvent.clear(composer());
    await userEvent.type(composer(), 'second{Enter}');
    await waitFor(() => expect(fake.invoked('org.channel.send')).toHaveLength(2));
    await act(() => fake.reply('org.channel.send', { ok: true, nonce: 'n2' }));
    expect(composer().value).toBe('');
  });

  // Fix round 2: main is the one source of a word's state; the tab remembers no word of its own
  it('draws a word Not sent only where main says so; one main no longer lists reads nothing at the next open', async () => {
    install({ 'org.channel.send': { ok: true, nonce: 'n1' } });
    await mount();
    await userEvent.type(composer(), 'lost one{Enter}');
    await waitFor(() => expect(fake.invoked('org.channel.send')).toHaveLength(1));
    tell(change({ pending: [{ nonce: 'n1', text: 'lost one', to: '*', state: 'sending' }], live: false })); // the hub went away before any answer
    cleanup();
    install();
    await mount(opened()); // main lists nothing: another member signed in, or the word was acknowledged and dropped
    expect(stream().querySelector('[data-word-state]')).toBeNull();
    cleanup();
    install();
    await mount(opened({ pending: [{ nonce: 'n1', text: 'lost one', to: '*', state: 'not-sent' }] }));
    const lost = stream().querySelector<HTMLElement>('[data-word-state="not-sent"]')!;
    expect(lost.textContent).toContain('lost one');
    expect(within(lost).getByText('Not sent')).toBeTruthy();
  });
});

describe('Waiting on you', () => {
  const MAWS = project('maws', 0, { org: { key: KEY, name: 'MAWS', source: 'smns', smnsId: SMNS } });
  const OTHER = project('other', 1);
  const mine = record('s-mine', { projectId: MAWS.id, title: { text: 'Release notes', source: 'user' } });
  const elsewhere = record('s-else', { projectId: OTHER.id });
  const event = askOpened();

  beforeEach(() => {
    resetAskSheets();
    registerSlot('requestCard', RequestCard);
    fillStores({ projects: [MAWS, OTHER], sessions: [mine, elsewhere], digests: [], engine: [], attention: [], timeline: [] });
    useAttention.getState().applyChanged({ appSessionId: at(mine.appId), items: [askItemFor(event, at(mine.appId))] }, TEST_MACHINE);
    useAttention.getState().applyChanged({ appSessionId: at(elsewhere.appId), items: [askItemFor(askOpened({ requestId: 'req-else' as never }), at(elsewhere.appId))] }, TEST_MACHINE);
  });
  afterEach(() => {
    resetSlots();
    resetAskSheets();
  });

  it('holds the project’s own waiting cards, a MAWS ask answered in place through maws.ask.answer', async () => {
    install({
      'attention.request': { event },
      'maws.asks.list': { asks: [{ askId: event.askId, toolUseId: event.toolUseId, requestId: event.requestId, title: event.title, context: event.context, blocking: event.blocking, questions: event.questions, openedAt: event.at }] },
    });
    render(<ChannelView project={SMNS} />);
    await act(() => fake.reply('org.channel.open', opened()));
    const waiting = stream().querySelector<HTMLElement>('[data-channel-waiting]')!;
    expect(waiting.querySelectorAll('[data-channel-card]')).toHaveLength(1);
    expect(within(waiting).getByText('Release notes')).toBeTruthy();
    await userEvent.click(await within(waiting).findByRole('radio', { name: 'Blue' }));
    await userEvent.type(within(waiting).getByRole('textbox', { name: 'What title?' }), 'v2');
    await userEvent.click(within(waiting).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(fake.invoked('maws.ask.answer')).toEqual([{
      appSessionId: mine.appId, askId: event.askId, answers: [
        { id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] },
        { id: 'q2', question: 'What title?', status: 'answered', value: 'v2' },
      ],
    }]));
    expect(fake.invoked('session.answer')).toEqual([]);
  });

  // The question sheet's C3 M4 (§H): a session's sheet questions together are one card, its sheet in place, compact
  it('holds one compact sheet for a session’s sheet questions, beside the other cards', async () => {
    const SHEET = sheetOf([CLASH, FIXTURE]);
    const asked = (question: string) =>
      ({ ...askItemFor(askOpened({ requestId: question as never }), at(mine.appId)), id: at(`sheet:${SHEET.session}:${question}`) as never, kind: 'async_input' as const, request: { requestId: question as never, toolUseId: 'toolu_sheet' as never, taskId: null, agentId: null } });
    useAttention.getState().applyChanged({ appSessionId: at(mine.appId), items: [askItemFor(event, at(mine.appId)), asked('q4'), asked('q7')] }, TEST_MACHINE);
    const summary = { session: SHEET.session, appSessionId: mine.appId, title: null, live: true, seq: 1, open: 2, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false };
    install({ 'attention.request': { event }, 'maws.asks.list': { asks: [] }, 'sheet.list': { sessions: [summary], door: { known: false } }, 'sheet.read': { model: SHEET, door: { known: false } } });
    const off = connectSheets(ipc);
    try {
      render(<ChannelView project={SMNS} />);
      await act(() => fake.reply('org.channel.open', opened()));
      const waiting = stream().querySelector<HTMLElement>('[data-channel-waiting]')!;
      await waitFor(() => expect(waiting.querySelectorAll('[data-sheet-in-place]')).toHaveLength(1));
      expect(waiting.querySelectorAll('[data-channel-card]')).toHaveLength(1); // the ask's
      expect([...waiting.querySelectorAll('[data-sheet-question]')].map((q) => q.getAttribute('data-sheet-question'))).toEqual(['q4', 'q7']);
      expect(within(waiting.querySelector<HTMLElement>('[data-sheet-in-place]')!).getByText('Release notes')).toBeTruthy();
    } finally {
      off();
      resetSheetStore();
    }
  });
});

describe('Channel in the project’s menu', () => {
  const MAWS = project('maws', 0, { org: { key: KEY, name: 'MAWS', source: 'smns', smnsId: SMNS } });
  const LOOSE = project('loose', 1, { org: { key: 'folder:loose' as OrgKey, name: 'loose', source: 'folder', smnsId: null } });
  const menuFor = async (name: string) => {
    fireEvent.contextMenu(screen.getByRole('treeitem', { name }));
    return screen.findByRole('menu');
  };

  it('shows only for a project whose sminos id is known, and opens one tab per project, titled for it', async () => {
    install();
    fillStores({ projects: [MAWS, LOOSE], sessions: [], digests: [], engine: [], attention: [], timeline: [] });
    render(<Sidebar />);
    expect(within(await menuFor('loose')).queryByRole('menuitem', { name: 'Channel' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(within(await menuFor('MAWS')).getByRole('menuitem', { name: 'Channel' }));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
    const channels = allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'channel');
    expect(channels).toEqual([{ id: tabId({ kind: 'channel', project: SMNS }), kind: 'channel', project: SMNS, pinned: false }]);
    expect(renderHook(() => useChannelTitle(SMNS)).result.current).toBe('MAWS · channel');
    expect(renderHook(() => useChannelTitle('not-known')).result.current).toBe('Channel');
  });
});

// M7b: every machine's to-human entries, placed by time among the log's, and a machine that shares none said greyed.
describe('to-human entries', () => {
  const host = (id: string, minute: number, over: Partial<ChannelHost> = {}): ChannelHost => ({
    key: `${OTHER_MACHINE} ${id}`, machine: OTHER_MACHINE, id, lane: 'A', session: S1, kind: 'message', text: `message ${id}`, at: T(minute), src: `${SMNS}/mini%2F${S1}/${id}`, order: minute, ...over,
  });

  it('draws them by time among the log’s entries, each by its session and machine, and takes them by key from each change', async () => {
    install();
    render(<ChannelView project={SMNS} />);
    await act(() =>
      fake.reply('org.channel.open', opened({ events: [say(1, S1, S2, 1), say(2, S2, S1, 30)], hosts: [host('m1', 5)], machines: [{ machine: OTHER_MACHINE, name: 'mini', state: 'live', asOf: T(5) }, { machine: TEST_MACHINE, name: 'Old Mac', state: 'unavailable', asOf: null }] })),
    );
    expect(entries()).toEqual(['say:1', 'to-human:-', 'say:2']);
    const drawn = stream().querySelector<HTMLElement>('[data-channel-entry="to-human"]')!;
    expect(within(drawn).getByText('maws-45')).toBeTruthy();
    expect(within(drawn).getByText('message m1')).toBeTruthy();
    expect(stream().querySelector('[data-channel-unavailable]')?.textContent).toBe('Old Mac: update MAWS there to see its sessions'); // the word cut (P454)
    tell(change({ hosts: { upserts: [host('m2', 40)], removed: [`${OTHER_MACHINE} m1`] } }));
    expect(entries()).toEqual(['say:1', 'say:2', 'to-human:-']);
    expect(stream().querySelector('[data-channel-entry="to-human"]')?.getAttribute('data-key')).toBe(`${OTHER_MACHINE} m2`);
  });
});
