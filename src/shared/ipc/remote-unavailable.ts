// What a session on another machine can't do yet (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M8 "The offer audit and its contract", Interfaces §U). Every command the renderer issues for a session reaches another
// machine only if a row of the machine's offer table takes it (src/endpoint/offers.ts), or main's adapters answer it
// themselves (the lane B adapter's substitutes, src/main/lane-b/remote.ts; lane A's adapter, which takes every
// `laneA.*`, src/main/lane-a/remote.ts). The rest are here, each with the words its control shows, drawn disabled, for a
// session on another machine. test/lane-b/offer-coverage.test.ts holds the set to the rule: every command addressed by
// an app session that crosses a machine link is offered, handled, or here, and none is both offered and here.
//
// What is here, and why (the offer audit's rule, m8-2a: a session's own read is offered when it is harmless to other
// clients; anything per member, anything that acts on the asking client, anything with effects on other clients, and
// anything of another lane's surface is declared):
// - the session's lifecycle and its record, which the machine's own app runs (launch, stop, start, take over, delete, the
//   setup intent, replays): a remote session starts from "+ Session" and resumes by a send;
// - the composer's machine-side extras with no remote route yet (`!` commands, `#` memory, flag settings, the working
//   directory, the prompt history's append, a steer's cancel, the skills' reload);
// - what is kept per window (visibility, the mods' surfaces and their panes, a pane's answer);
// - what acts on the asking client (open or reveal a file on the machine, a screenshot's preview there);
// - the owner channel, attention's acknowledgement, the side thread's open and its send to the main conversation, and
//   the mods' listing and override (machine-wide: they name no one session's surface).
//
// The UX wave (U9, UC-7; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §3): an act offered
// since then leaves the set and names the capability a machine's endpoint lists once it serves it (`REMOTE_NEEDS`), and
// one function words, for every act, why its control is disabled and why it ended without its effect (UC-7.5).
import { gradeOf } from './grades';
import type { CommandName } from './schema';

const NOT_YET = 'Not on another machine yet';
const notYet = (what: string) => `${NOT_YET}: ${what}`;

/** Each command a session on another machine can't take, with the words its control shows. */
export const REMOTE_UNAVAILABLE: Readonly<Partial<Record<CommandName, string>>> = {
  // the session's lifecycle and record
  'session.launch': notYet('start it again by sending a message, or start a new session with + Session'),
  'session.stop': notYet('stopping the session’s process'),
  'session.start': notYet('start a session there with + Session'),
  'session.takeOver': notYet('taking over a session another process holds'),
  'session.delete': notYet('deleting a session'),
  'session.deletions.keep': notYet('deleting a session'),
  'session.deletions.preview': notYet('deleting a session'),
  'session.renameSession': notYet('renaming a session'),
  'session.intent.get': notYet('setting up a new session; use + Session'),
  'session.intent.patch': notYet('setting up a new session; use + Session'),
  'session.intent.release': notYet('setting up a new session; use + Session'),
  'session.intent.discard': notYet('setting up a new session; use + Session'),
  'session.intent.resolveWorktree': notYet('setting up a new session; use + Session'),
  'session.replay.launch': notYet('replays'),
  'session.replay.control': notYet('replays'),
  // the composer's extras
  'session.bash': notYet('! shell commands'),
  'session.memoryAppend': notYet('# memory notes'),
  'session.applyFlagSettings': notYet('changing the session’s settings flags'),
  'session.setCwd': notYet('changing the working directory'),
  'session.history.append': notYet('adding to the prompt history'),
  'session.steer.sendNow': notYet('sending a waiting message now while the agent works'), // UX wave U4a; U4b offers it
  'session.reloadSkills': notYet('reloading skills'),
  // per window (P5 O8 M6a: a member's drafts are offered, kept per member on the machine)
  'session.setVisible': notYet('the machine’s own windows'),
  'session.ui.render': notYet('mod surfaces'),
  'session.ui.press': notYet('mod surfaces'),
  'session.ui.input': notYet('mod surfaces'),
  'session.ui.select': notYet('mod surfaces'),
  'session.ui.focus': notYet('mod surfaces'),
  'session.ui.scroll': notYet('mod surfaces'),
  'session.ui.panes': notYet('mod surfaces'),
  'session.ui.paneShow': notYet('mod surfaces'),
  'session.ui.paneFocus': notYet('mod surfaces'),
  'session.ui.close': notYet('mod surfaces'),
  'session.ui.promptEdit': notYet('mod surfaces'),
  'session.ui.answer': notYet('mod surfaces'),
  // on the asking client
  'files.openExternal': notYet('opening a file there; open a copy here instead'),
  'files.reveal': notYet('showing a file in that machine’s Finder'),
  'side.screenshot.preview': notYet('screenshots'),
  // the owner channel, attention, the side thread, the mods
  'ownerChannel.state': notYet('the owner channel'),
  'ownerChannel.answered': notYet('the owner channel'),
  'ownerChannel.cancel': notYet('the owner channel'),
  'ownerChannel.markRead': notYet('the owner channel'),
  'side.thread.open': notYet('side threads'),
  'side.sendToMain': notYet('sending a side answer to the main conversation'),
  'mods.list': notYet('the mods that machine runs'),
  'mods.setSessionOverride': notYet('turning a mod on or off for one session'),
  // UX wave U11a M8 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, §A): until U11f
  'connectors.signInDynamicServer': notYet('signing in to a connector from a plugin or from MAWS’s own list'),
};

