import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatClock } from '@shared/app/date-format';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { applyEvents, createState } from '../../model/reduce';
import { rowsOf } from '../../model/derive';
import { builder, uuid } from '../../model/test-events';
import { Disclosures } from '../context';
import { renderRow, rowOf, spyActions } from './test-support';

afterEach(cleanup);

const fixture = JSON.parse(readFileSync(join(__dirname, '../../../../../../test/fixtures/composer/pasted-40-lines.json'), 'utf8')) as { typed: string; pasted: { body: string }[]; sent: string };

function userRow(content: string | Record<string, unknown>[]) {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
  b.emit('user.message', { messageUuid: uuid('u1'), content: content as never, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  return rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user');
}

describe('user row', () => {
  it('renders the text through markdown with copy and edit affordances', () => {
    const row = userRow('Fix the **sidebar** drag');
    const { container, actions } = renderRow(row);
    expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('sidebar');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(actions.editAndResubmit).toHaveBeenCalledWith(row);
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('title')).toBe('Edit here · Send rewinds this session to this message');
  });

  it('copies the text with pasted blocks restored, untagged', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRow(userRow(fixture.sent));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(`${fixture.typed}\n${fixture.pasted[0].body}\nthanks`);
  });

  // happy-dom has no layout: the bubble content's rendered height is stubbed (its folded box is 19 lines, 432 px).
  function renderedBubbleHeight(height: number) {
    const folded = 432;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this.hasAttribute('data-user-content') ? height : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-user-content') ? (this.parentElement?.hasAttribute('data-open') ? height : Math.min(height, folded)) : 0; },
    });
    onTestFinished(() => {
      // The stubs shadow happy-dom's own (on Element.prototype); removing them restores it.
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    });
  }

  // W2 (B2): the fold follows the rendered height, as Codex's does, so one long paragraph folds too.
  it('folds a message that renders past 19 lines behind Show more, one paragraph included, and Show less folds it again', () => {
    renderedBubbleHeight(900);
    const { container } = renderRow(userRow('one paragraph that wraps over many lines '.repeat(60)));
    const bubble = container.querySelector('[data-bubble]')!;
    expect(bubble.hasAttribute('data-collapsed')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(bubble.hasAttribute('data-collapsed')).toBe(false);
    expect(bubble.hasAttribute('data-open')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(bubble.hasAttribute('data-collapsed')).toBe(true);
  });

  // The open state lives in the transcript's disclosures and outlives the row; the measurement is the mount's own. A
  // bubble the virtualiser unmounts while open and mounts again keeps its Show less, and folding measures again.
  it('an open bubble remounted over the same disclosures still offers Show less, and folding it measures again', () => {
    renderedBubbleHeight(900);
    const row = userRow('one paragraph that wraps over many lines '.repeat(60));
    const disclosures = new Disclosures();
    renderRow(row, { disclosures });
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    cleanup();
    const { container } = renderRow(row, { disclosures });
    const bubble = container.querySelector('[data-bubble]')!;
    expect(bubble.hasAttribute('data-open')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(bubble.hasAttribute('data-collapsed')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show more' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('thirty short lines that render within the fold offer no Show more', () => {
    renderedBubbleHeight(400);
    const { container } = renderRow(userRow(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')));
    expect(container.querySelector('[data-bubble]')!.hasAttribute('data-collapsed')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('a short message has no collapse control', () => {
    renderRow(userRow('one line'));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  // UX wave U3b (decision 10; R12, R14): one line under the bubble, at its side: the time, Copy and Edit, then the
  // caption last. Outside the bubble's body, so nothing of it overlays the bubble or stands beside it.
  const lineOf = (container: HTMLElement) => container.querySelector('section.transcript-user > .transcript-user-line');
  const wordsOf = (line: Element) => [...line.children].flatMap((part) => (part.classList.contains('transcript-user-line-actions') ? [...part.children] : [part])).map((part) => part.textContent);

  it('draws the time, Copy and Edit, then the caption last, on one line under the bubble', () => {
    const row = userRow('look at b too');
    const { container } = renderRow(row, { actions: { ...spyActions(), userRowMark: () => ({ shown: 'Sent to Claude', name: 'Sent to Claude' }) } });
    const line = lineOf(container)!;
    expect(line.previousElementSibling?.classList.contains('transcript-user-body')).toBe(true);
    expect(wordsOf(line)).toEqual([formatClock(Date.parse(row.at)), 'Copy', 'Edit', 'Sent to Claude']);
    const caption = line.lastElementChild!;
    expect(caption.classList.contains('transcript-user-caption')).toBe(true);
    expect(caption.getAttribute('title')).toBe('Sent to Claude'); // a narrow pane cuts it with an ellipsis (R14)
    expect(line.querySelector('.transcript-user-line-actions')!.contains(screen.getByRole('button', { name: 'Copy' }))).toBe(true);
    expect(container.querySelector('.transcript-user-actions, .transcript-user-meta')).toBeNull(); // W2's overlay and its meta line are gone
  });

  it('holds the time, Copy and Edit alone where no caption follows; a dropped prompt’s Not sent takes the caption’s place', () => {
    const plain = renderRow(userRow('plain'));
    expect(wordsOf(lineOf(plain.container)!)).toEqual([expect.any(String), 'Copy', 'Edit']);
    expect(lineOf(plain.container)!.lastElementChild!.classList.contains('transcript-user-line-actions')).toBe(true);
    cleanup();
    const dropped = renderRow({ ...userRow('later'), dropped: true });
    const notSent = lineOf(dropped.container)!.lastElementChild!;
    expect(notSent.textContent).toBe('Not sent');
    expect(notSent.classList.contains('transcript-not-sent')).toBe(true);
    expect(notSent.getAttribute('title')).toBe('Not sent');
  });

  it('draws no Edit where the message is not editable, and keeps the time and Copy', () => {
    const { container } = renderRow({ ...userRow('a message of several comments'), editable: false });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(wordsOf(lineOf(container)!)).toEqual([expect.any(String), 'Copy']);
  });

  it('draws no line under MAWS’s “You approved” line', () => {
    const { container } = renderRow({ ...userRow('approve and retry'), consent: { kind: 'command', subject: 'npm test' } });
    expect(container.querySelector('.transcript-consent')).not.toBeNull();
    expect(container.querySelector('.transcript-user-line')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  // R20: at rest the time, Copy and Edit take no width, yet stay in the tab order: Tab from the message's row reaches Copy.
  it('keeps Copy and Edit in the tab order at rest', async () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8') + readFileSync(join(__dirname, '../transcript.css'), 'utf8');
    document.head.append(style);
    onTestFinished(() => style.remove());
    const { container } = renderRow({ ...userRow('look at b too'), pending: 'held' as const });
    const user = userEvent.setup();
    container.querySelector<HTMLElement>('.transcript-row')!.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy' }));
    expect(getComputedStyle(lineOf(container)!.querySelector('.transcript-user-line-actions')!).display).not.toBe('none');
  });

  // Decision 10: the desk's own chat bubble writes W2's markup by hand (an actions group inside the bubble's body), and
  // the old rule still styles it there; MAWS's own line is in flow under the bubble.
  it('keeps W2’s overlay rule for an actions group inside the bubble’s body, and lays MAWS’s line in flow', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(join(__dirname, '../transcript.css'), 'utf8');
    document.head.append(style);
    onTestFinished(() => style.remove());
    const desk = document.createElement('section');
    desk.className = 'transcript-user';
    desk.innerHTML = '<div class="transcript-user-body"><div class="transcript-user-bubble" data-bubble=""></div><div class="transcript-user-actions"><button type="button">Copy</button></div></div>';
    document.body.append(desk);
    onTestFinished(() => desk.remove());
    expect(getComputedStyle(desk.querySelector('.transcript-user-actions')!).position).toBe('absolute');
    const { container } = renderRow(userRow('plain'));
    expect(getComputedStyle(lineOf(container)!).position).not.toBe('absolute');
  });

  it('renders a pasted block as a chip inside the bubble that expands to its body as text, and keeps typed <\\pasted_content> intact', () => {
    const { container } = renderRow(userRow(fixture.sent));
    const bubble = container.querySelector('[data-bubble]')!;
    expect(bubble.textContent).toContain('see <\\pasted_content> below'); // no raw-HTML deletion of the typed text
    const chip = screen.getByRole('button', { name: /Pasted text #1 · 40 lines/ });
    expect(bubble.contains(chip)).toBe(true);
    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    const pre = container.querySelector('pre')!;
    expect(pre.textContent).toBe(fixture.pasted[0].body);
    expect(pre.querySelector('*')).toBeNull(); // text only, never markdown
    expect(bubble.textContent).toContain('thanks');
  });

  it('splits the bubble only where a pasted block was: the same placeholder shape typed by the human stays text', () => {
    const typed = '[Pasted text #1 +40 lines]';
    const { container } = renderRow(userRow(`${typed} is what I typed\n${fixture.sent}`));
    expect(screen.getAllByRole('button', { name: /Pasted text #1 · 40 lines/ })).toHaveLength(1);
    expect(container.querySelector('[data-bubble]')!.textContent).toContain(`${typed} is what I typed`);
  });

  it('shows an image attachment inline from its data URL', () => {
    const { container } = renderRow(userRow([{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }]));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('marks a dropped prompt Not sent', () => {
    const row = { ...userRow('later'), dropped: true };
    const { container } = renderRow(row);
    expect(screen.getByText('Not sent')).toBeDefined();
    expect(container.querySelector('[data-dropped]')).not.toBeNull();
  });

  it('says why a dropped prompt never ran when its mount knows, in place of Not sent; other rows keep their captions', () => {
    const actions = { ...spyActions(), droppedRowMark: () => 'Not read: the turn was undone' };
    const { container } = renderRow({ ...userRow('later'), dropped: true }, { actions });
    expect(container.querySelector('.transcript-user-line > .transcript-not-sent')?.textContent).toBe('Not read: the turn was undone');
    cleanup();
    const steered = renderRow({ ...userRow('look at b too'), pending: 'next' as const }, { actions });
    expect(steered.container.textContent).toContain('Sends at the next step');
    expect(steered.container.textContent).not.toContain('Not read');
    expect(steered.container.querySelector('[data-dropped]')).toBeNull();
  });
});

// W1 (A2): a message waiting for the engine is a dimmed bubble saying what it waits for; a steer the engine took sits in
// the turn at full strength, with no caption (the word cut, T42).
describe('waiting and steered bubbles', () => {
  it('a waiting next steer and a held message are dimmed with their captions, and offer no Edit', () => {
    const next = { ...userRow('look at b too'), pending: 'next' as const };
    const { container } = renderRow(next);
    expect(container.querySelector('[data-pending="next"]')).not.toBeNull();
    expect(container.textContent).toContain('Sends at the next step');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    cleanup();
    const held = renderRow({ ...userRow('after the turn'), pending: 'held' as const });
    expect(held.container.querySelector('[data-pending="held"]')).not.toBeNull();
    expect(held.container.textContent).toContain('Sends when this turn ends');
  });

  it('a steer the engine took sits at full strength with no caption; a mount’s own mark may stand in its place', () => {
    const { container } = renderRow({ ...userRow('look at b too'), steer: true });
    expect(container.querySelector('[data-pending]')).toBeNull();
    expect(container.querySelector('[data-steer]')).not.toBeNull();
    expect(container.textContent).not.toContain('Sent during this turn');
    expect(container.querySelector('.transcript-user-caption')).toBeNull();
    expect(container.querySelector('section.transcript-user > .transcript-user-line')!.lastElementChild!.classList.contains('transcript-user-line-actions')).toBe(true);
    cleanup();
    const marked = renderRow({ ...userRow('look at b too'), steer: true }, { actions: { ...spyActions(), userRowMark: () => ({ shown: 'Sent to Claude', name: 'Sent to Claude' }) } });
    expect(marked.container.querySelector('.transcript-user-caption')?.textContent).toBe('Sent to Claude');
  });

  // the word cut (P443): a mount's mark drawn as a glyph keeps its words as its name and its tooltip
  it('a mark drawn as a glyph is named by its words, its tooltip reached by the keyboard', async () => {
    const { container } = renderRow(userRow('look at b too'), { actions: { ...spyActions(), userRowMark: () => ({ shown: '✓', name: 'Sent to Claude' }) } });
    const caption = container.querySelector<HTMLElement>('.transcript-user-caption')!;
    expect(caption.textContent).toBe('✓');
    expect(screen.getByRole('img', { name: 'Sent to Claude' })).toBe(caption);
    expect(caption.getAttribute('title')).toBeNull();
    await userEvent.tab();
    while (document.activeElement !== caption && document.activeElement !== document.body) await userEvent.tab();
    expect(document.activeElement).toBe(caption);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Sent to Claude');
  });
});
