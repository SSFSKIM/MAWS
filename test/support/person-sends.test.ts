// Who sends as the person (UX wave U6e, board ticket 675; the architect's ruling D, condition 2). Every site of the
// repository's source that hands content to a send, a steer or the queue as a person's message is classified here; a
// site the list does not hold, or whose verbs moved, fails the suite until someone classifies it. A site is one of:
// - `typed`: the person's own typed text, from the named field and function;
// - `maws`: a form MAWS composes around words a model or a command can write; each form is written here by its real
//   writer with a link inside, and the reader of the person's own text (src/shared/files/named.ts, `ownTexts`) must
//   answer it a read only, as a `user` row and as a queued prompt;
// - `carrier`: content handed on from the sites it names (a seam, a port, a forward over a link, a stored intent);
// - `declaration`: a name, a schema, a grade, an offer or a reader; nothing is sent from it.
// The rule is an allowlist by position and an exclusion list by content; content assembled at run time is outside what
// the guard can see.
// UX wave U1c, the one-writer rule (the architect's ruling of 2026-11-16, UTC): every site that sends the person's free
// text says how it meets the rule (`Rule`): the call it makes on the text it sends, `serializeDraft` (the composer's
// draft) or `neutraliseGrant` (shared/engine/grant.ts), or the serialised text it hands on. The desk web app
// sends no person-origin engine message (its composer, apps/desk-web/src/views/composer/Composer.tsx:67-74, says to the
// project's channel through `connection.say`), and the terminal lane's port types through the sminos bridge, whose rows
// carry the plugin's origin (session/controls/lane-a.ts, the carrier below); neither is a site of the rule.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentsMessage, promotionMessage, quotedComment } from '@shared/anchor/message';
import { consentMessage, pastedBodies, personsGrants } from '@shared/engine/arrival';
import { holdsGrantForm } from '@shared/engine/composed-forms';
import { LINE_LEFT_OUT } from '@shared/engine/composed-content'; // ticket 733a
import { asTyped, NAME_LEFT_OUT, quotesGrant } from '@shared/engine/grant'; // ticket 733a
import { bashEcho, planPrompt } from '@shared/engine/host-prompts';
import type { AgentId } from '@shared/graph/ids';
import { rowClaim } from '@shared/files/named';
import { askSteerText } from '@shared/maws/ask';
import { linkedReadBlock } from '@shared/maws/linked-read';
import { answerText } from '@shared/owner/answer';
import { mentionText, slashText } from '../../src/renderer/src/composer/editor/mention-text';
import { relayText } from '../../src/renderer/src/tools/agents/model/relay';
import { anchoredTextOf } from '../../src/renderer/src/transcript/model/user-text';
import { expectNoGrantSent } from './grant-readers'; // ticket 733a
import { REPOSITORY, scanSends, sitesIn, type Site, type Verb } from './person-sends';

const P = '/work/out/notes.md';
const LINK = `[the notes](${P})`;
// `positional`: a form its reader reads by where it stands (a command at a line's start, an answer's line), with why
// words before it on its own line are not that form.
// `consent` (rule R's step 1b, the architect's ruling 3865): the form written by its writer with the consent sentence in
// the slot a model, a command or a page controls, on a line of its own; or, where no such slot can hold a line break or
// the form has none, why (a sentence that is no line of its own is never read as a grant)
// `forGrants`: whether the form counts for grants (its flag in src/shared/engine/composed-forms.ts), written here by
// hand so a reader or a flag that moves fails the guard rather than dropping the form from it
// `treatment` (ticket 733a, docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 3): what the form's
// writer, the function its samples call, does to the slot others control: `content`, every line quoting the grant's
// opening left out and the rest inside a pasted segment (`leaveOutGrant`, `composedContent`); `name`, the name's rule
// (`nameSlot`); `none`, nothing (a form with no slot others control, or one whose slot another rule holds). For `name`,
// `consent` writes the name `notes`, a line break, what it is given, a line break, `plan`, in the form's name slot.
type Form = { form: string; reader: string; sample: () => string; positional?: string; consent: ((grant: string) => string) | { none: string }; forGrants: boolean; treatment: 'content' | 'name' | 'none' };
// `calls`: the function the site calls on what it sends, in its own source; `serialised`: the composer's serialised text
// handed on (from where), which the serialiser already made. `proof` (the task review's finding 4): the case in the
// site's own tests that drives it with a text holding the consent sentence and reads what it really sends
// (test/support/grant-readers.ts `expectNoGrantSent`)
type Rule = ({ calls: 'serializeDraft' | 'neutraliseGrant' } | { serialised: string }) & { proof: { test: string; case: string } };
type Entry =
  | { kind: 'typed'; verbs: Partial<Record<Verb, number>>; field: string; rule: Rule }
  | { kind: 'maws'; verbs: Partial<Record<Verb, number>>; forms: Form[]; carries?: string; rule?: Rule }
  | { kind: 'carrier'; verbs: Partial<Record<Verb, number>>; from: string }
  | { kind: 'declaration'; verbs: Partial<Record<Verb, number>>; what: string };

