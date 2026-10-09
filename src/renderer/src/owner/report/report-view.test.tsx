// The report view in a mounted transcript (the P2-C document, Design §7; acceptance G3): a marked turn folds into one
// working record that opens to the full transcript's folded turn and then to its work rows; an unmarked turn draws as
// the full transcript; the transcript view draws the marks as cards with every word; with the lane off it is P1's
// drawing; and with an engine surface attached, a marked text is still MAWS's to draw while an unmarked one keeps the
// surface's path.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { api, BASH_RESULT, builder } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Transcript } from '../../transcript/view/Transcript';

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
    key: `report-view-${++keys}`,
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

const record = () => screen.queryByRole('button', { name: /^(Working record|Fold to report)/ });
const dividers = () => [...document.querySelectorAll('[data-kind="divider"] .transcript-divider > .transcript-disclosure')] as HTMLElement[];

describe('the report view', () => {
  it('folds a marked turn to its prompt, one working record and its marks, and opens it to level 1 and level 2', async () => {
    await mounted(session());
    // level 0
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call · 2 messages'));
    expect(record()!.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('The plan is to add the table.')).toBeTruthy();
    expect(screen.queryByText('Checking the tree.', { exact: false })).toBeNull();
    expect(screen.queryByText('Unmarked closing words.')).toBeNull();
    expect(dividers()).toHaveLength(1); // the unmarked turn's own divider: drawn as the full transcript
    expect(screen.getByText('A plain answer.')).toBeTruthy();
    // level 1: the turn as the full transcript draws it folded, the record above it as the way back
    fireEvent.click(record()!);
    await waitFor(() => expect(record()?.textContent).toBe('Fold to report'));
    expect(dividers()).toHaveLength(2);
    expect(dividers()[0].getAttribute('aria-expanded')).toBe('false');
    expect(dividers()[0].textContent).toMatch(/1 tool call/);
    expect(screen.getByText('Unmarked closing words.')).toBeTruthy();
    expect(screen.getByText('Checking the tree.', { exact: false })).toBeTruthy(); // the marked text's own unmarked words
    expect(document.querySelector('[data-kind="group"], [data-kind="cell"]')).toBeNull();
    // level 2: the divider expanded shows the work rows
    fireEvent.click(dividers()[0]);
    await waitFor(() => expect(document.querySelectorAll('[data-kind="group"], [data-kind="cell"]').length).toBeGreaterThan(0));
    // back to the report
    fireEvent.click(record()!);
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call · 2 messages'));
    expect(screen.queryByText('Unmarked closing words.')).toBeNull();
  });

  it('the transcript view draws every turn in full, the marks still as cards', async () => {
    const { key } = await mounted(session());
    await waitFor(() => expect(record()).not.toBeNull());
    act(() => useTranscriptStore.getState().setView(key, 'transcript'));
    await waitFor(() => expect(record()).toBeNull());
    expect(dividers()).toHaveLength(2);
    expect(screen.getByText('Unmarked closing words.')).toBeTruthy();
    expect(document.querySelector('[data-owner-card="to-human"]')?.textContent).toBe('MessageThe plan is to add the table.');
    expect(screen.getByText('Checking the tree.', { exact: false })).toBeTruthy();
  });

  it('nested marks draw as their cards in order (U2 S13’s shape)', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'git status' });
    b.result('t1', 'clean', { structured: BASH_RESULT('clean') });
    b.text('m1', 0, '<to-human>\nThe README plan.\n\n<insight>\nThe branch is master.\n</insight>\n\n<essential>\nUnverified.\n</essential>\n\n<need-input>Which tone?\n<choice recommended>Concise</choice>\n<choice>Friendly</choice>\n</need-input>\n</to-human>');
    b.end(['u1']);
    await mounted(b.events);
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call'));
    expect([...document.querySelectorAll('.owner-card-label')].map((label) => label.textContent)).toEqual(['Message', 'Insight', 'Must read', 'Question']);
  });

  it('an open turn: the record runs, and a streaming message fills in as it arrives', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    const { push } = await mounted(b.events);
    expect(record()).toBeNull(); // nothing marked yet: the full transcript
    const delta = (textDelta: string) => b.emit('assistant.block.delta', { apiMessageId: api('m9'), blockIndex: 0, blockType: 'text', textDelta, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    push([delta('<to-human>Halfway')]);
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call'));
    expect(record()!.querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(document.querySelector('[data-owner-card="to-human"]')?.textContent).toContain('Halfway');
    push([delta(' there.')]);
    await waitFor(() => expect(document.querySelector('[data-owner-card="to-human"]')?.textContent).toContain('Halfway there.'));
  });

  it('with the lane off, a marked turn is P1’s drawing: R4’s presenter, the turn folded by its divider', async () => {
    await mounted(session(), false);
    await waitFor(() => expect(document.querySelector('[data-owner-span="to-human"]')).not.toBeNull());
    expect(record()).toBeNull();
    expect(document.querySelector('[data-owner-card]')).toBeNull();
    expect(dividers()).toHaveLength(2);
  });
});

describe('the lane with an engine surface attached', () => {
  async function attached(events: SessionEvent[]) {
    const fake = fakeClient();
    window.maws = fake.client;
    const mount = await mounted(events);
    useSessions.setState({ engine: new Map([[mount.key as AppSessionId, { ...status(mount.key), uiSurface: { clientId: 'maws-main' } }]]) });
    return { ...mount, fake };
  }
  const assistantAsks = (fake: ReturnType<typeof fakeClient>) => (fake.invoked('session.ui.render') as { component: string; props: { text: string } }[]).filter((a) => a.component === 'AssistantMessage').map((a) => a.props.text);

  it('a marked text is drawn by the report module and never asked of the surface; an unmarked one is, as before', async () => {
    const { fake } = await attached(session());
    await waitFor(() => expect(document.querySelector('[data-owner-card="to-human"]')).not.toBeNull());
    await waitFor(() => expect(assistantAsks(fake)).toContain('A plain answer.'));
    expect(assistantAsks(fake)).not.toContain(MARKED);
  });
});
