import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { applyEvents, createState } from '../../model/reduce';
import { rowsOf } from '../../model/derive';
import { builder, uuid } from '../../model/test-events';
import { Disclosures } from '../context';
import { renderRow, rowOf } from './test-support';

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

  // W2 (B2): the time, Copy and Edit sit in one overlay beside the bubble, apart from the captions that always show.
  it('keeps the hover actions in their overlay and the captions under the bubble', () => {
    const { container } = renderRow({ ...userRow('later'), dropped: true });
    const overlay = container.querySelector('.transcript-user-actions')!;
    expect(overlay.contains(screen.getByRole('button', { name: 'Copy' }))).toBe(true);
    expect(overlay.contains(screen.getByRole('button', { name: 'Edit' }))).toBe(true);
    expect(overlay.contains(screen.getByText('Not sent'))).toBe(false);
    expect(container.querySelector('.transcript-user-meta')?.textContent).toBe('Not sent');
    cleanup();
    expect(renderRow(userRow('plain')).container.querySelector('.transcript-user-meta')).toBeNull(); // nothing reserved
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
    renderRow(row);
    expect(screen.getByText('Not sent')).toBeDefined();
  });
});

// W1 (A2): a message waiting for the engine is a dimmed bubble saying what it waits for; a steer the engine took says
// it was sent during the turn it sits in.
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

  it('a steer the engine took reads Sent during this turn, at full strength', () => {
    const { container } = renderRow({ ...userRow('look at b too'), steer: true });
    expect(container.querySelector('[data-pending]')).toBeNull();
    expect(container.querySelector('[data-steer]')).not.toBeNull();
    expect(container.textContent).toContain('Sent during this turn');
  });
});