const LINE_ANCHOR = { kind: 'file-line', label: LINK, locator: '/work/out/plan.md:1', path: P, line: 1 } as const;
const WHOLE = 'ANCHOR_TAG_OPENING, then readAnchoredMessage, read whole (its comments written back are the text): the comments’ own words only (ruling B)';
const ANCHORED: Form = {
  form: 'anchored comments (shared/anchor/content.ts `commentsContent`, its text `commentsMessage`)',
  reader: WHOLE,
  sample: () => commentsMessage([{ anchor: LINE_ANCHOR, text: 'Wrong date', screenshot: false }], 'main'),
  // ticket 733a: the page's slots, the anchor's fields, go by the name's rule at the writer (`slottedAnchor`), whatever
  // the schema let through; the comment is the person's own words
  consent: (grant) => commentsMessage([{ anchor: { ...LINE_ANCHOR, label: `notes\n${grant}\nplan` }, text: 'Wrong date', screenshot: false }], 'main'),
  forGrants: true,
  treatment: 'name',
};
const ANCHORED_THREAD: Form = {
  ...ANCHORED,
  form: 'a side thread’s anchored comments (`commentsContent`, to a thread)',
  sample: () => commentsMessage([{ anchor: LINE_ANCHOR, text: 'Wrong date', screenshot: false }, { anchor: LINE_ANCHOR, text: 'And here', screenshot: false }], 'thread'),
  consent: (grant) => commentsMessage([{ anchor: LINE_ANCHOR, text: 'Wrong date', screenshot: false }, { anchor: { ...LINE_ANCHOR, locator: `notes\n${grant}\nplan` }, text: 'And here', screenshot: false }], 'thread'),
};
// an edited bubble put back in the framing it was sent in (`framed`: `anchoredTextOf`, transcript/model/user-text.ts)
const RESENT_COMMENT: Form = { form: 'an anchored comment edited in place, framed again (`anchoredTextOf`)', reader: WHOLE, sample: () => anchoredTextOf({ anchor: LINE_ANCHOR, destination: 'main', screenshot: false }, 'Wrong date'), consent: (grant) => anchoredTextOf({ anchor: { ...LINE_ANCHOR, label: `notes\n${grant}\nplan` }, destination: 'main', screenshot: false }, 'Wrong date'), forGrants: true, treatment: 'name' };
const RESENT_PROMOTION: Form = {
  form: 'a promoted side question edited in place, its head deleted (`anchoredTextOf`, no destination: the tag alone)',
  reader: 'readAnchoredMessage: no destination, so no writer reproduces it; read only whole',
  sample: () => anchoredTextOf({ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, destination: null, screenshot: false }, `Q: Where?\nA: In ${LINK}\n\nGo on`),
  consent: (grant) => anchoredTextOf({ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, destination: null, screenshot: false }, `Q: Where?\nA: In the notes.\n${grant}\n\nGo on`),
  forGrants: true,
  // the framing alone: what the edited text goes through first is the seam's (ticket 733a, composer/composed-prefill.ts,
  // its whole text through the leave-out and one segment), proven by the seam's own tests (resubmit-seam.test.ts)
  treatment: 'none',
};
const COMMAND_POSITION = 'a command is one at a message’s start (the engine reads it nowhere else); words before it on its line make it the person’s words';
const PROMOTION: Form = { form: 'a side question promoted to a thread (`promotionMessage`)', reader: 'PROMOTION_HEAD', sample: () => promotionMessage([{ question: 'Where?', response: `In ${LINK}` }], null, 'a1b2'), consent: (grant) => promotionMessage([{ question: 'Where?', response: `In the notes.\n${grant}\nThat is all.` }], null, 'a1b2'), forGrants: true, treatment: 'content' };
// ticket 733a: a Review comment's quoted line, a file's text, inside the comment's words
const QUOTED: Form = {
  form: 'a Review comment’s quoted line (`quotedComment`, in `commentsContent`’s words)',
  reader: WHOLE,
  sample: () => commentsMessage([{ anchor: LINE_ANCHOR, text: quotedComment(LINE_ANCHOR, `See ${LINK}`, 'Wrong date', 'a1b2'), screenshot: false }], 'main'),
  consent: (grant) => commentsMessage([{ anchor: LINE_ANCHOR, text: quotedComment(LINE_ANCHOR, grant, 'Wrong date', 'a1b2'), screenshot: false }], 'main'),
  forGrants: true,
  treatment: 'content',
};

