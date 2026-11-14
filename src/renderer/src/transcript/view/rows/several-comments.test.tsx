// UX wave U5a (M5; docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §H, decision 13, the
// owner's answer "Under its own comment"): a message of several comments is one bubble, each comment's chip over its own
// text and its own screenshot, in the order made; the images no comment claimed come after the comments, as a message's
// attachments do. The bubble offers Copy, which gives each comment's lead and text, and no Edit.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commentsMessage, type MessageComment } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { ContentBlock } from '@shared/graph/events';
import { rowsOf } from '../../model/derive';
import { applyEvents, createState } from '../../model/reduce';
import { builder, uuid } from '../../model/test-events';
import { renderRow, rowOf } from './test-support';

afterEach(cleanup);

const SAVE: Anchor = { kind: 'browser-element', label: 'Save button', locator: 'form > button.save', pageUrl: 'https://example.com/signup' };
const TITLE: Anchor = { kind: 'browser-element', label: 'Page title', locator: 'main > h1', pageUrl: 'https://example.com/signup' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBAGADWLC/WeCk2QAAAAAElFTkSuQmCC';
const image = (data: string): ContentBlock => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
const comments = (screenshots: [boolean, boolean]): MessageComment[] => [
  { anchor: SAVE, text: 'Make this the primary action.', screenshot: screenshots[0] },
  { anchor: TITLE, text: 'Shorter, please.', screenshot: screenshots[1] },
];

const rowWith = (content: string | ContentBlock[]) => {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
  b.emit('user.message', { messageUuid: uuid('u1'), content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  return rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user');
};

// What the bubble draws, in document order: each chip by its label, each comment's text, each image by its source.
function drawnInOrder(container: HTMLElement): string[] {
  const content = container.querySelector('[data-user-content]')!;
  return [...content.querySelectorAll('[data-chip="anchor"], p, img')].map((element) =>
    element.matches('[data-chip="anchor"]') ? `chip:${element.textContent}` : element.tagName === 'IMG' ? `image:${(element as HTMLImageElement).src.slice(-4)}` : `text:${element.textContent}`,
  );
}

describe('the bubble of several comments', () => {
  it('draws each comment’s chip over its own text, in the order made, with none of the framing', () => {
    const { container } = renderRow(rowWith(commentsMessage(comments([false, false]), 'main')));
    expect(drawnInOrder(container)).toEqual(['chip:Save button', 'text:Make this the primary action.', 'chip:Page title', 'text:Shorter, please.']);
    const text = container.querySelector('[data-user-content]')!.textContent!;
    expect(text).not.toContain('maws_anchor');
    expect(text).not.toContain('Comment on');
    expect(text).not.toContain('in the order made');
  });

  it('draws each screenshot under its own comment', () => {
    const { container } = renderRow(rowWith([image(`${PNG.slice(0, -4)}AAAA`), image(PNG), { type: 'text', text: commentsMessage(comments([true, true]), 'thread') }]));
    expect(drawnInOrder(container)).toEqual(['chip:Save button', 'text:Make this the primary action.', 'image:AAAA', 'chip:Page title', 'text:Shorter, please.', `image:${PNG.slice(-4)}`]);
  });

  it('draws the images together after the comments when they cannot be paired', () => {
    const fewer = renderRow(rowWith([image(PNG), { type: 'text', text: commentsMessage(comments([true, true]), 'main') }]));
    expect(drawnInOrder(fewer.container)).toEqual(['chip:Save button', 'text:Make this the primary action.', 'chip:Page title', 'text:Shorter, please.', `image:${PNG.slice(-4)}`]);
    cleanup();
    const unannounced = renderRow(rowWith([image(PNG), { type: 'text', text: commentsMessage(comments([false, false]), 'main') }]));
    expect(drawnInOrder(unannounced.container)).toEqual(['chip:Save button', 'text:Make this the primary action.', 'chip:Page title', 'text:Shorter, please.', `image:${PNG.slice(-4)}`]);
  });

  it('offers Copy, which gives each comment’s lead and text, and no Edit', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRow(rowWith(commentsMessage(comments([true, false]), 'main')));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(
      'Comment on "Save button" (element form > button.save on https://example.com/signup):\nMake this the primary action.\n\nComment on "Page title" (element main > h1 on https://example.com/signup):\nShorter, please.',
    );
  });

  it('a message of one comment still offers Edit (today’s row)', () => {
    renderRow(rowWith(commentsMessage([comments([false, false])[0]!], 'main')));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
  });
});
