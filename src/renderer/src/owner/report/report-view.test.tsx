// The to-human view where MAWS draws it (UX wave U2b, the mirror): the work between two rows the person reads is one
// record line until it is opened, no turn folds while the view is in force, and individual messages remain in authored
// Markdown flow and attached mods draw them.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { api, BASH_RESULT, builder } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Transcript } from '../../transcript/view/Transcript';
import sitting31 from './fixtures/sitting-31.txt?raw';

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 4000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
afterEach(() => {
  cleanup();
  resetSurfaceRegistry();
  useSessions.setState({ engine: new Map() });
});

let keys = 0;
function pushSource(events: SessionEvent[]) {
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = {
    key: at(`report-view-${++keys}`), // P5 O6 M2: the key names the session as the page does
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    snapshot: () => Promise.resolve(events),
  };
  return { source, push: (batch: SessionEvent[]) => act(() => listener?.(batch)) };
}

async function mounted(events: SessionEvent[], ownerLane = true) {
  const { source, push } = pushSource(events);
  const view = render(<Transcript source={source} variant="session" ownerLane={ownerLane} />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
  return { key: source.key!, view, push };
}

const MARKED = 'Checking the tree. <to-human>The plan is to add the table.</to-human>';
// A marked turn (a marked commentary, a command, an unmarked answer) and an unmarked one after it.
function session() {
  const b = builder();
  b.turn('u1', 'Plan the table');
  b.text('m1', 0, MARKED);
  b.toolUse('t1', 'Bash', { command: 'ls' });
  b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
  b.text('m2', 0, 'Unmarked closing words.');
  b.end(['u1']);
  b.turn('u2', 'And now?');
  b.toolUse('t2', 'Bash', { command: 'pwd' });
  b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
  b.text('m3', 0, 'A plain answer.');
  b.end(['u2']);
  return b.events;
}

const records = () => screen.queryAllByRole('button', { name: '› working record' });
const folds = () => screen.queryAllByRole('button', { name: '‹ fold to report' });
const dividers = () => [...document.querySelectorAll('[data-kind="divider"] .transcript-divider > .transcript-disclosure')] as HTMLElement[];
const turnLines = () => [...document.querySelectorAll('[data-kind="divider"] .transcript-turn-line')] as HTMLElement[];

describe('the report view', () => {
  // WR #31: exact assistant text at 2026-10-19 08:25:08.827Z, sitting session
  // 720e2008, transcript line 288. Its critical block has soft line endings,
  // inline-code Unicode dividers, and no Markdown headings or horizontal rules.
  it('replays the sitting reply without losing its supplied lists or inline structure', async () => {
    const b = builder();
    b.turn('sitting-user');
    b.text('sitting-reply', 0, sitting31);
    b.end(['sitting-user']);
    await mounted(b.events);
    await waitFor(() => expect(document.querySelectorAll('.transcript-prose li')).toHaveLength(9));
    expect(document.querySelectorAll('.transcript-prose ul')).toHaveLength(3);
    expect(document.querySelectorAll('.transcript-prose [data-streamdown="strong"]')).toHaveLength(3);
    expect(document.querySelectorAll('.transcript-prose h1, .transcript-prose h2, .transcript-prose hr')).toHaveLength(0);
    const critical = [...document.querySelectorAll('.transcript-prose p')].find((p) => p.textContent?.includes('Handled: fully.'))!;
    expect(critical.textContent).toContain('Needs you:');
    expect(critical.querySelector('code')?.textContent).toContain('Critical');
  });

  it('at rest, an opened record shows its turn’s line completed, not running', async () => {
    const b = builder();
    b.turn('resting-user');
    b.toolUse('resting-tool', 'Bash', { command: 'ls' });
    b.result('resting-tool', 'ok', { structured: BASH_RESULT('ok') });
    b.text('resting-text', 0, '<message>Done.</message>');
    const { source } = pushSource(b.events);
    render(<Transcript source={source} variant="session" ownerLane atRest />);
    await waitFor(() => expect(records()).toHaveLength(1));
    expect(turnLines()).toEqual([]); // a closed turn's line shows only with a record of it open
    fireEvent.click(records()[0]);
    await waitFor(() => expect(turnLines()).toHaveLength(1));
    expect(turnLines()[0].textContent).toMatch(/^Worked for/);
    expect(document.querySelector('[data-plugin-spinner]')).toBeNull();
  });

  it('folds each stretch between the rows the person reads under one line, and opens it in one click with no second fold', async () => {
    await mounted(session());
    await waitFor(() => expect(records()).toHaveLength(2)); // the first turn's work, and the second's (in force by time)
    expect(records()[0].getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('The plan is to add the table.', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Unmarked closing words.')).toBeNull();
    expect(screen.queryByText('A plain answer.')).toBeNull();
    expect(dividers()).toEqual([]); // MAWS folds no turn while the view is in force
    expect(turnLines()).toEqual([]);
    fireEvent.click(records()[0]);
    await waitFor(() => expect(screen.getByText('Unmarked closing words.')).toBeTruthy());
    expect(folds()).toHaveLength(1);
    expect(folds()[0].getAttribute('aria-expanded')).toBe('true');
    expect(turnLines()).toHaveLength(1); // the opened record's turn: its line, with no chevron
    expect(turnLines()[0].textContent).toMatch(/Worked for .* · Ran a command/); // UX wave U2 (O-15): the turn's line
    expect(document.querySelector('[data-kind="divider"] [aria-label="Turn summary"]')).not.toBeNull();
    expect(dividers()).toEqual([]);
    expect(document.querySelectorAll('[data-kind="group"], [data-kind="cell"]').length).toBeGreaterThan(0);
    expect(screen.queryByText('A plain answer.')).toBeNull(); // the other stretch stays closed
    fireEvent.click(folds()[0]);
    await waitFor(() => expect(screen.queryByText('Unmarked closing words.')).toBeNull());
    expect(records()).toHaveLength(2);
    expect(turnLines()).toEqual([]);
  });

  it('hands keyboard focus to the other line of the record as it opens and as it folds again', async () => {
    await mounted(session());
    await waitFor(() => expect(records()).toHaveLength(2));
    records()[0].focus();
    fireEvent.click(records()[0]); // native keyboard activation dispatches a click to this same button
    await waitFor(() => expect(folds()).toHaveLength(1));
    expect(document.activeElement).toBe(folds()[0]);
    fireEvent.click(folds()[0]);
    await waitFor(() => expect(folds()).toEqual([]));
    expect(document.activeElement).toBe(records()[0]);
  });

  it('the full transcript folds nothing: every turn in full, each line with no chevron, the marks unboxed', async () => {
    const { key } = await mounted(session());
    await waitFor(() => expect(records().length).toBeGreaterThan(0));
    act(() => useTranscriptStore.getState().setView(key, 'transcript'));
    await waitFor(() => expect(records()).toEqual([]));
    expect(dividers()).toEqual([]);
    expect(turnLines()).toHaveLength(2);
    expect(screen.getByText('Unmarked closing words.')).toBeTruthy();
    expect(screen.getByText('A plain answer.')).toBeTruthy();
    expect(document.querySelector('.owner-message-ink')?.textContent).toContain('The plan is to add the table.');
    expect(screen.getByText('Checking the tree.', { exact: false })).toBeTruthy();
  });

  it('nested marks retain authored order without cards (U2 S13’s shape)', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'git status' });
    b.result('t1', 'clean', { structured: BASH_RESULT('clean') });
    b.text('m1', 0, '<to-human>\nThe README plan.\n\n<insight>\nThe branch is master.\n</insight>\n\n<essential>\nUnverified.\n</essential>\n\n<need-input>Which tone?\n<choice recommended>Concise</choice>\n<choice>Friendly</choice>\n</need-input>\n</to-human>');
    b.end(['u1']);
    await mounted(b.events);
    await waitFor(() => expect(records()).toHaveLength(1));
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('The README plan. The branch is master. Unverified. Which tone? Concise Friendly');
    expect(document.querySelector('[data-owner-card], .owner-card-label')).toBeNull();
  });

  it('an open turn: its line stays in sight after the record, and a streaming message fills in as it arrives', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    const { push } = await mounted(b.events);
    expect(records()).toEqual([]); // no message yet: the plain transcript
    const delta = (textDelta: string) => b.emit('assistant.block.delta', { apiMessageId: api('m9'), blockIndex: 0, blockType: 'text', textDelta, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    push([delta('<to-human>Halfway')]);
    await waitFor(() => expect(records()).toHaveLength(1));
    const kinds = [...document.querySelectorAll('[data-kind]')].map((element) => element.getAttribute('data-kind'));
    expect(kinds.indexOf('divider')).toBe(kinds.indexOf('record_fold') + 1); // ruling 5: the running turn's line, after the closed record
    expect(turnLines()[0].textContent).toMatch(/^Working/);
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toBe('<to-human>Halfway');
    push([delta(' there.')]);
    await waitFor(() => expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toBe('<to-human>Halfway there.'));
    push([delta('</to-human>')]);
    await waitFor(() => expect(document.querySelector('.owner-message-ink')?.textContent).toBe('Halfway there.'));
  });

  it('with the lane off, a marked turn is P1’s drawing: R4’s presenter, the turn folded by its divider', async () => {
    await mounted(session(), false);
    await waitFor(() => expect(document.querySelector('.owner-message-ink')).not.toBeNull());
    expect(records()).toEqual([]);
    expect(document.querySelector('[data-owner-card]')).toBeNull();
    expect(dividers()).toHaveLength(2);
  });
});

describe('the lane with an engine surface attached', () => {
  async function attached(events: SessionEvent[]) {
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    const mount = await mounted(events);
    useSessions.setState({ engine: new Map([[mount.key as AppSessionId, { ...status(mount.key), uiSurface: { clientId: 'maws-main' } }]]) });
    return { ...mount, fake };
  }
  const assistantAsks = (fake: ReturnType<typeof fakeClient>) => (fake.invoked('session.ui.render') as { component: string; props: { text: string } }[]).filter((a) => a.component === 'AssistantMessage').map((a) => a.props.text);

  it('both marked and unmarked texts are offered to the attached surface', async () => {
    const { fake, key } = await attached(session());
    await waitFor(() => expect(assistantAsks(fake)).toContain(MARKED));
    act(() => useTranscriptStore.getState().setView(key, 'transcript')); // the full transcript: no record holds a text out of sight
    expect(document.querySelector('[data-owner-card]')).toBeNull();
    await waitFor(() => expect(assistantAsks(fake)).toContain('A plain answer.'));
    expect(assistantAsks(fake)).toContain(MARKED);
  });
});
