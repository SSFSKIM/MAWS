// The work area's rows (C6 M4): groups with their summary, icon and bounded scroller, standalone cells (single-cell
// unwrap, denied and stopped cells), subagent and agent-message rows, and replayed
// bash rows.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJournal, loadSyntheticJournal } from '../../../../../../test/support/fixtures';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
import type { Row, TurnId } from '../../model/rows';
import { BASH_RESULT, builder, parent, task, tool, uuid } from '../../model/test-events';
import { NO_ACTIONS } from '../context';
import { renderRow, rowOf, spyActions, storeWith } from './test-support';

afterEach(cleanup);

const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind);

async function expanded(events: Parameters<typeof storeWith>[0]) {
  const store = await storeWith(events);
  useTranscriptStore.getState().expandAll(store.key);
  return store;
}

describe('group row', () => {
  function twoCommands() {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'pnpm test' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.toolUse('t2', 'Bash', { command: 'pnpm lint' });
    b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
    b.end(['u1']);
    return b.events;
  }

  it('shows both call rows directly, with their input and output folded', async () => {
    const store = await storeWith(twoCommands());
    useTranscriptStore.getState().toggleTurn(store.key, useTranscriptStore.getState().entries[store.key].state.order[0]);
    const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
    expect(screen.getAllByRole('button', { name: 'Ran Bash', expanded: false })).toHaveLength(2);
    expect(view.container.querySelector('[data-cell-count]')?.getAttribute('data-cell-count')).toBe('2');
    expect(view.container.textContent).not.toContain('pnpm test');
    expect(view.container.querySelector('.transcript-group-header')).toBeNull();
  });

  describe('while the turn works', () => {
    beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-09-28T10:00:05.000Z'), toFake: ['Date', 'setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    it('keeps the running call visible with its description and status', async () => {
      const b = builder(); b.turn('u1');
      b.toolUse('t1', 'Bash', { command: 'sleep 30', description: 'Wait for the server' });
      const store = await storeWith(b.events);
      const group = rowOf(store.rows(), 'group');
      expect(group.state).toBe('active');
      const view = renderRow(group, { storeKey: store.key });
      expect(screen.getByRole('button', { name: 'Wait for the server', expanded: false })).toBeTruthy();
      expect(view.container.querySelector('[data-cell-id]')?.getAttribute('data-status')).toBe('running');
      expect(view.container.textContent).not.toContain('sleep 30');
    });
  });
});

describe('standalone cell row', () => {
  it('a completed single-cell group renders as a standalone cell row', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'git status --short' });
    b.result('t1', '', { structured: BASH_RESULT('') });
    b.end(['u1']);
    const store = await expanded(b.events);
    expect(ofKind(store.rows(), 'group')).toHaveLength(0);
    const view = renderRow(rowOf(store.rows(), 'cell'), { storeKey: store.key });
    expect(view.container.querySelector('[data-cell-count]')).toBeNull();
    expect(view.container.querySelector('[data-cell-id="cell:t1"] > button')?.textContent).toBe('Ran Bash');
  });

  it('pass1/permission-roundtrip: the denied call is a standalone, focusable cell row, never inside a group', async () => {
    const store = await expanded(journalToEvents(loadJournal('pass1', 'permission-roundtrip')));
    const denied = ofKind(store.rows(), 'cell').filter((cell) => cell.status === 'denied');
    expect(denied).toHaveLength(1);
    expect(ofKind(store.rows(), 'group').flatMap((group) => group.cells).filter((cell) => cell.status === 'denied')).toEqual([]);
    const view = renderRow(denied[0], { storeKey: store.key });
    const cell = view.container.querySelector<HTMLElement>(`[data-cell-id="${denied[0].id}"]`)!;
    expect(cell.tabIndex).toBe(-1);
    expect(cell.dataset.status).toBe('denied');
    expect(cell.querySelector('button')?.textContent).toMatch(/^Denied: git branch --show-current · /);
  });

  it('transcript/denials: the interrupted cell reads Stopped and is not a link target of the divider', async () => {
    const store = await expanded(journalToEvents(loadSyntheticJournal('denials')));
    const state = useTranscriptStore.getState().entries[store.key].state;
    const [first, second] = state.order;
    const inTurn = (id: TurnId) => store.rows().filter((row) => row.turnId === id);
    const interrupted = ofKind(inTurn(second), 'cell')[0];
    expect(interrupted).toMatchObject({ status: 'stopped', classification: { denial: { kind: 'user-rejected', interruption: true } } });
    const cellView = renderRow(interrupted, { storeKey: store.key });
    expect(cellView.container.querySelector(`[data-cell-id="${interrupted.id}"] > button`)?.textContent).toMatch(/^Stopped: /);
    cellView.unmount();
    const hrefs = [first, second].flatMap((id) => {
      const view = renderRow(rowOf(inTurn(id), 'divider'), { storeKey: store.key });
      const links = [...view.container.querySelectorAll('a[href]')].map((link) => link.getAttribute('href'));
      view.unmount();
      return links;
    });
    expect(hrefs).toEqual(['#cell:toolu_synth_deny_1', '#cell:toolu_synth_deny_2']);
    expect(hrefs).not.toContain(`#${interrupted.id}`);
  });
});

