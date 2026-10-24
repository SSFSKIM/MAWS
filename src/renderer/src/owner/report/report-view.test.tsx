// Turn-level report folding stays intact; individual messages remain in authored Markdown flow and attached mods draw them.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { api, BASH_RESULT, builder } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Transcript } from '../../transcript/view/Transcript';
import { CLOSE_MOTION, OPEN_MOTION } from '../../ui/disclosure';
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

const record = () => document.querySelector<HTMLElement>('[data-kind="owner_record"] .transcript-disclosure');
const dividers = () => [...document.querySelectorAll('[data-kind="divider"] .transcript-divider > .transcript-disclosure')] as HTMLElement[];

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

  it('a resting report reuses the projected completed summary, not a stale running divider', async () => {
    const b = builder();
    b.turn('resting-user');
    b.toolUse('resting-tool', 'Bash', { command: 'ls' });
    b.result('resting-tool', 'ok', { structured: BASH_RESULT('ok') });
    b.text('resting-text', 0, '<message>Done.</message>');
    const { source } = pushSource(b.events);
    render(<Transcript source={source} variant="session" ownerLane atRest />);
    await waitFor(() => expect(record()).not.toBeNull());
    fireEvent.click(record()!);
    await waitFor(() => expect(record()?.getAttribute('aria-expanded')).toBe('true'));
    expect(record()?.textContent).toMatch(/^Worked for/);
    expect(document.querySelector('[data-plugin-spinner]')).toBeNull();
  });

  it('opens a marked turn’s working record to the work in one click, without a second turn fold', async () => {
    await mounted(session());
    // level 0
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call · 2 messages'));
    expect(record()!.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('The plan is to add the table.')).toBeTruthy();
    expect(screen.getByText('Checking the tree.', { exact: false })).toBeTruthy(); // no within-message fold
    expect(screen.queryByText('Unmarked closing words.')).toBeNull();
    expect(dividers()).toHaveLength(1); // the unmarked turn's own divider: drawn as the full transcript
    expect(screen.getByText('A plain answer.')).toBeTruthy();
    // One disclosure opens the work; the unmarked turn keeps its own divider.
    fireEvent.click(record()!);
    await waitFor(() => expect(record()?.getAttribute('aria-expanded')).toBe('true'));
    expect(record()?.textContent).toMatch(/Worked for .*1 tool call/);
    expect(document.querySelector('[data-kind="owner_record"] [aria-label="Turn summary"]')).not.toBeNull();
    expect(dividers()).toHaveLength(1);
    expect(screen.getByText('Unmarked closing words.')).toBeTruthy();
    expect(screen.getByText('Checking the tree.', { exact: false })).toBeTruthy(); // the marked text's own unmarked words
    expect(document.querySelectorAll('[data-kind="group"], [data-kind="cell"]').length).toBeGreaterThan(0);
    // back to the report
    fireEvent.click(record()!);
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call · 2 messages'));
    expect(screen.queryByText('Unmarked closing words.')).toBeNull();
  });

  it('keeps the working-record disclosure focused through expansion and collapse', async () => {
    await mounted(session());
    await waitFor(() => expect(record()?.getAttribute('aria-expanded')).toBe('false'));
    const disclosure = record()!;
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);

    fireEvent.click(disclosure); // native keyboard activation dispatches a click to this same button
    await waitFor(() => expect(record()?.getAttribute('aria-expanded')).toBe('true'));
    expect(document.activeElement).toBe(disclosure);
    expect(record()).toBe(disclosure);
    expect(document.querySelectorAll('[data-kind="owner_record"] .transcript-disclosure')).toHaveLength(1);
    expect(screen.getByText('Unmarked closing words.')).toBeTruthy();

    fireEvent.click(disclosure);
    await waitFor(() => expect(record()?.getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(disclosure);
    expect(record()).toBe(disclosure);
    expect(screen.queryByText('Unmarked closing words.')).toBeNull();
  });

  it('restoring an open Report record cancels a Transcript fold without disabling later fold animations', async () => {
    const { key } = await mounted(session());
    await waitFor(() => expect(record()).not.toBeNull());
    const work = () => document.querySelector('[data-cell-id="cell:t1"]')?.closest<HTMLElement>('[data-kind="cell"]') ?? null;
    fireEvent.click(record()!);
    expect(work()).not.toBeNull();
    act(() => useTranscriptStore.getState().setView(key, 'transcript'));
    expect(dividers()[0].getAttribute('aria-expanded')).toBe('true');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(dividers()[0]);
      expect(dividers()[0].getAttribute('aria-expanded')).toBe('false');
      expect(work()!.style.transition).toContain(`height ${CLOSE_MOTION.ms}ms`);
      expect(work()!.style.height).toBe('0px');
      act(() => useTranscriptStore.getState().setView(key, 'report'));
      // Wait beyond both motion windows: an obsolete Transcript callback must not fold the restored work away.
      act(() => vi.advanceTimersByTime(CLOSE_MOTION.ms + OPEN_MOTION.ms + 1));
      expect(record()?.getAttribute('aria-expanded')).toBe('true');
      expect(work()).not.toBeNull();
      expect(work()!.getAttribute('style')).toBeNull();
      expect(screen.getByText('Unmarked closing words.')).toBeTruthy();

      // A new, deliberate fold in Transcript still animates before removing its rows.
      act(() => useTranscriptStore.getState().setView(key, 'transcript'));
      fireEvent.click(dividers()[0]);
      expect(work()!.style.transition).toContain(`height ${CLOSE_MOTION.ms}ms`);
      act(() => vi.advanceTimersByTime(CLOSE_MOTION.ms - 1));
      expect(work()).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(work()).toBeNull();
      expect(dividers()[0].getAttribute('aria-expanded')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the transcript view draws every turn in full, the marks unboxed', async () => {
    const { key } = await mounted(session());
    await waitFor(() => expect(record()).not.toBeNull());
    act(() => useTranscriptStore.getState().setView(key, 'transcript'));
    await waitFor(() => expect(record()).toBeNull());
    expect(dividers()).toHaveLength(2);
    expect(screen.getByText('Unmarked closing words.')).toBeTruthy();
    expect(document.querySelector('.owner-message-ink')?.textContent).toBe('The plan is to add the table.');
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
    await waitFor(() => expect(record()?.textContent).toBe('Working record · 1 tool call'));
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('The README plan. The branch is master. Unverified. Which tone? Concise Friendly');
    expect(document.querySelector('[data-owner-card], .owner-card-label')).toBeNull();
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
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toBe('<to-human>Halfway');
    push([delta(' there.')]);
    await waitFor(() => expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toBe('<to-human>Halfway there.'));
    push([delta('</to-human>')]);
    await waitFor(() => expect(document.querySelector('.owner-message-ink')?.textContent).toBe('Halfway there.'));
  });

  it('with the lane off, a marked turn is P1’s drawing: R4’s presenter, the turn folded by its divider', async () => {
    await mounted(session(), false);
    await waitFor(() => expect(document.querySelector('.owner-message-ink')).not.toBeNull());
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

  it('both marked and unmarked texts are offered to the attached surface', async () => {
    const { fake } = await attached(session());
    await waitFor(() => expect(assistantAsks(fake)).toContain(MARKED));
    expect(document.querySelector('[data-owner-card]')).toBeNull();
    await waitFor(() => expect(assistantAsks(fake)).toContain('A plain answer.'));
    expect(assistantAsks(fake)).toContain(MARKED);
  });
});
