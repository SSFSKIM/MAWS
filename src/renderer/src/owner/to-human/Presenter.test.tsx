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
it('renders choice-only questions beside a report without losing their options', () => {
  render(draw('<to-human>Report.</to-human><need-input><choice recommended>A</choice><choice>B</choice></need-input>'));
  expect(screen.getByText('Report.')).toBeTruthy();
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['ARecommended', 'B']);
  expect(screen.getByText('Resume this session to answer.')).toBeTruthy();
});
it('passes malformed choice markup through Markdown as literal text', () => {
  const view = render(draw('<need-input>Pick.\n<choice>A<choice>B</choice></need-input>'));
  expect(view.container.textContent).toContain('<choice>A<choice>B</choice>');
  expect(view.container.querySelector('choice')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
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
// P2-E1: a presentation with a Reply field under it (the comment card's) answers there, so it does not say to resume
it('leaves the resume line out when the drawing is answerable', () => {
  render(assistantPresentation('<need-input>Which path?\n<choice>A</choice></need-input>')!.render({ showRecord: false, live: false, recordKey: 'test', answerable: true }));
  expect(screen.getByText('Which path?')).toBeTruthy();
  expect(screen.queryByText(/Resume this session to answer/)).toBeNull();
});