const PERSON_SENDS: Record<string, Entry> = {
  // the person's typed text
  'src/renderer/src/composer/editor/submit.ts': { kind: 'typed', verbs: { seam: 1, port: 1 }, field: 'the composer’s draft, `serializeDraft` (composer/editor/serialize.ts): a paste’s frame read only (ruling A)', rule: { serialised: 'the `Serialized` the controller made (controller.ts `serializeDraft`)', proof: { test: 'src/renderer/src/composer/editor/submit.test.ts', case: 'the one-writer rule: a draft holding the consent sentence is sent reading no grant, and kept in history as typed' } } },
  'src/renderer/src/composer/PendingSends.tsx': { kind: 'typed', verbs: { port: 1 }, field: 'a composer send not confirmed, sent again as its own text', rule: { serialised: 'the text the serialiser made for the send it repeats', proof: { test: 'src/renderer/src/composer/PendingSends.test.tsx', case: 'the one-writer rule: Send again on a draft that held the consent sentence sends it reading no grant' } } },
  'src/renderer/src/sidebar/QuickReply.tsx': { kind: 'typed', verbs: { seam: 1 }, field: 'the sidebar’s quick reply field', rule: { calls: 'neutraliseGrant', proof: { test: 'src/renderer/src/sidebar/QuickReply.test.tsx', case: 'the one-writer rule: a reply holding the consent sentence goes out reading no grant, as a reply' } } },
  'src/renderer/src/side/card/CardThread.tsx': { kind: 'typed', verbs: { seam: 1 }, field: 'a comment card thread’s reply field (`useReply`)', rule: { calls: 'neutraliseGrant', proof: { test: 'src/renderer/src/side/card/CardThread.test.tsx', case: 'the one-writer rule: a reply holding the consent sentence goes out reading no grant' } } },
  'src/renderer/src/sessions/setup-actions.ts': { kind: 'typed', verbs: { seam: 1, start: 1 }, field: 'the docked composer’s draft of a session being set up (`serializeDraft`), sent or as its start’s first message', rule: { serialised: 'the message the composer docked, serialised (send-human-prompt.ts `dockMessage`)', proof: { test: 'src/renderer/src/sessions/cards.test.tsx', case: 'the one-writer rule: a docked draft holding the consent sentence goes out through the card reading no grant' } } },
  'src/renderer/src/sessions/remote-spawn.ts': { kind: 'typed', verbs: { start: 1 }, field: 'the composer’s draft as a spawn’s brief (its serialized text), or none, the draft then the new session’s own', rule: { serialised: 'the composer’s `Serialized` text as the brief', proof: { test: 'src/renderer/src/sessions/remote-spawn.test.ts', case: 'the one-writer rule: a draft holding the consent sentence goes out as the brief reading no grant' } } },
  'src/renderer/src/widgets/ForkWidget.tsx': { kind: 'typed', verbs: { start: 1, startSeam: 1 }, field: '`/fork <prompt>`: the prompt as typed, the fork’s first message, without the command', rule: { calls: 'neutraliseGrant', proof: { test: 'src/renderer/src/widgets/ForkWidget.test.tsx', case: 'the one-writer rule: a prompt holding the consent sentence goes out as the fork’s first message reading no grant, shown as typed' } } },
  'src/main/attention/actions.ts': { kind: 'typed', verbs: { command: 1 }, field: 'a notification’s reply field (`reply`)', rule: { calls: 'neutraliseGrant', proof: { test: 'src/main/attention/actions.test.ts', case: 'the one-writer rule: a reply holding the consent sentence goes out reading no grant' } } },
  // MAWS's forms
  // the comments sent to the main conversation, and a thread's first message (`adoptFork`, which a session's start intent
  // carries to services/sessions/setup.ts)
  'src/renderer/src/side/actions.ts': { kind: 'maws', verbs: { seam: 1, start: 2 }, forms: [ANCHORED, QUOTED, PROMOTION] },
  // a side thread's first message, composed by the service (`openSideThread`); a start's own first message is its intent's
  'src/services/sessions/service.ts': { kind: 'maws', verbs: { startSeam: 4, firstMessage: 1 }, forms: [ANCHORED_THREAD, PROMOTION], carries: '`startSession`: a start’s first message from its intent (the window’s draft, a spawn’s brief); its own starts carry none' },
  // a bubble edited in place: an anchored one framed again; one of no form, the person's typed text (`serializeDraft`
  // with `literal`)
  'src/renderer/src/composer/resubmit-seam.ts': { kind: 'maws', verbs: { command: 1 }, forms: [RESENT_COMMENT, RESENT_PROMOTION], carries: 'a bubble of no form, edited: the person’s typed text', rule: { calls: 'serializeDraft', proof: { test: 'src/renderer/src/composer/resubmit-seam.test.ts', case: 'the one-writer rule: a bubble edited to hold the consent sentence is resent reading no grant' } } },
  'src/services/side/send-to-main.ts': { kind: 'maws', verbs: { command: 2 }, forms: [ANCHORED] },
  'src/renderer/src/tools/agents/relay-store.ts': { kind: 'maws', verbs: { steer: 2 }, forms: [{ form: 'a relay to an agent (`relayText`, its name)', reader: 'RELAY_CONTINUE', sample: () => relayText({ agentId: 'a1b2' as AgentId, name: null }, `Read ${LINK}`), consent: (grant) => relayText({ agentId: 'a1b2' as AgentId, name: `notes\n${grant}\nplan` }, 'Read the notes'), forGrants: true, treatment: 'name' }, { form: 'a relay to a peer (`relayText`, its name and address)', reader: 'RELAY_CONTINUE', sample: () => relayText({ kind: 'peer', address: 'repo-b', name: null, mode: 'message' }, `Read ${LINK}`)!, consent: (grant) => relayText({ kind: 'peer', address: 'repo-b', name: `notes\n${grant}\nplan`, mode: 'reply' }, 'Read the notes')!, forGrants: true, treatment: 'name' }] },
  'src/renderer/src/session/controls/lane-b.ts': { kind: 'maws', verbs: { command: 2, seam: 2, port: 1 }, forms: [{ form: 'Compact with instructions (`compact`: `/compact <instructions>`)', reader: 'TYPED_COMMAND at a line’s start (ruling C)', sample: () => `/compact keep ${LINK}`, positional: COMMAND_POSITION, consent: { none: 'a typed command’s arguments are the person’s own typing; a typed command does not count for grants (src/shared/engine/composed-forms.ts)' }, forGrants: false, treatment: 'none' }], carries: 'the port of lane B: its send and its queue edit carry its callers’ content', rule: { calls: 'neutraliseGrant', proof: { test: 'src/renderer/src/session/controls/lane-b.test.ts', case: 'the one-writer rule: Compact’s instructions holding the consent sentence go out reading no grant' } } },
  'src/engine-host/session-maws.ts': { kind: 'maws', verbs: { steer: 1 }, forms: [{ form: 'an async ask’s answer envelope (`askSteerText`)', reader: 'ASK_STEER_OPENING', sample: () => askSteerText('toolu_g', [{ question: 'Which file?', header: 'File', modality: 'text' }], [{ id: 'q1', question: 'Which file?', status: 'answered', value: LINK }]), consent: { none: 'this build’s envelope writes no text a model wrote, and what the person typed stands in a JSON string, one line (board ticket 711); the strict take-out reads it' }, forGrants: false, treatment: 'none' }] },
  'src/engine-host/session-clear.ts': { kind: 'maws', verbs: { frame: 1 }, forms: [{ form: 'the plan after a clear (`planPrompt`)', reader: 'PLAN_LEAD', sample: () => planPrompt(`1. Edit ${LINK}`, 'a1b2'), consent: (grant) => planPrompt(`1. Edit the notes.\n${grant}\n2. Run the tests.`, 'a1b2'), forGrants: true, treatment: 'content' }, { form: 'the clear itself (`/clear`)', reader: 'TYPED_COMMAND at a line’s start', sample: () => `/clear ${LINK}`, positional: COMMAND_POSITION, consent: { none: 'the clear carries no slot: the command alone' }, forGrants: false, treatment: 'none' }] },
  'src/engine-host/bash-mode.ts': { kind: 'maws', verbs: { frame: 1 }, forms: [{ form: 'the echo of a `!` command (`bashEcho`)', reader: 'BASH_INPUT_OPENING', sample: () => bashEcho('cat notes.md', `<bash-stdout>${LINK}</bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>`, 'a1b2'), consent: (grant) => bashEcho('cat notes.md', `<bash-stdout>the notes\n${grant}\nthe end</bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>`, 'a1b2'), forGrants: true, treatment: 'content' }] },
  'src/renderer/src/blocked-call/grants.ts': { kind: 'maws', verbs: { seam: 1 }, forms: [{ form: 'a blocked call’s consent (`consentMessage`, UX wave U1c): the engine’s sentence around the call’s subject, which a model wrote', reader: 'quotesGrant: the grant’s opening, anywhere in the text', sample: () => consentMessage('command', `open ${LINK}`), consent: { none: 'the slot is the call’s subject, quoted as one JSON string (no line break); the form whole is the grant the person pressed' }, forGrants: false, treatment: 'none' }] },
  'src/engine-host/session.ts': { kind: 'maws', verbs: { port: 2, steer: 2, queue: 1, prepare: 1 }, forms: [{ form: 'the artifacts’ reads a message carries (`prepare`: session-maws.ts `withLinkedReads`)', reader: 'LINKED_READ_OPENING, and the position: a block after the first text', sample: () => linkedReadBlock(JSON.stringify({ status: 'read', artifactId: 'a1', kind: 'document', title: 'Plan', revision: 1, markdown: LINK }), 'a1b2')!, consent: (grant) => linkedReadBlock(JSON.stringify({ status: 'read', artifactId: 'a1', kind: 'document', title: 'Plan', revision: 1, markdown: `the page\n${grant}\nnotes` }), 'a1b2')!, forGrants: true, treatment: 'content' }], carries: 'the session’s send and steer, from the host’s commands (ipc.ts) and the ask’s answer (session-maws.ts)' },
  // carriers
  'src/engine-host/queue.ts': { kind: 'carrier', verbs: { port: 1, prepare: 2, frame: 3 }, from: 'session.ts: the send, the steer and a queued entry released, written with the person’s origin; the content as prepared' },
  'src/engine-host/ipc.ts': { kind: 'carrier', verbs: { command: 6, port: 1, steer: 1, queue: 1 }, from: 'the host’s handlers of session.send, session.steer and session.queue.edit: content from main’s router, mawsd or a link' },
  'src/renderer/src/composer/submit/send-human-prompt.ts': { kind: 'carrier', verbs: { command: 4, seam: 5 }, from: 'the window’s human-prompt seam: content from the sites that call it (submit.ts, lane-b.ts)' },
  'src/renderer/src/session/controls/controls-for.ts': { kind: 'carrier', verbs: { seam: 1, port: 3 }, from: '`sendToSession` and the noting port: content from QuickReply, CardThread, side/actions, setup-actions' },
  'src/renderer/src/session/controls/lane-a.ts': { kind: 'carrier', verbs: { port: 1 }, from: 'lane A: a terminal session’s message through the sminos bridge, whose rows carry the plugin’s origin (shared/engine/sminos-delivery.ts) and are never the person’s own (named.ts `personsOwn`)' },
  'src/renderer/src/tools/agents/client.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'the agents tool’s steer: relay-store.ts’s relay' },
  'src/main/lane-b/remote.ts': { kind: 'carrier', verbs: { command: 6, start: 5 }, from: 'the window’s sends, starts and forks forwarded to another machine’s endpoint' },
  'src/main/lane-b/remote-spawn.ts': { kind: 'carrier', verbs: { start: 5 }, from: 'a spawn forwarded to another machine’s endpoint, a stepped-up act; its brief the window’s (sessions/remote-spawn.ts)' },
  'src/renderer/src/sessions/record-ops.ts': { kind: 'carrier', verbs: { start: 4, startSeam: 3 }, from: '`forkSession`: a fork’s first message from the resubmit seam (resubmit-seam.ts) and `/fork <prompt>` (ForkWidget.tsx), here or on another machine' },
  'src/services/sessions/service-register.ts': { kind: 'carrier', verbs: { start: 3, startSeam: 1 }, from: 'the bus’s handlers of session.start, session.fork and side.thread.open: the window’s start, fork and side thread' },
  'src/services/sessions/spawn.ts': { kind: 'carrier', verbs: { start: 3, startSeam: 1 }, from: 'a spawn’s brief as the start’s first message: the window’s draft (sessions/remote-spawn.ts), or an owner device’s over the link, stepped up (main/device/step-up.ts)' },
  'src/mawsd/front.ts': { kind: 'carrier', verbs: { command: 2 }, from: 'the daemon’s intercepts, forwarding to the engine host' },
  'src/endpoint/actions.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'a remote member’s act over the link, composed by its window; its uploads become document blocks before the text (send-uploads.ts)' },
  'src/services/sessions/setup.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'a session’s first message, from its start intent: the window’s draft, or sessions/service.ts’s anchored comments and promotion' },
  'src/services/sessions/recovery.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'the same first message, after a restart' },
  'src/services/sessions/resume.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'a resumed session’s message, from its intent (the window’s draft)' },
  'apps/desk-hub/deploy/endpoint-items.ts': { kind: 'carrier', verbs: { command: 2 }, from: 'a deploy probe’s acts over the link, with the probe’s own fixed words' },
  'apps/desk-hub/deploy/vm/holder.mjs': { kind: 'carrier', verbs: { start: 1, firstMessage: 1 }, from: 'a VM acceptance probe’s session, started with the probe’s own fixed words; no app' },
  'apps/desk-hub/deploy/vm/lane-b.mjs': { kind: 'carrier', verbs: { start: 1, firstMessage: 1 }, from: 'a VM acceptance probe’s session, started with the probe’s own fixed words; no app' },
  'apps/desk-hub/deploy/vm/o15-tools.mjs': { kind: 'carrier', verbs: { start: 1, firstMessage: 1 }, from: 'a production-machine probe’s session, started with the probe’s own fixed prompt; no app' },
  'src/renderer/src/harness/composer/ComposerHarness.tsx': { kind: 'carrier', verbs: { command: 1 }, from: 'the e2e harness’s injected failure of the composer’s send; it sends nothing of its own' },
  // declarations
  'src/endpoint/by-effect.ts': { kind: 'declaration', verbs: { command: 3 }, what: 'the endpoint’s grading of acts by effect' },
  'src/endpoint/offers.ts': { kind: 'declaration', verbs: { command: 3, start: 2 }, what: 'the endpoint’s offers' },
  'src/endpoint/authorize.ts': { kind: 'declaration', verbs: { start: 2 }, what: 'the endpoint’s authorization of forks and spawns' },
  'src/endpoint/rl10/members.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'a member’s proof of a spawn' },
  'src/main/device/step-up.ts': { kind: 'declaration', verbs: { start: 4 }, what: 'which starts a device steps up' },
  'src/main/machines/side-thread-peer.ts': { kind: 'declaration', verbs: { start: 2 }, what: 'the side thread an older daemon would open from one comment, refused' },
  'src/renderer/src/app/session-actions.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'the command a session menu’s item asks about' },
  'src/renderer/src/artifacts/session-context.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'an artifact’s session started with no message' },
  'src/renderer/src/gateway/session-start.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'a gateway session started with no message' },
  'src/renderer/src/lane-b/remote-unavailable.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'whether a fork is offered' },
  'src/renderer/src/side/BtwView.tsx': { kind: 'declaration', verbs: { start: 1 }, what: 'whether a promotion is offered' },
  'src/renderer/src/side/comment-form.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'whether a thread is offered' },
  'src/renderer/src/sessions/ForkSheet.tsx': { kind: 'declaration', verbs: { startSeam: 1 }, what: 'a fork into a new worktree, with no first message' },
  'src/renderer/src/harness/composer/api.ts': { kind: 'declaration', verbs: { firstMessage: 1 }, what: 'the e2e harness’s type of a first message' },
  'src/renderer/src/tools/artifacts/viewers/connectors/tab.ts': { kind: 'declaration', verbs: { startSeam: 2 }, what: 'an artifact’s own session, started with no message (artifacts/session-context.ts)' },
  'src/renderer/src/tools/dashboard/live-datasets.ts': { kind: 'declaration', verbs: { startSeam: 2 }, what: 'an artifact’s own session, started with no message' },
  'src/renderer/src/tools/dashboard/live-start.ts': { kind: 'declaration', verbs: { startSeam: 1 }, what: 'an artifact’s own session, started with no message' },
  'src/renderer/src/tools/dashboard/tab-state.ts': { kind: 'declaration', verbs: { startSeam: 1 }, what: 'an artifact’s own session, started with no message' },
  'src/services/command-budgets.ts': { kind: 'declaration', verbs: { start: 2 }, what: 'the commands’ time budgets' },
  'src/services/spine-root.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'a spawn’s orphaned claim read back' },
  'src/shared/ipc/grades/side.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'the side commands’ grades' },
  'src/shared/ipc/names/side.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'the side commands’ names' },
  'src/shared/ipc/schema/side.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'the side commands’ schema' },
  'apps/org-protocol/src/attest.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'the org protocol’s spawn actions' },
  'apps/org-protocol/vectors/scenario-remote.ts': { kind: 'declaration', verbs: { start: 1 }, what: 'a protocol vector’s spawn act' },
  'src/main/lane-b/remote-outcomes.ts': { kind: 'declaration', verbs: { command: 2 }, what: 'which forwarded commands are messages' },
  'src/renderer/src/app/supervisor-notices.ts': { kind: 'declaration', verbs: { command: 1, start: 2 }, what: 'the launches a notice follows' },
  'src/renderer/src/lane-b/remote-standing.ts': { kind: 'declaration', verbs: { command: 1 }, what: 'a remote session’s disabled words' },
  'src/renderer/src/session/controls/types.ts': { kind: 'declaration', verbs: { command: 2, port: 1 }, what: 'the controls port’s type' },
  'src/services/sessions/rewind-note.ts': { kind: 'declaration', verbs: { command: 4 }, what: 'the acts that write the conversation, for a rewind’s note' },
  'src/shared/ipc/grades/session.ts': { kind: 'declaration', verbs: { command: 3, start: 3 }, what: 'the commands’ grades' },
  'src/shared/ipc/names/session.ts': { kind: 'declaration', verbs: { command: 3, start: 3 }, what: 'the commands’ names' },
  'src/shared/ipc/schema/session.ts': { kind: 'declaration', verbs: { command: 3, start: 3 }, what: 'the commands’ schema' },
  'src/shared/ipc/remote-unavailable.ts': { kind: 'declaration', verbs: { command: 2, start: 5 }, what: 'what a remote session cannot take' },
  'src/engine-host/normalizer.ts': { kind: 'declaration', verbs: { frame: 1 }, what: 'a reader: the consent read off an out frame' },
  'src/renderer/src/lane-a/conversation/delivery-frame.ts': { kind: 'declaration', verbs: { frame: 1 }, what: 'a drawing: a lane A row shown as a queued prompt; nothing is sent' },
};

