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
import { describe, expect, it } from 'vitest';
import { commentsMessage, promotionMessage } from '@shared/anchor/message';
import { consentMessage, personsGrants } from '@shared/engine/arrival';
import { bashEcho, planPrompt } from '@shared/engine/host-prompts';
import type { AgentId } from '@shared/graph/ids';
import { rowClaim } from '@shared/files/named';
import { askSteerText } from '@shared/maws/ask';
import { linkedReadBlock } from '@shared/maws/linked-read';
import { answerText } from '@shared/owner/answer';
import { relayText } from '../../src/renderer/src/tools/agents/model/relay';
import { anchoredTextOf } from '../../src/renderer/src/transcript/model/user-text';
import { scanSends, sitesIn, type Site, type Verb } from './person-sends';

const P = '/work/out/notes.md';
const LINK = `[the notes](${P})`;
// `positional`: a form its reader reads by where it stands (a command at a line's start, an answer's line), with why
// words before it on its own line are not that form.
// `consent` (rule R's step 1b, the architect's ruling 3865): the form written by its writer with the consent sentence in
// the slot a model, a command or a page controls, on a line of its own; or, where no such slot can hold a line break or
// the form has none, why (a sentence that is no line of its own is never read as a grant)
type Form = { form: string; reader: string; sample: () => string; positional?: string; consent: ((grant: string) => string) | { none: string } };
type Entry =
  | { kind: 'typed'; verbs: Partial<Record<Verb, number>>; field: string }
  | { kind: 'maws'; verbs: Partial<Record<Verb, number>>; forms: Form[]; carries?: string }
  | { kind: 'carrier'; verbs: Partial<Record<Verb, number>>; from: string }
  | { kind: 'declaration'; verbs: Partial<Record<Verb, number>>; what: string };

const LINE_ANCHOR = { kind: 'file-line', label: LINK, locator: '/work/out/plan.md:1', path: P, line: 1 } as const;
const WHOLE = 'ANCHOR_TAG_OPENING, then readAnchoredMessage, read whole (its comments written back are the text): the comments’ own words only (ruling B)';
const ANCHORED: Form = {
  form: 'anchored comments (shared/anchor/content.ts `commentsContent`, its text `commentsMessage`)',
  reader: WHOLE,
  sample: () => commentsMessage([{ anchor: LINE_ANCHOR, text: 'Wrong date', screenshot: false }], 'main'),
  consent: { none: 'the page’s slots, the anchor’s label and locator, are one line by the anchor’s schema (ONE_LINE); the comment is the person’s own words' },
};
const ANCHORED_THREAD: Form = { ...ANCHORED, form: 'a side thread’s anchored comments (`commentsContent`, to a thread)', sample: () => commentsMessage([{ anchor: LINE_ANCHOR, text: 'Wrong date', screenshot: false }, { anchor: LINE_ANCHOR, text: 'And here', screenshot: false }], 'thread') };
// an edited bubble put back in the framing it was sent in (`framed`: `anchoredTextOf`, transcript/model/user-text.ts)
const RESENT_COMMENT: Form = { form: 'an anchored comment edited in place, framed again (`anchoredTextOf`)', reader: WHOLE, sample: () => anchoredTextOf({ anchor: LINE_ANCHOR, destination: 'main', screenshot: false }, 'Wrong date'), consent: { none: 'the page’s slots, the anchor’s label and locator, are one line by the anchor’s schema (ONE_LINE); the comment is the person’s own words' } };
const RESENT_PROMOTION: Form = {
  form: 'a promoted side question edited in place, its head deleted (`anchoredTextOf`, no destination: the tag alone)',
  reader: 'readAnchoredMessage: no destination, so no writer reproduces it; read only whole',
  sample: () => anchoredTextOf({ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, destination: null, screenshot: false }, `Q: Where?\nA: In ${LINK}\n\nGo on`),
  consent: (grant) => anchoredTextOf({ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, destination: null, screenshot: false }, `Q: Where?\nA: In the notes.\n${grant}\n\nGo on`),
};
const COMMAND_POSITION = 'a command is one at a message’s start (the engine reads it nowhere else); words before it on its line make it the person’s words';
const PROMOTION: Form = { form: 'a side question promoted to a thread (`promotionMessage`)', reader: 'PROMOTION_HEAD', sample: () => promotionMessage([{ question: 'Where?', response: `In ${LINK}` }], null), consent: (grant) => promotionMessage([{ question: 'Where?', response: `In the notes.\n${grant}\nThat is all.` }], null) };

