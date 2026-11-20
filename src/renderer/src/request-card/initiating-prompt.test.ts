// UX wave U5a (M5; Decision Log 49): the prompt a refusal interrupted is the newest of the person's own prompts in a turn
// the person started, a message of several comments included, never the prompt before it.
import { describe, expect, it } from 'vitest';
import { commentsMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { MessageUuid } from '@shared/graph/ids';
import { loadJournal } from '../../../../test/support/fixtures';
import { journalToEvents } from '../transcript/dev/journal';
import { turnActivity } from '../transcript/model/activity';
import { rowsOf } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import { builder, uuid } from '../transcript/model/test-events';
import { initiatingPrompt } from './initiating-prompt';

const SAVE: Anchor = { kind: 'browser-element', label: 'Save button', locator: 'form > button.save', pageUrl: 'https://example.com/signup' };
const TITLE: Anchor = { kind: 'browser-element', label: 'Page title', locator: 'main > h1', pageUrl: 'https://example.com/signup' };

describe('initiatingPrompt', () => {
  it('a turn opened by a message of several comments: that message, not the prompt before it', () => {
    const b = builder();
    b.turn('u-1', 'an earlier prompt');
    b.end(['u-1']);
    b.turn('u-2', commentsMessage([{ anchor: SAVE, text: 'Make this primary.', screenshot: false }, { anchor: TITLE, text: 'Shorter.', screenshot: false }], 'main'));
    const state = applyEvents(createState(null, null), b.events);
    const prompt = initiatingPrompt(rowsOf(state), turnActivity(state));
    expect(prompt).toMatchObject({ messageUuid: uuid('u-2'), editable: false, comments: [{ anchor: SAVE, text: 'Make this primary.' }, { anchor: TITLE, text: 'Shorter.' }] });
  });

  // board ticket 714: a turn the person's answer to an asynchronous question opened alone (pass3/p1-maws-ask-async: the
  // prompt's turn ends at seq 153, the answer's envelope, written at the next step at seq 120, opens the next turn at
  // seq 163) holds no prompt of the person's own, so Edit prompt has none to open there; it never reaches back to the
  // turn before
  it('a turn opened by an answer alone: none, never the prompt of the turn before it', () => {
    const journal = loadJournal('pass3', 'p1-maws-ask-async');
    const resolve = (upTo: number) => {
      const state = applyEvents(createState(null, null), journalToEvents(journal.filter((row) => row.seq <= upTo)));
      return initiatingPrompt(rowsOf(state), turnActivity(state));
    };
    expect(resolve(153)?.messageUuid).toBe('e26615e0-8187-4ee5-aa9e-b25b8fa7660d' as MessageUuid); // the prompt's own turn
    expect(resolve(Infinity)).toBeNull(); // the answer's turn
  });
});