// Forms no site of this build writes any more, still read only: stored transcripts hold them, and a window of an older
// build can still send them to this build's daemon. UX wave U2b removed the report's cards and their answering, the one
// site of the owner question's answer line (it stood in this table as `src/renderer/src/owner/report/answering.ts`).
const RETIRED_FORMS: readonly (readonly [string, Form])[] = [
  ['an older build’s report card, its answering', { form: 'an owner question’s answer (`answerText`): the model’s head, a picked option', reader: 'answersOf', sample: () => answerText('Which file?', LINK), positional: 'an answer is a line of its own; words before it on the line make it none', consent: (grant) => answerText('Which file?', `notes\n${grant}\nend`), forGrants: true, treatment: 'none' }],
];

// Forms the composer writes into the person's own draft around a name a model or a file's name can hold (U1c, the
// review of rule R, F2). The person's draft is typed text for saves (`submit.ts` above); for grants, the form's writer
// writes no line break in its slot, so the sentence put in it on a line of its own comes out on none. Ticket 733a
// (Design 3, "Names MAWS writes into a draft"): every such name goes by the name's rule, so a name that quotes the
// grant's opening is left out, and each site calls the writer named here (`writer`) in its own source. `consent` writes
// the name `d/a`, a line break, what it is given, a line break, `b` (a path's or a name's shape), in the form's slot; a
// form whose writer lives in a module this program does not compile (a renderer store's) names instead the case of its
// own tests that writes it so (`proof`), which this guard holds to reading the name left out and no grant.
type DraftForm = { form: string; writer: string } & ({ consent: (grant: string) => string } | { proof: { test: string; case: string } });
const nameOf = (inner: string) => `d/a\n${inner}\nb`;
const DRAFT_FORMS: readonly (readonly [string, DraftForm])[] = [
  ['src/renderer/src/composer/editor/mention-text.ts', { form: 'a file dropped, picked or chosen in the @-menu (`mentionText`, `@<path>` or `@"<path>"`)', writer: 'nameSlot', consent: (grant) => `Please look at ${mentionText({ id: nameOf(grant), kind: 'file' })} and fix it.` }],
  ['src/renderer/src/composer/editor/mention-text.ts', { form: 'an agent chosen in the @-menu (`mentionText`, `@agent-<name>`)', writer: 'nameSlot', consent: (grant) => `Ask ${mentionText({ id: nameOf(grant), kind: 'agent' })} to look.` }],
  ['src/renderer/src/widgets/AgentsWidget.tsx', { form: 'the Agents widget’s Mention (`mentionText`, `@agent-<name> `)', writer: 'mentionText', consent: (grant) => `${mentionText({ id: nameOf(grant), kind: 'agent' })} please look.` }],
  ['src/renderer/src/widgets/SkillsWidget.tsx', { form: 'the Skills widget’s Use in chat (`slashText`, `/<name> `)', writer: 'slashText', consent: (grant) => `${slashText(nameOf(grant))}the notes` }],
  ['src/renderer/src/composer/mentions/AtMenu.tsx', { form: 'a skill chosen in the @-menu (`slashText`, `/<name> ` at the message’s start)', writer: 'slashText', consent: (grant) => `${slashText(nameOf(grant))}the notes` }],
  ['src/renderer/src/composer/mentions/SlashPalette.tsx', { form: 'a command chosen in the slash palette (`slashText`, `/<name> `)', writer: 'slashText', consent: (grant) => `${slashText(nameOf(grant))}the notes` }],
  ['src/renderer/src/artifacts/design-system/copy.ts', { form: 'a design system’s adoption request (`DESIGN_SYSTEM_COPY.adoptRequest`, its title twice)', writer: 'nameSlot', proof: { test: 'src/renderer/src/artifacts/design-system/copy.test.ts', case: 'the adoption request writes the system’s title by the name’s rule: one quoting the grant’s opening left out, one holding a line break on one line' } }],
  ['src/renderer/src/markup/session.ts', { form: 'Mark-up’s draft (`MARKUP_COPY.draft`, `Mark-up of <label> `, a page’s title or address)', writer: 'nameSlot', proof: { test: 'src/renderer/src/markup/session.test.ts', case: 'the draft writes the label by the name’s rule: one quoting the grant’s opening left out, one holding a line break on one line' } }],
];