describe('subagent row', () => {
  function started() {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'look', subagent_type: 'general-purpose' });
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: null });
    return b;
  }

  it('reads its sentence with a glyph, and its detail line changes when a child tool.use arrives', async () => {
    const b = started();
    const store = await storeWith(b.events);
    const view = renderRow(rowOf(store.rows(), 'subagent'), { storeKey: store.key });
    expect(view.container.textContent).toContain('Survey started working');
    expect(view.container.querySelector('[data-glyphs]')?.textContent?.trim()).toHaveLength(1);
    const detail = () => view.container.querySelector('[data-agent-detail]')?.textContent ?? '';
    expect(detail()).not.toContain('Read');
    const child = b.emit('tool.use', { toolUseId: tool('c1'), toolName: 'Read', input: { file_path: '/p/one.txt' }, apiMessageId: 'mc' as never, messageUuid: null }, { parentToolUseId: parent('a1') });
    act(() => store.push([child]));
    view.rerenderRow(rowOf(store.rows(), 'subagent'));
    expect(detail()).toMatch(/^Survey · Read · /);
  });

  it('is a button calling openSubagent when the action is supplied, and plain text otherwise', async () => {
    const store = await storeWith(started().events);
    const row = rowOf(store.rows(), 'subagent');
    const actions = spyActions();
    const view = renderRow(row, { storeKey: store.key, actions });
    fireEvent.click(screen.getByRole('button', { name: /Survey started working/ }));
    expect(actions.openSubagent).toHaveBeenCalledWith(row.agents[0]);
    view.unmount();
    renderRow(row, { storeKey: store.key, actions: { ...NO_ACTIONS } });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('grouped subagent rows', () => {
  // `n` Agent calls of one assistant message, each started.
  function agents(names: string[]) {
    const b = builder();
    b.turn('u1');
    names.forEach((name, i) => {
      b.toolUse(`a${i}`, 'Agent', { description: name, prompt: 'p' }, 'm1', i);
      b.emit('subagent.started', { taskId: task(`k${i}`), toolUseId: tool(`a${i}`), description: name, subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    });
    return b;
  }

  describe('while children work', () => {
    beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-09-28T10:00:05.000Z'), toFake: ['Date', 'setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    it('one child failed while another still works: the row keeps working and the working child’s line keeps ticking', async () => {
      const b = agents(['Tester', 'Reviewer']);
      b.emit('subagent.progress', { taskId: task('k1'), description: 'Reviewer', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, lastToolName: 'Read', summary: null });
      b.emit('subagent.finished', { taskId: task('k0'), status: 'failed', summary: null, outputFile: null, reason: 'boom' });
      const store = await storeWith(b.events);
      const view = renderRow(rowOf(store.rows(), 'subagent'), { storeKey: store.key });
      const lines = () => [...view.container.querySelectorAll('[data-agent-detail]')].map((line) => line.textContent ?? '');
      expect(lines()).toHaveLength(1);
      expect(lines()[0]).toMatch(/^Reviewer · Read · \d+s$/);
      const seconds = () => Number(/(\d+)s$/.exec(lines()[0])![1]);
      const before = seconds();
      act(() => vi.advanceTimersByTime(3000));
      expect(seconds()).toBe(before + 3);
    });
  });

  it('with five agents the overflow reveals the rest, and the fifth opens through openSubagent', async () => {
    const store = await storeWith(agents(['A', 'B', 'C', 'D', 'E']).events);
    const row = rowOf(store.rows(), 'subagent');
    expect(row.overflow).toBe(1);
    const actions = spyActions();
    renderRow(row, { storeKey: store.key, actions });
    expect(screen.queryByRole('button', { name: 'Open E' })).toBeNull();
    const more = screen.getByRole('button', { name: /\+1/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: 'Open E' }));
    expect(actions.openSubagent).toHaveBeenCalledWith(row.agents[4]);
  });
});

describe('the 64 KB DOM cap on every output branch', () => {
  const BIG = `${'a'.repeat(40 * 1024)}MIDDLE${'z'.repeat(40 * 1024)}`;
  const capped = (element: Element) => {
    expect(element.textContent).not.toContain('MIDDLE');
    expect(element.textContent).toMatch(/\d+ KB omitted/);
  };

  it('a bash row caps its stdout and its stderr', async () => {
    for (const [stdout, stderr] of [[BIG, ''], ['ok', BIG]]) {
      const b = builder();
      b.emit('user.message', { messageUuid: uuid('bin'), content: '<bash-input>make</bash-input>', isReplay: true, isSynthetic: false, origin: 'human', bash: { part: 'input', command: 'make' } });
      b.emit('user.message', { messageUuid: uuid('bout'), content: 'x', isReplay: true, isSynthetic: false, origin: 'human', bash: { part: 'output', stdout, stderr, exitCode: 1 } });
      const store = await storeWith(b.events);
      const view = renderRow(rowOf(store.rows(), 'bash'));
      capped(view.container);
      view.unmount();
    }
  });
});

describe('agent message and bash rows', () => {
  it('an agent message reads its sentence', async () => {
    const store = await expanded(journalToEvents(loadSyntheticJournal('agents-and-messages')));
    const { container } = renderRow(rowOf(store.rows(), 'agent_message'));
    expect(container.textContent).toContain('Sent message to');
    expect(container.textContent).toContain('Skip node_modules entirely.');
  });

  it('pass1/queue-and-interrupt: one replayed bash row with its command, output and exit code', async () => {
    const store = await storeWith(journalToEvents(loadJournal('pass1', 'queue-and-interrupt')));
    const bash = ofKind(store.rows(), 'bash');
    expect(bash).toHaveLength(1);
    const { container } = renderRow(bash[0]);
    expect(container.textContent).toContain('! printf BASH_MODE_OK');
    expect(container.querySelector('pre')?.textContent).toBe('BASH_MODE_OK');
    expect(container.textContent).toContain('exit 0');
    expect(container.querySelector('[data-bubble]')).toBeNull();
  });
});
