// The forms MAWS composes and sends as the person's message around words a model, a command or a page wrote (UX wave
// U6e, board ticket 675, the save rule's `CLAIMED`; UX wave U1c, rule R's step 1b, the architect's ruling 3865). One list,
// each form with its reader, what it is, and what it counts for:
// - for saves: the reader of the person's own text (src/shared/files/named.ts, `ownTexts`) names no path for a save in a
//   text any of these readers claims;
// - for grants: the reader of the grants in a person's message (src/shared/engine/arrival.ts, `personsLines`) reads no
//   grant in a message whose whole joined text holds one, nothing set aside.
// The two readers ask the same reader for each form and differ in the flag alone. A consent whose own command quotes a
// form's words is its grant alone (the sentence whole) and none joined with another message: an accepted cost (the
// architect's ruling of 2026-11-16, which withdrew an exemption of whole-sentence lines a relay's model-written agent
// name could forge).
// A leaf: it imports the forms' own constants and readers, and nothing that imports arrival.ts or named.ts.
import { ANCHOR_TAG_OPENING, PROMOTION_HEAD } from '../anchor/message';
import { ASK_STEER_OPENING } from '../maws/ask';
import { LINKED_READ_OPENING } from '../maws/linked-read';
import { RELAY_CONTINUE } from '../maws/relay-text';
import { answersOf } from '../owner/answer';
import { COMMAND_NAME_OPENING, LOCAL_COMMAND_OUTPUT_OPENINGS, TYPED_COMMAND } from '../wire/local-command';
import { quotesGrant } from './grant';
import { BASH_INPUT_OPENING, PLAN_LEAD } from './host-prompts';

/** A reader's work, as the save rule meters it: a constant's search one native pass over the text. */
export type FormWork = { steps: number };

export interface ComposedForm {
  what: string;
  /** Whether the text holds the form, anywhere; it charges its work to `work`. */
  claims: (text: string, work: FormWork) => boolean;
  forSaves: boolean;
  forGrants: boolean;
}

const holds = (needle: string) => (text: string, work: FormWork) => {
  work.steps += text.length + 1;
  return text.includes(needle);
};
// The typed command's pattern at any line's start: the engine reads one only at a message's start, and a message MAWS
// joined to other words after a newline is read only all the same (the guard's forms, test/support/person-sends.test.ts)
const COMMAND_LINE = new RegExp(TYPED_COMMAND.source, 'm');
const LOCAL_COMMAND_OUTPUT = new RegExp(LOCAL_COMMAND_OUTPUT_OPENINGS.join('|')); // no character of the openings is special

// In the order the save rule has always asked them.
export const COMPOSED_FORMS: readonly ComposedForm[] = [
  { what: 'an artifact’s read the host attached (engine-host/linked-reads.ts)', claims: holds(LINKED_READ_OPENING), forSaves: true, forGrants: true },
  // Not for grants: rule R reads envelopes itself, the strict take-out of this build's form and step 2's tag test for
  // any other; counted here, every message beside an answer would lose its grant
  { what: 'MAWS’s answer envelope, either form (engine-host/session-maws.ts)', claims: holds(ASK_STEER_OPENING), forSaves: true, forGrants: false },
  // Not for grants: the consent sentence opens with the grant's opening, so counted here it would refuse every consent
  { what: 'MAWS’s consent, or any text quoting the grant’s opening', claims: (text, work) => quotesGrant(text, work), forSaves: true, forGrants: false },
  {
    what: 'an owner question’s answer line (a retired writer: renderer owner/report/answering.ts)',
    claims: (text, work) => {
      work.steps += 2 * text.length + 1;
      return answersOf(text).length > 0;
    },
    forSaves: true,
    forGrants: true,
  },
  { what: 'the plan handed back after a clear (engine-host/session-clear.ts)', claims: holds(PLAN_LEAD), forSaves: true, forGrants: true },
  { what: 'the echo of a `!` command and its output (engine-host/bash-mode.ts)', claims: holds(BASH_INPUT_OPENING), forSaves: true, forGrants: true },
  { what: 'a side question promoted to a thread, the model’s answers in it (anchor/message.ts `promotionMessage`)', claims: holds(PROMOTION_HEAD), forSaves: true, forGrants: true },
  { what: 'a relay to an agent or a peer (renderer tools/agents/model/relay.ts)', claims: holds(RELAY_CONTINUE), forSaves: true, forGrants: true },
  { what: 'a slash command as the engine records it (ruling C)', claims: holds(COMMAND_NAME_OPENING), forSaves: true, forGrants: true },
  // UX wave U1c, the review round's R4: a command's output is the command's words, not the person's; for saves as the `!`
  // echo is, the same fail-closed direction (a text holding one names no path). One native pass for the four openings
  {
    what: 'a local command’s output as the engine records it (`<bash-stdout>`, `<bash-stderr>`, `<local-command-stdout>`, `<local-command-stderr>`)',
    claims: (text, work) => {
      work.steps += text.length + 1;
      return LOCAL_COMMAND_OUTPUT.test(text);
    },
    forSaves: true,
    forGrants: true,
  },
  // Not for grants: a typed command's arguments are the person's own typing, so a sentence on a line after it is theirs
  {
    what: 'a slash command as typed (ruling C), at the start of any line of the text',
    claims: (text, work) => {
      work.steps += text.length + 1;
      return COMMAND_LINE.test(text);
    },
    forSaves: true,
    forGrants: false,
  },
  // Not for saves: the save rule reads an anchored message whole in a step of its own (ruling B), its comments' words the
  // person's; for grants the tag says the page's words, a promotion's or a comment's anchor, are in the message
  { what: 'an anchored comment’s tag, a comment’s or a promoted side question’s (anchor/message.ts)', claims: holds(ANCHOR_TAG_OPENING), forSaves: false, forGrants: true },
];

/** The readers the save rule asks, in order. */
export const CLAIMED_FOR_SAVES: readonly ComposedForm['claims'][] = COMPOSED_FORMS.filter((form) => form.forSaves).map((form) => form.claims);

const FOR_GRANTS = COMPOSED_FORMS.filter((form) => form.forGrants);
/** Whether a text holds any form that counts for grants, anywhere in it. */
export function holdsGrantForm(text: string, work: FormWork): boolean {
  return FOR_GRANTS.some((form) => form.claims(text, work));
}
