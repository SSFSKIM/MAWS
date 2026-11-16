// The native presenter (UX wave U2b, M2; A12): each message drawn as the mod draws it, its label then its body, inside
// the text's one Markdown tree. Every older mark is a message and each run of text under one mark its own; a completed
// text draws a message only for a mark that closes, a streaming one also for a mark still open at its end. The
// label's own cases (bullet, slot, streaming, a closed head) are `owner/view/message.test.tsx`'s.
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { assistantPresentation, messagePresentation } from './Presenter';

afterEach(cleanup);
const draw = (text: string, live = false) => assistantPresentation(text, live)?.render({ live });
const inks = (container: HTMLElement) => [...container.querySelectorAll('.owner-message-ink')].map((node) => node.textContent?.trim());

it('keeps a message inside a line in its authored paragraph, under its label, with no card or control', () => {
  const view = render(draw('Before <message>for **you**</message> after.'));
  expect(view.container.textContent).toBe('● messageBefore for you after.');
  expect(view.container.querySelectorAll('p')).toHaveLength(1);
  expect(view.container.querySelectorAll('.owner-message-label')).toHaveLength(1);
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

it('draws every older mark as a message, and keeps quoted message tags literal', () => {
  const view = render(draw('<message>Report.</message>\n\n<essential>Risk.</essential>\n<insight>Reason.</insight>\n\n`<message>example</message>`'));
  expect(inks(view.container)).toEqual(['● messageReport.', 'messageRisk.', 'messageReason.']);
  expect(view.container.textContent).not.toMatch(/<essential>|<insight>/);
  expect(view.container.querySelector('code')?.textContent).toBe('<message>example</message>');
  expect(view.container.querySelector('.owner-message-ink code')).toBeNull();
});

it('draws one message around a multi-block mark and leaves narration on neighbouring lines outside it', () => {
  const view = render(draw('Private notes.\n<message>\nFirst **point**.\n\n- one\n- two\n\n```js\nlet x = 1;\n```\n</message>\nMore notes.'));
  const marks = view.container.querySelectorAll('.owner-message-ink');
  expect(marks).toHaveLength(1);
  expect([...marks[0]!.children].map((node) => node.tagName)).toEqual(['DIV', 'P', 'UL', 'DIV']); // the label, then the blocks
  expect(marks[0]!.textContent).toContain('First point.');
  expect(marks[0]!.textContent).toContain('let x = 1;');
  expect(marks[0]!.textContent).not.toContain('notes');
  expect(view.container.textContent).toContain('Private notes.');
  expect(view.container.textContent).toContain('More notes.');
  expect(view.container.querySelector('.owner-message-ink .owner-message-ink')).toBeNull();
});

it('splits a mark nested in a message into runs, each a message of its own', () => {
  const view = render(draw('<message>A\n\n<insight>B</insight>\n\nC</message>'));
  expect(inks(view.container)).toEqual(['● messageA', 'messageB', 'messageC']);
});

it('draws each of two adjacent messages once, and an older mark alone as a message', () => {
  const two = render(draw('<message>A</message>\n\n<message>B</message>\n\nC'));
  expect(inks(two.container)).toEqual(['● messageA', 'messageB']);
  expect(two.container.textContent).toContain('C');
  cleanup();
  const legacy = render(draw('<essential>Risk.</essential>'));
  expect(inks(legacy.container)).toEqual(['● messageRisk.']);
});

it('declines ordinary text and quoted tags, and an unfinished message unless the text streams', () => {
  for (const text of ['Ordinary **answer**.', '<message>unfinished', '`<message>example</message>`', '```xml\n<message>example</message>\n```']) {
    expect(assistantPresentation(text)).toBeNull();
  }
  expect(assistantPresentation('<message>unfinished', true)).not.toBeNull();
  expect(assistantPresentation('`<message>example`', true)).toBeNull();
});

it('leaves an unfinished message literal beside a closed one once the text has completed', () => {
  const view = render(draw('<message>Done.</message>\n\n<message>Not done'));
  expect(inks(view.container)).toEqual(['● messageDone.']);
  expect(view.container.textContent).toContain('<message>Not done');
});

it('keeps a historical to-human message whose nested mark stays inside its line in one paragraph', () => {
  const view = render(draw('<to-human>Before <insight>Why.</insight> after.</to-human>'));
  expect(view.container.textContent).toBe('● messageBefore Why. after.');
});

it('draws a message-tool call as the same message, its label with the bullet', () => {
  const view = render(messagePresentation('Stage **one** done.'));
  expect(inks(view.container)).toEqual(['● messageStage one done.']);
  expect(view.container.querySelector('[data-owner-card], [data-owner-report]')).toBeNull();
});

it.each([false, true])('keeps entity and backslash-escaped tag examples literal beside real marks (live=%s)', (live) => {
  const view = render(draw('Use &lt;message&gt;entity&lt;/message&gt; and \\<message>escaped\\</message> literally.\n<message>Real **message**.</message>\nThen &#60;message&#62;numeric&#60;/message&#62;.\n\n<message>Done.</message>\n\nUse &lt;message&gt;example&lt;/message&gt; literally.', live));
  expect([...view.container.querySelectorAll('p')].map((node) => node.textContent)).toEqual([
    'Use <message>entity</message> and <message>escaped</message> literally.',
    'Real message.',
    'Then <message>numeric</message>.',
    'Done.',
    'Use <message>example</message> literally.',
  ]);
  expect(inks(view.container)).toEqual(['● messageReal message.', 'messageDone.']);
});

it('does not take escaped-tag-only commentary for a message', () => {
  for (const text of ['Use &lt;message&gt;example&lt;/message&gt; literally.', 'Use \\<message>example\\</message> literally.', '&#60;essential&#62;example&#60;/essential&#62;']) {
    expect(assistantPresentation(text)).toBeNull();
  }
});

it('draws an older question as a message that keeps its written options, with no control or recommendation label', () => {
  const view = render(draw('<need-input>Which?\n<choice recommended>One</choice>\n<choice>Two</choice></need-input>'));
  expect(view.container.textContent).toBe('● messageWhich?\nOne\nTwo');
  expect(view.container.querySelector('button, input')).toBeNull();
});
