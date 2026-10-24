import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { assistantPresentation, messagePresentation } from './Presenter';

afterEach(cleanup);
const draw = (text: string, live = false) => assistantPresentation(text)?.render({ live });

it('keeps a message in its authored paragraph without hiding surrounding text or adding labels', () => {
  const view = render(draw('Before <message>for **you**</message> after.'));
  expect(view.container.textContent).toBe('Before for you after.');
  expect(view.container.querySelectorAll('p')).toHaveLength(1);
  expect(view.container.querySelector('.owner-message-ink')?.textContent).toContain('for ');
  expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('you');
  expect(view.container.querySelector('[data-owner-card], [data-owner-report], button')).toBeNull();
});

it.each([false, true])('preserves lists and backtick Critical/Insight rules across a closed message (live=%s)', (live) => {
  const text = '<message>\n1. First\n2. Second\n\n`⚠ Critical ─────────`\nKeep a backup.\n`──────────────────`\n\n`★ Insight ─────────`\nWhy it works.\n`──────────────────`\n</message>\n\nAfter.';
  const view = render(draw(text, live));
  expect([...view.container.querySelectorAll('li')].map((node) => node.textContent)).toEqual(['First', 'Second']);
  expect([...view.container.querySelectorAll('code')].map((node) => node.textContent)).toEqual(['⚠ Critical ─────────', '──────────────────', '★ Insight ─────────', '──────────────────']);
  expect(view.container.textContent).toContain('Keep a backup.');
  expect(view.container.textContent).toContain('Why it works.');
  expect(view.container.textContent).toContain('After.');
  expect(view.container.textContent).not.toContain('<message>');
  expect(view.container.querySelector('[data-owner-card], aside, button')).toBeNull();
});

it('hides closed legacy marks without cards or tint, and keeps quoted message tags literal', () => {
  const view = render(draw('<message>Report.</message>\n\n<essential>Risk.</essential>\n<insight>Reason.</insight>\n\n`<message>example</message>`'));
  expect(view.container.textContent).toContain('Risk.');
  expect(view.container.textContent).not.toContain('<essential>');
  expect(view.container.textContent).toContain('Reason.');
  expect(view.container.textContent).not.toContain('<insight>');
  expect([...view.container.querySelectorAll('.owner-message-ink')].map((node) => node.textContent).join('')).toBe('Report.');
  expect(view.container.querySelector('code')?.textContent).toBe('<message>example</message>');
  expect(view.container.querySelector('code .owner-message-ink')).toBeNull();
});

it('declines ordinary text, quoted tags, and unfinished messages', () => {
  for (const text of ['Ordinary **answer**.', '<message>unfinished', '`<message>example</message>`', '```xml\n<message>example</message>\n```']) {
    expect(assistantPresentation(text)).toBeNull();
  }
});

it('leaves an unfinished message literal beside a closed one, even while streaming', () => {
  const view = render(draw('<message>Done.</message>\n\n<message>Not done', true));
  expect(view.container.textContent).toContain('Done.');
  expect(view.container.textContent).toContain('<message>Not done');
});

it('supports historical to-human messages without adding structure for nested legacy marks', () => {
  const view = render(draw('<to-human>Before <insight>Why.</insight> after.</to-human>'));
  expect(view.container.textContent).toBe('Before Why. after.');
});

it('message-tool content has the same unboxed ink and authored Markdown', () => {
  const view = render(messagePresentation('Stage **one** done.'));
  expect(view.container.textContent).toBe('Stage one done.');
  expect(view.container.querySelector('.owner-message-ink')).not.toBeNull();
  expect(view.container.querySelector('[data-owner-card], [data-owner-report]')).toBeNull();
});

it('legacy questions keep their written options without adding controls or recommendation labels', () => {
  const view = render(draw('<need-input>Which?\n<choice recommended>One</choice>\n<choice>Two</choice></need-input>'));
  expect(view.container.textContent).toBe('Which?\nOne\nTwo');
  expect(view.container.querySelector('button, input, .owner-message-ink')).toBeNull();
});