/** The capability an endpoint lists once it serves the session acts the UX wave offers (UC-7.4). */
export const SESSION_ACTS_CAPABILITY = 'rl2.session-acts';

/**
 * A command a machine takes only when its endpoint's handshake lists the capability named: the device sends it to no
 * other (src/main/lane-b/remote.ts), and an act made over the link carries it as its `requires`. A child that offers a
 * command later adds its own entry with its own capability (UC-7.6).
 */
export const REMOTE_NEEDS: Readonly<Partial<Record<CommandName, string>>> = {
  'session.archive': SESSION_ACTS_CAPABILITY,
  'session.update': SESSION_ACTS_CAPABILITY, // an unarchive alone: the endpoint's row takes no other patch
  'session.rename': SESSION_ACTS_CAPABILITY,
  'session.list': SESSION_ACTS_CAPABILITY, // the archived sessions' read
  'attention.acknowledge': SESSION_ACTS_CAPABILITY,
  'session.steer.cancel': SESSION_ACTS_CAPABILITY,
  'maws.pane.answer': SESSION_ACTS_CAPABILITY,
  'session.fork': SESSION_ACTS_CAPABILITY, // in place, the machine's owners' (M2)
};

/**
 * How an act reads in a sentence. `act` follows "Can’t" and, capitalised, opens "… is unavailable" ("fork"); `done`
 * follows "Not" ("forked"). `closes`: the act is closed with the phase's words while its machine's link connects or
 * reconnects (the menu acts); without it the act is held under the link's hold, as Send and Stop are.
 */
export type ActWords = { act: string; done: string; closes?: true };

/** UC-7.5's words per act. Taking back a waiting message and a pane's answer have none yet (U4 and U12 add theirs). */
export const ACT_WORDS: Readonly<Partial<Record<CommandName, ActWords>>> = {
  'session.fork': { act: 'fork', done: 'forked', closes: true },
  'session.archive': { act: 'archive', done: 'archived', closes: true },
  'session.update': { act: 'unarchive', done: 'unarchived', closes: true },
  'session.rename': { act: 'rename', done: 'renamed', closes: true },
  'attention.acknowledge': { act: 'dismiss', done: 'dismissed' },
  'session.interrupt': { act: 'stop', done: 'stopped' },
  'session.send': { act: 'send', done: 'sent' },
  'session.steer': { act: 'send', done: 'sent' },
};

export type LinkPhase = 'up' | 'connecting' | 'reconnecting' | 'offline' | 'removed';

