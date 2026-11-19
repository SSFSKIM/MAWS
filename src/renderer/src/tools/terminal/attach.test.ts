// The terminal's "Attach selection to chat" (UX wave U6b-5a, M2; decisions 6, 10 and 11, P8; card K4 as answered): what
// it attaches (the selection unchanged; with nothing selected, from the chord only, what the screen shows), the one line
// each outcome says (`ATTACH`, the cause in the sentence), and the action's handler, registered exactly while a terminal
// holds the keyboard. The hand-over itself is `composer/attach-pasted.test.tsx`'s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE } from '../../../../../test/support/machine';
import { isActionEnabled, runAction } from '../../keymap/actions-runtime';
import { useMachines } from '../../stores/machines';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import type { AttachOutcome, AttachRefusal } from '../../composer/attach-pasted';

const attached = vi.hoisted(() => ({ answer: { kind: 'added' } as unknown, calls: [] as [string, string][] }));
vi.mock('../../composer/attach-pasted', () => ({
  attachPasted: vi.fn(async (session: string, text: string) => {
    attached.calls.push([session, text]);
    return attached.answer;
  }),
}));
const terminal = vi.hoisted(() => ({ selection: '', screen: '', focused: null as string | null, container: null as HTMLElement | null, session: '' }));
vi.mock('../../terminal/registry', () => ({
  terminals: {
    get: (id: string) => ({
      info: { id, appSessionId: terminal.session },
      container: terminal.container,
      renderer: { hasSelection: () => terminal.selection !== '', getSelection: () => terminal.selection, screenText: () => terminal.screen },
    }),
    focused: () => (terminal.focused === null ? null : { info: { id: terminal.focused, appSessionId: terminal.session }, container: terminal.container }),
  },
}));

const { ATTACH } = await import('./copy');
const { attachFromTerminal, connectTerminalAttach } = await import('./attach');

const HERE = at('app-here' as AppSessionId);
const THERE = addressOf(OTHER_MACHINE, 'app-there' as AppSessionId);
const lines = () => useNotices.getState().notices.map((notice) => ({ level: notice.level, text: notice.text }));
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useNotices.setState({ notices: [] });
  attached.calls = [];
  attached.answer = { kind: 'added' };
  Object.assign(terminal, { selection: '', screen: '', focused: null, container: null, session: HERE });
  useSessions.setState({ records: new Map([[HERE, { appId: HERE, title: { text: 'Fix the importer' } } as never], [THERE, { appId: THERE, title: { text: 'Quarterly numbers' } } as never]]) });
  useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'studio', local: false, state: 'up', since: '2026-11-17T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
});
afterEach(() => {
  useSessions.setState({ records: new Map() });
  document.body.replaceChildren();
});

describe('what is attached', () => {
  it('is the selection as the terminal gives it, unchanged, from the menu and from the chord', async () => {
    terminal.selection = '  $ npm test\n  3 failed  ';
    terminal.screen = 'the whole screen';
    await attachFromTerminal('t1' as never, 'menu');
    await attachFromTerminal('t1' as never, 'chord');
    expect(attached.calls).toEqual([[HERE, '  $ npm test\n  3 failed  '], [HERE, '  $ npm test\n  3 failed  ']]);
  });

  it('with nothing selected is what the screen shows, from the chord only; a blank screen attaches nothing and says so', async () => {
    terminal.screen = 'prompt $ ls\nREADME.md';
    await attachFromTerminal('t1' as never, 'chord');
    expect(attached.calls).toEqual([[HERE, 'prompt $ ls\nREADME.md']]);
    attached.calls = [];
    useNotices.setState({ notices: [] });
    await attachFromTerminal('t1' as never, 'menu'); // the menu's item is disabled with no selection: nothing to read
    terminal.screen = '   ';
    await attachFromTerminal('t1' as never, 'chord');
    expect(attached.calls).toEqual([]);
    expect(lines()).toEqual([
      { level: 'warning', text: 'Nothing on this terminal\'s screen to attach.' },
      { level: 'warning', text: 'Nothing on this terminal\'s screen to attach.' },
    ]);
  });
});

