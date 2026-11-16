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
import { bashEcho, planPrompt } from '@shared/engine/host-prompts';
import type { AgentId } from '@shared/graph/ids';
import { rowClaim } from '@shared/files/named';
import { askSteerText } from '@shared/maws/ask';
import { linkedReadBlock } from '@shared/maws/linked-read';
import { answerText } from '@shared/owner/answer';
import { relayText } from '../../src/renderer/src/tools/agents/model/relay';
import { scanSends, sitesIn, type Site, type Verb } from './person-sends';

const P = '/work/out/notes.md';
const LINK = `[the notes](${P})`;
type Form = { form: string; reader: string; sample: () => string };
type Entry =
  | { kind: 'typed'; verbs: Partial<Record<Verb, number>>; field: string }
  | { kind: 'maws'; verbs: Partial<Record<Verb, number>>; forms: Form[]; carries?: string }
  | { kind: 'carrier'; verbs: Partial<Record<Verb, number>>; from: string }
  | { kind: 'declaration'; verbs: Partial<Record<Verb, number>>; what: string };

const ANCHORED: Form = {
  form: 'anchored comments (shared/anchor/content.ts `commentsContent`, its text `commentsMessage`)',
  reader: 'ANCHOR_TAG_OPENING, then readAnchoredMessage: the comments’ own words only (ruling B)',
  sample: () => commentsMessage([{ anchor: { kind: 'file-line', label: LINK, locator: '/work/out/plan.md:1', path: P, line: 1 }, text: 'Wrong date', screenshot: false }], 'main'),
};
const PROMOTION: Form = { form: 'a side question promoted to a thread (`promotionMessage`)', reader: 'PROMOTION_HEAD', sample: () => promotionMessage([{ question: 'Where?', response: `In ${LINK}` }], null) };

