import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyEvents, createState } from '../../model/reduce';
import { rowsOf } from '../../model/derive';
import { builder, uuid } from '../../model/test-events';
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
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('title')).toBe('Edit and resubmit forks history');
  });

  it('copies the text with pasted blocks restored, untagged', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRow(userRow(fixture.sent));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(`${fixture.typed}\n${fixture.pasted[0].body}\nthanks`);
  });

  it('collapses past 20 lines behind Show more, and Show less folds it again', () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const { container } = renderRow(userRow(long));
    const bubble = container.querySelector('[data-bubble]')!;
    expect(bubble.hasAttribute('data-collapsed')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(bubble.hasAttribute('data-collapsed')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(bubble.hasAttribute('data-collapsed')).toBe(true);
  });

  it('a short message has no collapse control', () => {
    renderRow(userRow('one line'));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
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