// What the list does not account for: a site it does not hold, a site whose verbs moved, an entry no longer a site.
function unclassified(sites: readonly Site[], list: Record<string, Entry> = PERSON_SENDS): string[] {
  const found = new Map(sites.map((site) => [site.file, site.verbs]));
  const problems: string[] = [];
  for (const [file, verbs] of found) {
    const entry = list[file];
    if (entry === undefined) problems.push(`${file}: not classified (${JSON.stringify(verbs)})`);
    else if (JSON.stringify(sorted(entry.verbs)) !== JSON.stringify(sorted(verbs))) problems.push(`${file}: its verbs moved, ${JSON.stringify(sorted(verbs))} where the list has ${JSON.stringify(sorted(entry.verbs))}`);
  }
  for (const file of Object.keys(list)) if (!found.has(file)) problems.push(`${file}: listed, but no longer a site`);
  return problems;
}
const sorted = (verbs: Partial<Record<Verb, number>>) => Object.fromEntries(Object.entries(verbs).sort(([a], [b]) => a.localeCompare(b)));

const user = (content: string) => ({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, message: { role: 'user', content } });
const queued = (prompt: string) => ({ type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt, source_uuid: 's1', commandMode: 'prompt', origin: { kind: 'human' } } });

describe('who sends as the person', () => {
  it('every site that hands content to a send, a steer or the queue is classified', () => {
    expect(unclassified(scanSends())).toEqual([]);
  });

  it('goes red on a site it does not list, on verbs that moved, and on an entry that is no longer a site', () => {
    const planted = sitesIn("export const nudge = (client, appSessionId, words) => client.invoke('session.send', { appSessionId, content: `Please ${words}` });", 'src/renderer/src/planted.ts');
    expect(planted).toEqual({ file: 'src/renderer/src/planted.ts', verbs: { command: 1 } });
    const sites = scanSends();
    expect(unclassified([...sites, planted!])).toEqual(['src/renderer/src/planted.ts: not classified ({"command":1})']);
    const moved = sites.map((site) => (site.file === 'src/engine-host/bash-mode.ts' ? { ...site, verbs: { frame: 2 } } : site));
    expect(unclassified(moved)).toEqual(['src/engine-host/bash-mode.ts: its verbs moved, {"frame":2} where the list has {"frame":1}']);
    expect(unclassified(sites.filter((site) => site.file !== 'src/main/attention/actions.ts'))).toEqual(['src/main/attention/actions.ts: listed, but no longer a site']);
  });

  // the one-writer rule: a site of the person's free text names how it meets it, and one that calls the rule's function
  // calls it in its own source; a typed site that names none does not compile (`rule` is required). Each names the case
  // of its own tests that reads what it really sends for a text holding the sentence (the task review's finding 4)
  it.each(Object.entries(PERSON_SENDS).flatMap(([file, entry]) => (entry.kind === 'typed' || (entry.kind === 'maws' && entry.rule) ? [[file, entry.rule!] as const] : [])))('%s: meets the one-writer rule as its entry says', (file, rule) => {
    if ('serialised' in rule) expect(rule.serialised, file).not.toBe('');
    else expect(readFileSync(join(REPOSITORY, file), 'utf8'), file).toContain(`${rule.calls}(`);
    const tests = readFileSync(join(REPOSITORY, rule.proof.test), 'utf8');
    const at = tests.indexOf(`it('${rule.proof.case}',`);
    expect(at, `${file}: its proof, ${rule.proof.test} › ${rule.proof.case}`).toBeGreaterThan(-1);
    const body = tests.slice(at, tests.indexOf('\n  });', at));
    expect(body, `${file}: its proof reads what the site sends`).toContain('expectNoGrantSent(');
  });

  it('a caller of the port’s queue edit is a site the list must classify (the host writes what it is given)', () => {
    expect(sitesIn("await controls.edit({ queueId, content: words });", 'src/renderer/src/planted.tsx')).toEqual({ file: 'src/renderer/src/planted.tsx', verbs: { queueEdit: 1 } });
  });

  // the resubmit seam's anchored branches carry the anchor tag, which step 1b reads as no grant: the person's own words
  // edited in place, the sentence on a line of its own among them, read none
  it('an anchored comment edited in place, its words holding the sentence on a line of its own: no grant', () => {
    const sentence = consentMessage('command', 'make build');
    for (const destination of ['main', null] as const) {
      expect(personsGrants(anchoredTextOf({ anchor: LINE_ANCHOR, destination, screenshot: false }, `Wrong date\n${sentence}\nfix it`)), String(destination)).toEqual([]);
    }
  });

  const forms = [...Object.entries(PERSON_SENDS).flatMap(([file, entry]) => (entry.kind === 'maws' ? entry.forms.map((form) => [file, form] as const) : [])), ...RETIRED_FORMS];
  const READ_ONLY = [{ names: false, pending: [], other: true }, { names: false, pending: [], other: true }];
  it.each(forms)('%s: its form, written by its writer, names a path for a read only, alone and joined', (_, { form, sample, positional }) => {
    const index = forms.findIndex(([, other]) => other.form === form);
    const next = forms[(index + 1) % forms.length]![1].sample();
    // the form alone; after other words, on its line and on a line before; joined to another form, either order
    const texts = { alone: sample(), afterWords: `Please see this. ${sample()}`, afterLine: `Please see this.\n${sample()}`, before: `${sample()}\n\n${next}`, after: `${next}\n\n${sample()}` };
    for (const [how, text] of Object.entries(texts)) {
      if (how === 'afterWords' && positional !== undefined) continue; // not the form there: its reason is the entry's
      expect(text, `${form}: ${how}`).toContain(LINK);
      expect([rowClaim(user(text), P), rowClaim(queued(text), P)], `${form}: ${how}`).toEqual(READ_ONLY);
    }
  });

  // Rule R's step 1b (the architect's ruling 3865): a form MAWS composes around a model's, a command's or a page's words
  // counts for grants, so the consent sentence in its slot is no grant, alone, and joined with another message before
  // or after it, a pressed consent among them (the accepted cost, for a join only: a pressed consent the engine joins with
  // such a form, another message's, reads none from the file, and approved live from the host's own mark on the
  // consent's frame, which is the consent whole, since the queue's preparation attaches no linked read to a consent,
  // engine-host/linked-reads.ts): the sentence in a sample stands on a whole line, and the form's own words stay in the
  // text beside it
  const GRANT = consentMessage('command', 'make build');
  it.each(forms.filter(([, { treatment }]) => treatment === 'none'))('%s: its form, with the consent sentence in the slot others control, reads no grant, alone and joined', (_, { form, consent }) => {
    if (typeof consent !== 'function') {
      expect(consent.none, form).not.toBe('');
      return;
    }
    const sample = consent(GRANT);
    expect(sample.split('\n'), `${form}: the sentence on a line of its own`).toContain(GRANT);
    const others = forms.map(([, other]) => other.sample()).filter((other) => other !== sample);
    for (const [how, text] of Object.entries({ alone: sample, beforeAPressedConsent: `${sample}\n${GRANT}`, afterAPressedConsent: `${GRANT}\n${sample}`, beforeWords: `${sample}\nAlso fix the footer.`, afterAnotherForm: `${others[0]}\n${sample}` })) {
      expect(personsGrants(text), `${form}: ${how}`).toEqual([]);
    }
  });

  // Ticket 733a (Design 3): a content form's writer leaves the sentence in its slot out, a marker of MAWS's words in its
  // place, and stands the rest inside a pasted segment; what goes reads no grant on any route, alone and joined, and the
  // same sentence typed (the control) is a grant
  it.each(forms.filter(([, { treatment }]) => treatment === 'content'))('%s: its content form, with the consent sentence in the slot others control, goes with the line left out inside a segment, reading no grant alone and joined', (_, { form, consent }) => {
    expect(typeof consent, form).toBe('function');
    const sample = (consent as (grant: string) => string)(GRANT);
    expect(asTyped(sample).includes(GRANT), `${form}: the sentence left out`).toBe(false);
    const lines = sample.split('\n');
    const inside = pastedBodies(lines);
    expect(lines.filter((line, i) => inside[i] && line.includes(LINE_LEFT_OUT)), `${form}: the marker inside a segment`).toHaveLength(1);
    expect(quotesGrant(sample), form).toBe(false);
    expectNoGrantSent(sample);
    const others = forms.map(([, other]) => other.sample()).filter((other) => other !== sample);
    for (const [how, text] of Object.entries({ alone: sample, beforeWords: `${sample}\nAlso fix the footer.`, afterAnotherForm: `${others[0]}\n${sample}` })) {
      expect(personsGrants(text), `${form}: ${how}`).toEqual([]);
    }
    expect(personsGrants(GRANT)).not.toEqual([]);
  });

  // A form in the person's draft writes no line break in its slot: the sentence there is no grant, alone and joined, and
  // a pressed consent joined with it keeps its own grant (it is a whole line of the message, and no composed form is in it).
  // Ticket 733a: the name is left out whole, and a name holding a line break alone is one line (U+FFFD); the site calls
  // its writer. The draft forms are eight.
  const SLOT = consentMessage('command', 'cat /etc/x');
  it('the draft forms are eight', () => {
    expect(DRAFT_FORMS).toHaveLength(8);
  });
  it.each(DRAFT_FORMS)('%s: its form, with the consent sentence in the slot others control, reads no grant alone, and a pressed consent beside it keeps its own', (file, draft) => {
    const { form, writer } = draft;
    expect(readFileSync(join(REPOSITORY, file), 'utf8'), `${form}: the site calls its writer`).toContain(`${writer}(`);
    if ('proof' in draft) {
      const tests = readFileSync(join(REPOSITORY, draft.proof.test), 'utf8');
      const at = tests.indexOf(`it('${draft.proof.case}',`);
      expect(at, `${form}: its proof, ${draft.proof.test} › ${draft.proof.case}`).toBeGreaterThan(-1);
      const body = tests.slice(at, tests.indexOf('\n  });', at));
      for (const call of ['NAME_LEFT_OUT', 'personsGrants(', '\\ufffd']) expect(body, `${form}: its proof reads ${call}`).toContain(call);
      return;
    }
    const sample = draft.consent(SLOT);
    expect(sample, `${form}: no line break`).not.toMatch(/[\n\r\u0085\u2028\u2029]/u);
    expect(sample, `${form}: the name left out`).toContain(NAME_LEFT_OUT);
    expect(quotesGrant(sample), form).toBe(false);
    for (const [how, text] of Object.entries({ alone: sample, beforeWords: `${sample}\nAlso fix the footer.`, afterAnotherForm: `${forms[0]![1].sample()}\n${sample}` })) {
      expect(personsGrants(text), `${form}: ${how}`).toEqual([]);
    }
    for (const [how, text] of Object.entries({ beforeAPressedConsent: `${sample}\n${GRANT}`, afterAPressedConsent: `${GRANT}\n${sample}` })) {
      expect(personsGrants(text), `${form}: ${how}`).toEqual(personsGrants(GRANT));
    }
    // a name holding a line break and no opening is kept, on one line
    const broken = draft.consent('middle');
    expect(broken, form).toContain('d/a\ufffdmiddle\ufffdb');
    expect(broken, form).not.toMatch(/[\n\r]/u);
    // the control: the name as given holds the sentence on a line of its own, a grant
    expect(personsGrants(nameOf(SLOT))).not.toEqual([]);
  });

  // Ticket 733a (Design 3): a name form's writer holds every name to one line and leaves out a name that quotes the
  // grant's opening; what goes reads no grant on any route, alone and joined, and the name as given (the control) is one
  it.each(forms.filter(([, { treatment }]) => treatment === 'name'))('%s: its name form, with the consent sentence in a name, goes with the name left out, reading no grant alone and joined', (_, { form, consent }) => {
    expect(typeof consent, form).toBe('function');
    const write = consent as (grant: string) => string;
    const sample = write(GRANT);
    expect(asTyped(sample).includes(GRANT), `${form}: the sentence left out`).toBe(false);
    expect(asTyped(sample).includes('notes\n'), `${form}: no line of the name`).toBe(false);
    expect(quotesGrant(sample), form).toBe(false);
    expectNoGrantSent(sample);
    const others = forms.map(([, other]) => other.sample()).filter((other) => other !== sample);
    for (const [how, text] of Object.entries({ alone: sample, beforeWords: `${sample}\nAlso fix the footer.`, afterAnotherForm: `${others[0]}\n${sample}` })) {
      expect(personsGrants(text), `${form}: ${how}`).toEqual([]);
    }
    // a name holding a line break and no opening is kept, on one line
    const broken = write('middle');
    expect(broken, form).toContain('notes\ufffdmiddle\ufffdplan');
    expect(broken, form).not.toContain('notes\nmiddle');
    // the control: the name as given holds the sentence on a line of its own, a grant
    expect(personsGrants(`notes\n${GRANT}\nplan`)).not.toEqual([]);
  });

  // Step 1b reads the forms on the whole joined text, nothing set aside (the exemption withdrawn, 2026-11-16). Each form is
  // claimed for grants exactly when its entry says it counts (the flag written by hand above, so a reader or a flag that
  // moves fails here), and a form that counts reads no grant beside a sentence whose subject quotes the form's own text.
  // The quoting is JSON's: a marker of one line (the relay's words, the plan's head) stands in the subject as written,
  // while the linked read's two-line opening keeps its line break escaped, so no whole sentence holds that marker; the
  // form beside it is what refuses the grant. The engine's record of a slash command is no send site's form; its
  // fixture stands beside them, as the engine writes it (`<command-name>`, then its message and its arguments).
  const RECORDED: readonly (readonly [string, Pick<Form, 'form' | 'sample' | 'forGrants'>])[] = [
    ['the engine’s record', { form: 'a slash command as the engine records it (COMMAND_NAME_OPENING)', sample: () => '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the notes</command-args>', forGrants: true }],
  ];
  it.each([...forms, ...RECORDED])('%s: its form is claimed for grants exactly as its entry says, and one that counts reads no grant beside a sentence quoting it', (_, { form, sample, forGrants }) => {
    const text = sample();
    expect(holdsGrantForm(text, { steps: 0 }), `${form}: counts for grants`).toBe(forGrants);
    if (!forGrants) return;
    const sentence = consentMessage('command', `echo ${JSON.stringify(text)}`);
    for (const [how, joined] of Object.entries({ after: `${text}\n${sentence}`, before: `${sentence}\n${text}` })) expect(personsGrants(joined), `${form}: ${how}`).toEqual([]);
  });
});

