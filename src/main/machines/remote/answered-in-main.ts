// What main's adapters answer themselves for another machine, with no row of that machine's offer table (P5 O7 M8,
// docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The offer audit and its contract"; the architect's ruling
// on m8-2b, item 2). A command reaches a session on another machine in exactly one of three ways: a row of the offer
// table (src/endpoint/offers.ts), an entry here, or a `REMOTE_UNAVAILABLE` entry (src/shared/ipc/remote-unavailable.ts),
// which greys its control. test/lane-b/offer-coverage.test.ts holds the three apart, every entry here to an adapter that
// takes it (the lane B adapter's `handles`, src/main/lane-b/remote.ts; lane A's `routeLaneA`, src/main/lane-a/remote.ts),
// and every name an adapter takes with no row to an entry here.
//
// Each entry says how main answers it. The list is a declaration, read by the contract test alone: the adapters route by
// their own sets, so a new name an adapter takes without a row fails the test until it is said here.
import type { CommandName } from '@shared/ipc/schema';

const LANE_A = 'lane A’s adapter drives the session through sminos’s RPCs and its RL10 plane, as `sminos.*` rows';

/** Each command main answers itself for another machine, with how it does. */
export const ANSWERED_IN_MAIN: Readonly<Partial<Record<CommandName, string>>> = {
  // the lane B adapter's substitutes: reads the pane makes that no row carries, answered from one that does
  'attention.request': 'the lane B adapter reads the pending request with the offered `session.pendingRequest`',
  'engine.models': 'the lane B adapter asks `session.listModels` of a live session there, else answers the built-in list',
  // a document's open: the window's port bridged here to a `document` stream (the `documents.open` row)
  'artifacts.open': 'the lane B adapter opens the document over a `documents.open` stream and hands the window its port',
  // a terminal's bytes and sizes ride its stream, opened under the offered spawn or attach; the host's state is the link's
  'pty.write': 'the lane B adapter writes it on the terminal’s stream',
  'pty.resize': 'the lane B adapter sends it on the terminal’s stream',
  'pty.ack': 'the lane B adapter acknowledges on the terminal’s stream',
  'pty.checkpoint': 'the lane B adapter keeps a remote terminal’s checkpoint on this Mac',
  'pty.hostState': 'the lane B adapter answers the link’s own state for the machine’s pty host',
  // lane A: every `laneA.*` is lane A's adapter's (`stopTask` and `media` it refuses `unsupported`, with their reasons)
  'laneA.list': 'lane A’s adapter answers the states of the sessions this app watches there',
  'laneA.state': LANE_A,
  'laneA.watch': LANE_A,
  'laneA.unwatch': LANE_A,
  'laneA.catalog': LANE_A,
  'laneA.read': LANE_A,
  'laneA.send': LANE_A,
  'laneA.interrupt': LANE_A,
  'laneA.answer': LANE_A,
  'laneA.model': LANE_A,
  'laneA.command': LANE_A,
  'laneA.btw': LANE_A,
  'laneA.compact': LANE_A,
  'laneA.stopAgent': LANE_A,
  'laneA.tell': LANE_A,
  'laneA.stopTask': 'lane A’s adapter refuses it `unsupported`: `stop` isn’t offered remotely (P5 Decision Log 51)',
  'laneA.media': 'lane A’s adapter refuses it `unsupported`: uploads across machines are lane B’s',
};