const PERSON_SENDS: Record<string, Entry> = {
  // the person's typed text
  'src/renderer/src/composer/editor/submit.ts': { kind: 'typed', verbs: { seam: 1, port: 1 }, field: 'the composer’s draft, `serializeDraft` (composer/editor/serialize.ts): a paste’s frame read only (ruling A)' },
  'src/renderer/src/composer/resubmit-seam.ts': { kind: 'typed', verbs: { command: 1 }, field: 'a bubble edited in place, `serializeDraft` with `literal`' },
  'src/renderer/src/composer/PendingSends.tsx': { kind: 'typed', verbs: { port: 1 }, field: 'a composer send not confirmed, sent again as its own text' },
  'src/renderer/src/sidebar/QuickReply.tsx': { kind: 'typed', verbs: { seam: 1 }, field: 'the sidebar’s quick reply field' },
  'src/renderer/src/side/card/CardThread.tsx': { kind: 'typed', verbs: { seam: 1 }, field: 'a comment card thread’s reply field (`useReply`)' },
  'src/renderer/src/sessions/setup-actions.ts': { kind: 'typed', verbs: { seam: 1 }, field: 'the docked composer’s draft of a session being set up (`serializeDraft`)' },
  'src/main/attention/actions.ts': { kind: 'typed', verbs: { command: 1 }, field: 'a notification’s reply field (`reply`)' },
  // MAWS's forms
  'src/renderer/src/owner/report/answering.ts': { kind: 'maws', verbs: { seam: 1 }, forms: [{ form: 'an owner question’s answer (`answerText`): the model’s head, a picked option', reader: 'answersOf', sample: () => answerText('Which file?', LINK) }] },
  // the comments sent to the main conversation, and a thread's first message (`adoptFork`, which a session's start intent
  // carries to services/sessions/setup.ts)
  'src/renderer/src/side/actions.ts': { kind: 'maws', verbs: { seam: 1 }, forms: [ANCHORED, PROMOTION] },
  'src/services/side/send-to-main.ts': { kind: 'maws', verbs: { command: 2 }, forms: [ANCHORED] },
  'src/renderer/src/tools/agents/relay-store.ts': { kind: 'maws', verbs: { steer: 2 }, forms: [{ form: 'a relay to an agent or a peer (`relayText`)', reader: 'RELAY_CONTINUE', sample: () => relayText({ agentId: 'a1b2' as AgentId, name: null }, `Read ${LINK}`) }] },
  'src/renderer/src/session/controls/lane-b.ts': { kind: 'maws', verbs: { command: 2, seam: 2, port: 1 }, forms: [{ form: 'Compact with instructions (`compact`: `/compact <instructions>`)', reader: 'TYPED_COMMAND (ruling C)', sample: () => `/compact keep ${LINK}` }], carries: 'the port of lane B: its send and its queue edit carry its callers’ content' },
  'src/engine-host/session-maws.ts': { kind: 'maws', verbs: { steer: 1 }, forms: [{ form: 'an async ask’s answer envelope (`askSteerText`)', reader: 'ASK_STEER_OPENING', sample: () => askSteerText('toolu_g', [{ question: 'Which file?', header: 'File', modality: 'text' }], [{ id: 'q1', question: 'Which file?', status: 'answered', value: LINK }]) }] },
  'src/engine-host/session-clear.ts': { kind: 'maws', verbs: { frame: 1 }, forms: [{ form: 'the plan after a clear (`planPrompt`)', reader: 'PLAN_LEAD', sample: () => planPrompt(`1. Edit ${LINK}`) }, { form: 'the clear itself (`/clear`)', reader: 'TYPED_COMMAND', sample: () => `/clear ${LINK}` }] },
  'src/engine-host/bash-mode.ts': { kind: 'maws', verbs: { frame: 1 }, forms: [{ form: 'the echo of a `!` command (`bashEcho`)', reader: 'BASH_INPUT_OPENING', sample: () => bashEcho('cat notes.md', `<bash-stdout>${LINK}</bash-stdout>`) }] },
  'src/engine-host/session.ts': { kind: 'maws', verbs: { port: 2, steer: 2, queue: 1, prepare: 1 }, forms: [{ form: 'the artifacts’ reads a message carries (`prepare`: session-maws.ts `withLinkedReads`)', reader: 'LINKED_READ_OPENING, and the position: a block after the first text', sample: () => linkedReadBlock(JSON.stringify({ status: 'read', artifactId: 'a1', kind: 'document', title: 'Plan', revision: 1, markdown: LINK })) }], carries: 'the session’s send and steer, from the host’s commands (ipc.ts) and the ask’s answer (session-maws.ts)' },
  // carriers
  'src/engine-host/queue.ts': { kind: 'carrier', verbs: { port: 1, prepare: 2, frame: 3 }, from: 'session.ts: the send, the steer and a queued entry released, written with the person’s origin; the content as prepared' },
  'src/engine-host/ipc.ts': { kind: 'carrier', verbs: { command: 6, port: 1, steer: 1, queue: 1 }, from: 'the host’s handlers of session.send, session.steer and session.queue.edit: content from main’s router, mawsd or a link' },
  'src/renderer/src/composer/submit/send-human-prompt.ts': { kind: 'carrier', verbs: { command: 4, seam: 5 }, from: 'the window’s human-prompt seam: content from the sites that call it (submit.ts, lane-b.ts)' },
  'src/renderer/src/session/controls/controls-for.ts': { kind: 'carrier', verbs: { seam: 1, port: 3 }, from: '`sendToSession` and the noting port: content from QuickReply, CardThread, answering, side/actions, setup-actions' },
  'src/renderer/src/session/controls/lane-a.ts': { kind: 'carrier', verbs: { port: 1 }, from: 'lane A: a terminal session’s message through the sminos bridge, whose rows carry the plugin’s origin (shared/engine/sminos-delivery.ts) and are never the person’s own (named.ts `personsOwn`)' },
  'src/renderer/src/tools/agents/client.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'the agents tool’s steer: relay-store.ts’s relay' },
  'src/main/lane-b/remote.ts': { kind: 'carrier', verbs: { command: 6 }, from: 'the window’s sends forwarded to another machine’s endpoint' },
  'src/mawsd/front.ts': { kind: 'carrier', verbs: { command: 2 }, from: 'the daemon’s intercepts, forwarding to the engine host' },
  'src/endpoint/actions.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'a remote member’s act over the link, composed by its window; its uploads become document blocks before the text (send-uploads.ts)' },
  'src/services/sessions/setup.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'a session’s first message, from its start intent: the window’s draft, or sessions/service.ts’s anchored comments and promotion' },
  'src/services/sessions/recovery.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'the same first message, after a restart' },
  'src/services/sessions/resume.ts': { kind: 'carrier', verbs: { command: 1 }, from: 'a resumed session’s message, from its intent (the window’s draft)' },
  'apps/desk-hub/deploy/endpoint-items.ts': { kind: 'carrier', verbs: { command: 2 }, from: 'a deploy probe’s acts over the link, with the probe’s own fixed words' },
  'src/renderer/src/harness/composer/ComposerHarness.tsx': { kind: 'carrier', verbs: { command: 1 }, from: 'the e2e harness’s injected failure of the composer’s send; it sends nothing of its own' },
  // declarations
  'src/endpoint/by-effect.ts': { kind: 'declaration', verbs: { command: 3 }, what: 'the endpoint’s grading of acts by effect' },
  'src/endpoint/offers.ts': { kind: 'declaration', verbs: { command: 3 }, what: 'the endpoint’s offers' },
  'src/main/lane-b/remote-outcomes.ts': { kind: 'declaration', verbs: { command: 2 }, what: 'which forwarded commands are messages' },
  'src/renderer/src/app/supervisor-notices.ts': { kind: 'declaration', verbs: { command: 1 }, what: 'the launches a notice follows' },
  'src/renderer/src/lane-b/remote-standing.ts': { kind: 'declaration', verbs: { command: 1 }, what: 'a remote session’s disabled words' },
  'src/renderer/src/session/controls/types.ts': { kind: 'declaration', verbs: { command: 2, port: 1 }, what: 'the controls port’s type' },
  'src/services/sessions/rewind-note.ts': { kind: 'declaration', verbs: { command: 4 }, what: 'the acts that write the conversation, for a rewind’s note' },
  'src/shared/ipc/grades/session.ts': { kind: 'declaration', verbs: { command: 3 }, what: 'the commands’ grades' },
  'src/shared/ipc/names/session.ts': { kind: 'declaration', verbs: { command: 3 }, what: 'the commands’ names' },
  'src/shared/ipc/schema/session.ts': { kind: 'declaration', verbs: { command: 3 }, what: 'the commands’ schema' },
  'src/shared/ipc/remote-unavailable.ts': { kind: 'declaration', verbs: { command: 2 }, what: 'what a remote session cannot take' },
  'src/engine-host/normalizer.ts': { kind: 'declaration', verbs: { frame: 1 }, what: 'a reader: the consent read off an out frame' },
  'src/renderer/src/lane-a/conversation/delivery-frame.ts': { kind: 'declaration', verbs: { frame: 1 }, what: 'a drawing: a lane A row shown as a queued prompt; nothing is sent' },
};

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

  const forms = Object.entries(PERSON_SENDS).flatMap(([file, entry]) => (entry.kind === 'maws' ? entry.forms.map((form) => [file, form] as const) : []));
  it.each(forms)('%s: its form, written by its writer, names a path for a read only', (_, { form, sample }) => {
    expect(sample(), form).toContain(LINK);
    expect([rowClaim(user(sample()), P), rowClaim(queued(sample()), P)], form).toEqual([{ names: false, pending: [], other: true }, { names: false, pending: [], other: true }]);
  });
});
