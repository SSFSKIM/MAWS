// The depth column's own wiring of the plane transcript, which P5 O9 M3 lifted into MAWS's renderer
// (`src/renderer/src/lane-a/`): the desk's store keys, its latency marks (desk ticket #57) and its per-project model
// store go in as the transcript's options; and a session's reach, which the keeper takes, is read from the desk's
// session record.
import type { Reach } from '../../../../../src/renderer/src/lane-a/keeper';
import { PlaneTranscript, type PlaneTranscriptHooks, type PlaneTranscriptOptions } from '../../../../../src/renderer/src/lane-a/plane-transcript';
import { framePattern } from '../../conversation/tail';
import { latency } from '../../latency/latency';
import type { DeskSession } from '../../shell/sessions';
import { noteModel } from '../../state/models';

/** The transcript's hops, timed by the tab's recorder (`latency/latency.ts`). */
const DESK_LATENCY: NonNullable<PlaneTranscriptHooks['latency']> = {
  record: (path, ms, ref) => latency.record(path, ms, ref),
  drawn: (path, start, wall, ref) => latency.drawn(path, start, wall, ref),
  count: (name) => latency.count(name),
  noteCall: (toolUseId, timestamp) => latency.noteCall(toolUseId, timestamp),
  // The owner's own send, matched to the send it answers by its frame line.
  ownRow: (lines, timestamp) =>
    latency.ownerRow((ref) => {
      const frame = framePattern({ ...ref, from: 'human' });
      return lines.some((line) => frame.test(line));
    }, timestamp),
};

export type DeskTranscriptOptions = Omit<PlaneTranscriptOptions, 'sessionKey' | 'hooks'> & { project: string };

/**
 * One transcript of a desk session: kept under `desk:<project>:<session>` (a subagent's with `:<agentId>` after it), timed
 * for the latency overlay, and noting each model it answered from in the project's list the pickers offer.
 */
export function deskTranscript({ project, ...options }: DeskTranscriptOptions): PlaneTranscript {
  return new PlaneTranscript({
    ...options,
    sessionKey: `desk:${project}:${options.target.session}`,
    hooks: { latency: DESK_LATENCY, noteModel: (model) => noteModel(project, model) },
  });
}

/**
 * The session's reach as its presence says it now (DX8): no presence since the project socket's last welcome, which
 * clears what was known (`project/connection.ts`) until the hub sends it again, is not known.
 */
export const reachOf = (session: DeskSession): Reach =>
  session.machineOnline === false ? 'unreachable' : session.presence == null ? 'unknown' : session.presence.record != null ? 'reachable' : 'unreachable';
