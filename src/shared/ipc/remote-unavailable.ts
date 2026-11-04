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
// - the session's lifecycle and its record, which the machine's own app runs (launch, stop, start, fork, archive, take
//   over, delete, rename, the setup intent, replays): a remote session starts from "+ Session" and resumes by a send;
// - the composer's machine-side extras with no remote route yet (`!` commands, `#` memory, flag settings, the working
//   directory, the prompt history's append, a steer's cancel, the skills' reload);
// - what is kept per member (drafts) or per window (visibility, the mods' surfaces and their panes, a pane's answer);
// - what acts on the asking client (open or reveal a file on the machine, a screenshot's preview there);
// - the owner channel, attention's acknowledgement, the side thread's open and its send to the main conversation, and
//   the mods' listing and override (machine-wide: they name no one session's surface).
import type { CommandName } from './schema';

const NOT_YET = 'Not on another machine yet';
const notYet = (what: string) => `${NOT_YET}: ${what}`;

/** Each command a session on another machine can't take, with the words its control shows. */
export const REMOTE_UNAVAILABLE: Readonly<Partial<Record<CommandName, string>>> = {
  // the session's lifecycle and record
  'session.launch': notYet('start it again by sending a message, or start a new session with + Session'),
  'session.stop': notYet('stopping the session’s process'),
  'session.start': notYet('start a session there with + Session'),
  'session.fork': notYet('forking a session'),
  'session.archive': notYet('archiving a session'),
  'session.takeOver': notYet('taking over a session another process holds'),
  'session.delete': notYet('deleting a session'),
  'session.deletions.keep': notYet('deleting a session'),
  'session.deletions.preview': notYet('deleting a session'),
  'session.rename': notYet('renaming a session'),
  'session.renameSession': notYet('renaming a session'),
  'session.update': notYet('pinning, archiving or marking a session read'),
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
  'session.steer.cancel': notYet('taking back a message the agent hasn’t started'),
  'session.reloadSkills': notYet('reloading skills'),
  // per member, per window
  'session.drafts.get': notYet('drafts are kept on the Mac you wrote them on'),
  'session.drafts.set': notYet('drafts are kept on the Mac you wrote them on'),
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
  'maws.pane.answer': notYet('mod surfaces'),
  // on the asking client
  'files.openExternal': notYet('opening a file there; open a copy here instead'),
  'files.reveal': notYet('showing a file in that machine’s Finder'),
  'side.screenshot.preview': notYet('screenshots'),
  // the owner channel, attention, the side thread, the mods
  'ownerChannel.state': notYet('the owner channel'),
  'ownerChannel.answered': notYet('the owner channel'),
  'ownerChannel.cancel': notYet('the owner channel'),
  'ownerChannel.markRead': notYet('the owner channel'),
  'attention.acknowledge': notYet('dismissing an error from here'),
  'side.thread.open': notYet('side threads'),
  'side.sendToMain': notYet('sending a side answer to the main conversation'),
  'mods.list': notYet('the mods that machine runs'),
  'mods.setSessionOverride': notYet('turning a mod on or off for one session'),
};