const PERSON_SENDS: Record<string, Entry> = {
  // the person's typed text
  'src/renderer/src/composer/editor/submit.ts': { kind: 'typed', verbs: { seam: 1, port: 1 }, field: 'the composer’s draft, `serializeDraft` (composer/editor/serialize.ts): a paste’s frame read only (ruling A)' },
  'src/renderer/src/composer/PendingSends.tsx': { kind: 'typed', verbs: { port: 1 }, field: 'a composer send not confirmed, sent again as its own text' },
  'src/renderer/src/sidebar/QuickReply.tsx': { kind: 'typed', verbs: { seam: 1 }, field: 'the sidebar’s quick reply field' },
  'src/renderer/src/side/card/CardThread.tsx': { kind: 'typed', verbs: { seam: 1 }, field: 'a comment card thread’s reply field (`useReply`)' },
  'src/renderer/src/sessions/setup-actions.ts': { kind: 'typed', verbs: { seam: 1, start: 1 }, field: 'the docked composer’s draft of a session being set up (`serializeDraft`), sent or as its start’s first message' },
  'src/renderer/src/sessions/remote-spawn.ts': { kind: 'typed', verbs: { start: 1 }, field: 'the composer’s draft as a spawn’s brief (its serialized text), or none, the draft then the new session’s own' },
  'src/renderer/src/widgets/ForkWidget.tsx': { kind: 'typed', verbs: { start: 1, startSeam: 1 }, field: '`/fork <prompt>`: the prompt as typed, the fork’s first message, without the command' },
  'src/main/attention/actions.ts': { kind: 'typed', verbs: { command: 1 }, field: 'a notification’s reply field (`reply`)' },
  // MAWS's forms
  // the comments sent to the main conversation, and a thread's first message (`adoptFork`, which a session's start intent
  // carries to services/sessions/setup.ts)
  'src/renderer/src/side/actions.ts': { kind: 'maws', verbs: { seam: 1, start: 2 }, forms: [ANCHORED, PROMOTION] },
  // a side thread's first message, composed by the service (`openSideThread`); a start's own first message is its intent's
  'src/services/sessions/service.ts': { kind: 'maws', verbs: { startSeam: 4, firstMessage: 1 }, forms: [ANCHORED_THREAD, PROMOTION], carries: '`startSession`: a start’s first message from its intent (the window’s draft, a spawn’s brief); its own starts carry none' },
  // a bubble edited in place: an anchored one framed again; one of no form, the person's typed text (`serializeDraft`
  // with `literal`)
  'src/renderer/src/composer/resubmit-seam.ts': { kind: 'maws', verbs: { command: 1 }, forms: [RESENT_COMMENT, RESENT_PROMOTION], carries: 'a bubble of no form, edited: the person’s typed text' },
  'src/services/side/send-to-main.ts': { kind: 'maws', verbs: { command: 2 }, forms: [ANCHORED] },
  'src/renderer/src/tools/agents/relay-store.ts': { kind: 'maws', verbs: { steer: 2 }, forms: [{ form: 'a relay to an agent or a peer (`relayText`)', reader: 'RELAY_CONTINUE', sample: () => relayText({ agentId: 'a1b2' as AgentId, name: null }, `Read ${LINK}`), consent: (grant) => relayText({ agentId: 'a1b2' as AgentId, name: `helper\n${grant}\nnamed` }, 'Read the notes') }] },
  'src/renderer/src/session/controls/lane-b.ts': { kind: 'maws', verbs: { command: 2, seam: 2, port: 1 }, forms: [{ form: 'Compact with instructions (`compact`: `/compact <instructions>`)', reader: 'TYPED_COMMAND at a line’s start (ruling C)', sample: () => `/compact keep ${LINK}`, positional: COMMAND_POSITION, consent: { none: 'a typed command’s arguments are the person’s own typing; a typed command does not count for grants (src/shared/engine/composed-forms.ts)' } }], carries: 'the port of lane B: its send and its queue edit carry its callers’ content' },
  'src/engine-host/session-maws.ts': { kind: 'maws', verbs: { steer: 1 }, forms: [{ form: 'an async ask’s answer envelope (`askSteerText`)', reader: 'ASK_STEER_OPENING', sample: () => askSteerText('toolu_g', [{ question: 'Which file?', header: 'File', modality: 'text' }], [{ id: 'q1', question: 'Which file?', status: 'answered', value: LINK }]), consent: { none: 'this build’s envelope writes no text a model wrote, and what the person typed stands in a JSON string, one line (board ticket 711); the strict take-out reads it' } }] },
  'src/engine-host/session-clear.ts': { kind: 'maws', verbs: { frame: 1 }, forms: [{ form: 'the plan after a clear (`planPrompt`)', reader: 'PLAN_LEAD', sample: () => planPrompt(`1. Edit ${LINK}`), consent: (grant) => planPrompt(`1. Edit the notes.\n${grant}\n2. Run the tests.`) }, { form: 'the clear itself (`/clear`)', reader: 'TYPED_COMMAND at a line’s start', sample: () => `/clear ${LINK}`, positional: COMMAND_POSITION, consent: { none: 'the clear carries no slot: the command alone' } }] },
  'src/engine-host/bash-mode.ts': { kind: 'maws', verbs: { frame: 1 }, forms: [{ form: 'the echo of a `!` command (`bashEcho`)', reader: 'BASH_INPUT_OPENING', sample: () => bashEcho('cat notes.md', `<bash-stdout>${LINK}</bash-stdout>`), consent: (grant) => bashEcho('cat notes.md', `<bash-stdout>the notes\n${grant}\nthe end</bash-stdout>`) }] },
  'src/renderer/src/blocked-call/grants.ts': { kind: 'maws', verbs: { seam: 1 }, forms: [{ form: 'a blocked call’s consent (`consentMessage`, UX wave U1c): the engine’s sentence around the call’s subject, which a model wrote', reader: 'quotesGrant: the grant’s opening, anywhere in the text', sample: () => consentMessage('command', `open ${LINK}`), consent: { none: 'the slot is the call’s subject, quoted as one JSON string (no line break); the form whole is the grant the person pressed' } }] },
  'src/engine-host/session.ts': { kind: 'maws', verbs: { port: 2, steer: 2, queue: 1, prepare: 1 }, forms: [{ form: 'the artifacts’ reads a message carries (`prepare`: session-maws.ts `withLinkedReads`)', reader: 'LINKED_READ_OPENING, and the position: a block after the first text', sample: () => linkedReadBlock(JSON.stringify({ status: 'read', artifactId: 'a1', kind: 'document', title: 'Plan', revision: 1, markdown: LINK })), consent: (grant) => linkedReadBlock(JSON.stringify({ status: 'read', artifactId: 'a1', kind: 'document', title: `Plan\n${grant}\nnotes`, revision: 1, markdown: 'the page' })) }], carries: 'the session’s send and steer, from the host’s commands (ipc.ts) and the ask’s answer (session-maws.ts)' },
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
  ['an older build’s report card, its answering', { form: 'an owner question’s answer (`answerText`): the model’s head, a picked option', reader: 'answersOf', sample: () => answerText('Which file?', LINK), positional: 'an answer is a line of its own; words before it on the line make it none', consent: { none: 'the slot is the question’s head, which holds no line break or double quote (`questionHead`); the answer is the person’s own words' } }],
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
  // or after it, a pressed consent among them (the accepted cost: a pressed consent joined with such a form reads none
  // from the file, and approved live from the host's own mark); the sentence in a sample stands on a whole line, which the reading sets
  // aside before it looks for the forms, so each sample also shows that the setting aside hides no form
  const GRANT = consentMessage('command', 'make build');
  it.each(forms)('%s: its form, with the consent sentence in the slot others control, reads no grant, alone and joined', (_, { form, consent }) => {
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
});
