import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { assistantPresentation } from './Presenter';

afterEach(cleanup);
const draw = (text: string, showRecord = false) => assistantPresentation(text)?.render({ showRecord, live: false, recordKey: 'test' });

it.each([
  ['to-human', 'to human'], ['essential', 'essential'], ['insight', 'insight'], ['need-input', 'need input'],
])('draws %s with a label over its Markdown body', (tag, label) => {
  const view = render(draw(`<${tag}>First **span**.\n\n<unknown>literal</unknown></${tag}>`));
  expect(screen.getByText(label)).toBeTruthy();
  expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('span');
  expect(view.container.textContent).toContain('<unknown>literal</unknown>');
  expect(view.container.querySelector('unknown')).toBeNull();
  if (tag === 'insight') expect(screen.getByRole('complementary')).toBeTruthy();
  if (tag === 'essential') expect(view.container.querySelector('[data-owner-span="essential"]')?.className).toContain('font-semibold');
});
it('puts a question above inert choices, marks the recommendation and explains resuming', () => {
  const view = render(draw('<need-input>Which path?\n<choice recommended>One **fast** path</choice>\n<choice>Two</choice></need-input>'));
  expect(view.container.querySelectorAll('button, input, [role="button"]')).toHaveLength(0);
  expect(screen.getByRole('list').textContent).toContain('Recommended');
  expect(screen.getByText(/Resume this session to answer/)).toBeTruthy();
  expect(screen.getByText('Which path?').compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('fast');
});
it('keeps mixed-body commentary inside the work fold and reveals it in source order', () => {
  const text = 'Before.\n<to-human>Report.</to-human>\nAfter.\n<insight>Because.</insight>';
  const view = render(draw(text));
  expect(view.container.textContent).not.toContain('Before.');
  expect(view.container.textContent).not.toContain('After.');
  view.rerender(draw(text, true));
  expect([...view.container.querySelectorAll('.transcript-prose')].map((el) => el.textContent)).toEqual(['Before.', 'Report.', 'After.', 'Because.']);
  expect([...view.container.querySelectorAll('.transcript-commentary')].map((el) => el.textContent)).toEqual(['Before.', 'After.']);
});
it('declines ordinary text and unfinished tags', () => {
  expect(assistantPresentation('Ordinary **answer**.')).toBeNull();
  expect(assistantPresentation('<to-human>unfinished')).toBeNull();
});