// Card K4, as answered: one case per row of the table; no outcome falls through to another's sentence.
describe('the line each outcome says', () => {
  const say = async (answer: AttachOutcome, session: AppSessionId = HERE) => {
    useNotices.setState({ notices: [] });
    attached.answer = answer;
    terminal.session = session;
    terminal.selection = 'picked';
    await attachFromTerminal('t1' as never, 'menu');
    return lines();
  };

  it('says nothing when the box on screen took it', async () => {
    expect(await say({ kind: 'taken' })).toEqual([]);
  });

  it('says Added with the session’s title, as information', async () => {
    expect(await say({ kind: 'added' })).toEqual([{ level: 'info', text: 'Added to Fix the importer' }]);
  });

  it('says it could not confirm, and never "Not added"', async () => {
    const said = await say({ kind: 'unconfirmed' });
    expect(said).toEqual([{ level: 'warning', text: 'MAWS could not confirm that the selection was added to Fix the importer. Open it to look before attaching again.' }]);
    expect(said[0]!.text).not.toContain('Not added');
  });

  const SENTENCES: [AttachRefusal, AppSessionId, string][] = [
    ['not-started', HERE, 'Not added: Fix the importer has not started.'],
    ['taking-back', HERE, 'Not added: Fix the importer is taking a message back.'],
    ['changed', HERE, 'Not added: Fix the importer\'s draft kept changing. Attach again.'],
    ['unknown', HERE, 'Not added: this terminal\'s session is no longer known.'],
    ['unreachable', THERE, 'Not added: studio is not answering.'],
    ['unreachable', HERE, 'Not added: MAWS\'s service on this Mac is not answering.'],
    ['no-store', THERE, 'Not added: studio keeps no drafts for this window.'],
    ['busy', HERE, 'Not added: Fix the importer is sending a message.'],
    ['closed', HERE, 'Not added: Fix the importer takes no typing now.'],
    ['failed', HERE, 'The selection was not added to Fix the importer.'],
    ['unsaved', HERE, 'Fix the importer has the selection, but its draft could not be saved.'],
  ];
  it.each(SENTENCES)('refused %s (%s) says its own sentence', async (why, session, sentence) => {
    expect(await say({ kind: 'refused', why }, session)).toEqual([{ level: 'warning', text: sentence }]);
  });

  it('has a sentence for every refusal, and none twice', () => {
    const whys: AttachRefusal[] = ['not-started', 'busy', 'closed', 'unsaved', 'taking-back', 'changed', 'unknown', 'unreachable', 'no-store', 'failed'];
    const words = whys.map((why) => ATTACH.refused[why]({ title: 'T', machine: 'M' }));
    expect(new Set(words).size).toBe(whys.length);
    expect(Object.keys(ATTACH.refused).sort()).toEqual([...whys].sort());
  });
});

// P8: the action has a handler exactly while a terminal holds the keyboard, so the palette never lists it to do nothing.
describe('the handler of terminal.attachSelection', () => {
  it('is registered while a terminal holds the keyboard and at no other time, and attaches that terminal’s screen', async () => {
    const container = document.createElement('div');
    const helper = document.createElement('textarea'); // where xterm puts focus
    container.append(helper);
    const field = document.createElement('input');
    document.body.append(container, field);
    terminal.container = container;
    const disconnect = connectTerminalAttach();
    expect(isActionEnabled('terminal.attachSelection')).toBe(false);

    terminal.focused = 't7';
    helper.focus();
    await settled();
    expect(isActionEnabled('terminal.attachSelection')).toBe(true);
    terminal.screen = 'on the screen';
    runAction('terminal.attachSelection');
    await settled();
    expect(attached.calls).toEqual([[HERE, 'on the screen']]);

    terminal.focused = null;
    field.focus();
    await settled();
    expect(isActionEnabled('terminal.attachSelection')).toBe(false);

    terminal.focused = 't7';
    helper.focus();
    await settled();
    expect(isActionEnabled('terminal.attachSelection')).toBe(true);
    disconnect();
    expect(isActionEnabled('terminal.attachSelection')).toBe(false);
  });

  it('a focus that left just before the teardown registers nothing after it', async () => {
    const container = document.createElement('div');
    const helper = document.createElement('textarea');
    container.append(helper);
    document.body.append(container);
    terminal.container = container;
    terminal.focused = 't7';
    const disconnect = connectTerminalAttach();
    helper.focus();
    await settled();
    expect(isActionEnabled('terminal.attachSelection')).toBe(true);
    helper.blur(); // its read is queued for once the page has moved the focus
    disconnect();
    await settled();
    expect(isActionEnabled('terminal.attachSelection')).toBe(false);
  });
});