/** What the window knows of a session's machine when it draws a control. */
export type RemoteStanding = {
  machine: string; // the machine's name
  phase: LinkPhase;
  capabilities: readonly string[] | null; // the roster's list; null while none is known (the link is not up)
  owner: boolean | null; // MachineState.owner; null while not known
};

const capitalised = (text: string) => (text === '' ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`);

/**
 * UC-7.5's first table: the sentence a control issuing `command` is disabled with, or null. `label` stands for the act
 * where ACT_WORDS has no row or the control's own label differs. The first row that applies answers: the command is
 * declared; the machine's build does not list its capability; the machine is offline; its link connects or reconnects
 * (an act that `closes`); a fork by a member known not to own the machine. The `removed` phase is main's to word.
 */
export function disabledWords(command: CommandName, standing: RemoteStanding, label?: string): string | null {
  const declared = REMOTE_UNAVAILABLE[command];
  if (declared !== undefined) return declared;
  const words = ACT_WORDS[command];
  const act = label ?? words?.act;
  const { machine, phase, capabilities } = standing;
  const needs = REMOTE_NEEDS[command];
  if (needs !== undefined && capabilities !== null && !capabilities.includes(needs)) return `Can’t ${act ?? 'do this'} on ${machine} yet. Update MAWS on ${machine} and try again.`;
  if (phase === 'offline' && act !== undefined) return `${capitalised(act)} is unavailable while ${machine} is offline.`;
  if (words?.closes === true && phase === 'connecting') return `Connecting to ${machine}…`;
  if (words?.closes === true && phase === 'reconnecting') return `Reconnecting to ${machine}…`;
  if (command === 'session.fork' && standing.owner === false) return `Only ${machine}’s owners can fork a session there.`;
  return null;
}

/** The rank a `grade` refusal of `command` was made at: a by-effect command's offered form (an unarchive takes `manage`). */
function refusedAt(command: CommandName): string | undefined {
  if (command === 'session.update') return 'manage';
  const grade = gradeOf(command);
  return typeof grade === 'object' ? grade.floor : grade;
}

/** What follows "Not <done>: " for the machine's or the link's refusal `refusal` (UC-7.5's second table). */
function reasonOf(command: CommandName, machine: string, refusal: string, detail?: { mode?: string }): string {
  switch (refusal) {
    case 'offline':
    case 'not-sent':
      return `${machine} is offline`;
    case 'not-offered':
      return `update MAWS on ${machine} and try again`;
    case 'owners-only':
      return `only ${machine}’s owners can`;
    case 'grade': {
      const grade = refusedAt(command);
      if (grade === 'spawn') return `you can’t start sessions on ${machine}`;
      if (grade === 'manage') return 'only the session’s owners can';
      return 'you can read this session but not act on it';
    }
    case 'step-up':
      return 'the confirmation was cancelled';
    case 'read-only':
      return `${machine} is in read-only mode`;
    case 'ceiling':
      return detail?.mode === undefined ? `${machine} refused it (ceiling)` : `${machine} doesn’t start sessions in ${detail.mode} from another machine`;
    case 'unavailable':
    case 'restart':
    case 'busy':
    case 'state-too-old':
      return `${machine} is busy; try again in a moment`;
    default:
      return `${machine} refused it (${refusal})`;
  }
}

/** `Not <done>` for `command`; a command with no words is named by itself. */
const notDone = (command: CommandName) => `Not ${ACT_WORDS[command]?.done ?? command}`;

/**
 * UC-7.5's second table: the sentence of an act that ended without its effect. `refusal` is the machine's or the link's
 * code; `detail.mode` the permission mode a `ceiling` refusal names, when the device knows it. Main words it (a
 * command with an ACT_WORDS row); the window shows it as it is.
 */
export function refusalWords(command: CommandName, machine: string, refusal: string, detail?: { mode?: string }): string {
  return `${notDone(command)}: ${reasonOf(command, machine, refusal, detail)}`;
}

/** The same for an act the machine ran and that failed: `Not <done>: <the machine's own sentence>`. */
export function failureWords(command: CommandName, sentence: string): string {
  return `${notDone(command)}: ${sentence}`;
}
