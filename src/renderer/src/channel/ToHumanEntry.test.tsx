// A session's to-human entry in the stream (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b's
// Renderer bullet; Q5): a message, or a question with its choices and its answer (one ask's questions together), under the
// session's title and its machine's chip, "as of" while that machine isn't live, greyed while it reads nothing at all.
// Plain text, as the channel draws every word.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDayTime } from '@shared/app/date-format';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import type { ToHumanEntry as Entry } from './project';
import { ToHumanEntry } from './ToHumanEntry';

const T = (minute: number) => new Date(Date.UTC(2026, 10, 6, 12, minute)).toISOString();
const base = { kind: 'to-human' as const, key: `${OTHER_MACHINE} e1`, machine: OTHER_MACHINE, machineName: 'mini', name: 'maws-45', title: 'Fix the relay', at: T(3), asOf: null, greyed: false };
const message = (over: Partial<Entry> = {}): Entry => ({ ...base, host: 'message', text: 'The build is green.', ...over }) as Entry;
const entry = () => document.querySelector<HTMLElement>('[data-channel-entry="to-human"]')!;

beforeEach(() =>
  useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: T(0), generation: 0 },
    { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T(0), generation: 0 },
  ]),
);
afterEach(() => {
  cleanup();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

describe('ToHumanEntry', () => {
  it('draws a message under its session’s name, title and machine chip, as plain text', () => {
    render(<ToHumanEntry entry={message({ text: 'Use **main**, not `dev`.\n\n# not a heading' })} />);
    const header = entry().querySelector('header')!;
    expect(within(header).getByText('maws-45')).toBeTruthy();
    expect(within(header).getByText('Fix the relay')).toBeTruthy();
    expect(header.querySelector('[data-machine-chip]')?.textContent).toBe('@mini');
    const body = entry().querySelector('[data-to-human-text]')!;
    expect(body.textContent).toBe('Use **main**, not `dev`.\n\n# not a heading');
    expect(entry().querySelector('strong, code, h1')).toBeNull();
    expect(entry().dataset.host).toBe('message');
    expect(entry().querySelector('[data-channel-as-of]')).toBeNull();
  });

  it('lets its names give way in the Channel’s one order: the name whole with no 24-character cap, the chip able to give way, the tooltip whole (board 505)', () => {
    const long = 'ci-optimization-coordinator-for-the-clinical-research-shards';
    render(<ToHumanEntry entry={message({ name: long })} />);
    const header = entry().querySelector('header')!;
    const part = (name: string) => header.querySelector<HTMLElement>(`[data-name-part="${name}"]`)!;
    expect(part('alias').textContent).toBe(long);
    expect(part('alias').className).not.toMatch(/max-w-\[24ch\]/);
    expect(part('alias').getAttribute('title')).toBe(`${long} · Fix the relay · mini`);
    expect(part('title').textContent).toBe('Fix the relay');
    expect(part('chip').querySelector('[data-machine-chip]')?.textContent).toBe('@mini');
    expect(part('chip').className.split(' ')).not.toContain('shrink-0');
    // the names are one group of the row; the host's word and the time are the fixed parts that wrap under it
    const names = header.querySelector<HTMLElement>('[data-names]')!;
    expect([...names.querySelectorAll('[data-name-part]')].map((el) => el.getAttribute('data-name-part'))).toEqual(['alias', 'title', 'chip']);
    expect(names.contains(header.querySelector('time'))).toBe(false);
  });

  it('names a machine the roster doesn’t hold by the channel’s name for it (its cached entries, signed out), and the roster’s name over it', () => {
    const away = 'AwayMachineRef00000000' as MachineRef;
    render(<ToHumanEntry entry={message({ machine: away, key: `${away} e1`, machineName: 'studio-mini' })} />);
    expect(entry().querySelector('[data-machine-chip]')?.textContent).toBe('@studio-mini');
    cleanup();
    render(<ToHumanEntry entry={message({ machineName: 'an older name' })} />);
    expect(entry().querySelector('[data-machine-chip]')?.textContent).toBe('@mini');
  });

  it('draws no chip for this Mac’s session', () => {
    render(<ToHumanEntry entry={message({ machine: TEST_MACHINE, key: `${TEST_MACHINE} e1`, name: 'Local chat', title: null })} />);
    expect(entry().querySelector('[data-machine-chip]')).toBeNull();
    expect(screen.getByText('Local chat')).toBeTruthy();
  });

  it('draws a question with its choices and its answer, and one ask’s questions together', () => {
    const asked: Entry = {
      ...base,
      host: 'question',
      questions: [
        { key: 'q1', text: 'Which branch?', choices: ['main', 'dev'], answer: { text: 'main', at: T(5) } },
        { key: 'q2', text: 'Ship it?', choices: [], answer: null },
      ],
    };
    render(<ToHumanEntry entry={asked} />);
    const questions = [...entry().querySelectorAll<HTMLElement>('[data-to-human-question]')];
    expect(questions.map((q) => q.querySelector('[data-to-human-text]')?.textContent)).toEqual(['Which branch?', 'Ship it?']);
    expect(within(questions[0]).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['main', 'dev']);
    expect(questions[0].querySelector('[data-to-human-answer]')?.textContent).toContain('main');
    expect(questions[1].querySelector('[data-to-human-answer]')).toBeNull();
    expect(within(questions[1]).queryAllByRole('listitem')).toEqual([]);
  });

  it('says "as of" an offline machine’s time on its entries, and greys an unavailable machine’s', () => {
    render(<ToHumanEntry entry={message({ asOf: T(40) })} />);
    expect(entry().querySelector('[data-channel-as-of]')?.textContent).toContain(formatDayTime(Date.parse(T(40))));
    expect(entry().dataset.greyed).toBeUndefined();
    cleanup();
    render(<ToHumanEntry entry={message({ asOf: T(9), greyed: true })} />);
    expect(entry().dataset.greyed).toBe('true');
    expect(entry().className).toContain('opacity-60');
  });
});