// Ticket 733a (the architect's ruling on M3's numbers, guard (a)): the anchored writer's assembly before its last pass
// (`commentsMessageBeforeLastPass`) is no message, so no sender may hold it: the own-text rule's meter is its one
// importer in the product, and two tests hold it to its pass. Every file of the repository is read, tests included.
// New with the split; no red first. Widened at M4 to every way a file can take it, red first (the second case).
describe('the write-back’s assembly', () => {
  const IMPORTERS = ['src/shared/files/named.ts', 'src/shared/anchor/message.test.ts', 'src/services/files/named-split.test.ts'];
  const SKIPPED = new Set(['node_modules', 'dist', 'out']);
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return SKIPPED.has(entry.name) || entry.name.startsWith('.') ? [] : files(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
  // Whether a file's text, at `path`, takes the assembly (ticket 733a, M4: a named import alone was read before): it
  // names it, in any place, or it takes the anchored writer's module whole, which hands it every export, this one
  // included (a namespace import or re-export, a wildcard re-export, a dynamic import, a require, a mock's factory). A
  // module is named by a relative path or the `@shared/` alias, with or without its extension. What a file reaches by a
  // computed name, from a module object another file handed it, is outside what a reading of the text can see.
  const MESSAGE_MODULE = join(REPOSITORY, 'src/shared/anchor/message');
  const WHOLE = /(?:\bimport\s*\*\s*as\s+[\w$]+\s+from|\bexport\s*\*\s*(?:as\s+[\w$]+\s+)?from|\bimport\s*\(|\brequire\s*\(|\bvi\.(?:mock|doMock|importActual)\s*(?:<[^>]*>)?\s*\()\s*(['"`])([^'"`]+)\1/g;
  const moduleOf = (path: string, specifier: string) =>
    (specifier.startsWith('@shared/') ? join(REPOSITORY, 'src/shared', specifier.slice('@shared/'.length)) : specifier.startsWith('.') ? resolve(dirname(path), specifier) : specifier).replace(/\.[cm]?[jt]sx?$/, '');
  const holdsAssembly = (path: string, text: string) =>
    /\bcommentsMessageBeforeLastPass\b/.test(text) || [...text.matchAll(WHOLE)].some((match) => moduleOf(path, match[2]!) === MESSAGE_MODULE);
  it('is named by the own-text rule alone, by the tests that hold it to its pass, its writer and this guard, and no other file takes its module whole', () => {
    const importers = ['src', 'apps', 'test', 'e2e', 'scripts', 'plugins']
      .flatMap((top) => files(join(REPOSITORY, top)))
      .filter((path) => holdsAssembly(path, readFileSync(path, 'utf8')))
      .map((path) => relative(REPOSITORY, path).split(sep).join('/'))
      .sort();
    expect(importers).toEqual([...IMPORTERS, 'src/shared/anchor/message.ts', 'test/support/person-sends.test.ts'].sort());
  });
  // Ticket 733a, M4: every way a file can reach the assembly, each read as holding it, beside the ways that do not
  it('reads a file as holding the assembly however it takes it: by name, or the module whole', () => {
    const at = join(REPOSITORY, 'src/shared/files/a.ts'); // a file beside the own-text rule, which names the module `../anchor/message`
    const holds = {
      'a named import': "import { commentsMessageBeforeLastPass } from '../anchor/message';",
      'a named import, renamed': "import { commentsMessageBeforeLastPass as assemble } from '@shared/anchor/message';",
      'a named re-export': "export { commentsMessageBeforeLastPass } from '../anchor/message';",
      'a namespace import': "import * as message from '../anchor/message';\nexport const assemble = message.writer;",
      'a namespace re-export': "export * as message from '@shared/anchor/message';",
      'a wildcard re-export': "export * from '../anchor/message';",
      'a dynamic import': "export const load = () => import('../anchor/message');",
      'a require': "const message = require('../../shared/anchor/message.ts');",
      'a mock of the module': "vi.mock('@shared/anchor/message', async (original) => original());",
      'the name in any other place': 'const assemble = (m: Record<string, unknown>) => m.commentsMessageBeforeLastPass;',
    };
    const holdsNot = {
      'a named import of the writer': "import { commentsMessage } from '../anchor/message';",
      'a namespace import of another module': "import * as content from '../anchor/content';",
      'a wildcard re-export of another module': "export * from './named-rows';",
      'a dynamic import of a module of the same name elsewhere': "export const load = () => import('../composer/message');",
    };
    expect(Object.entries(holds).filter(([, text]) => !holdsAssembly(at, text)).map(([how]) => how), 'each way read as holding it').toEqual([]);
    expect(Object.entries(holdsNot).filter(([, text]) => holdsAssembly(at, text)).map(([how]) => how), 'the controls, read as not').toEqual([]);
  });
});
