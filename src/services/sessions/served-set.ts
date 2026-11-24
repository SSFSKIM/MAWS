// The set of MAWS's tools a launch attempt serves (board ticket 421; docs/doperpowers/plans/2026-11-23-tool-choice.md,
// Interfaces §E, D1 and D8): answered once per attempt, before the record, the supplement and the launch line are made
// from it, so all three say the same. The full set is served by any engine host. Any other set needs a host whose welcome
// lists `engine.mawsTools`; on an older one a new session is served the full set, which is what that host serves (its
// record then holds none, and says so), while a session that already has a set of its own (a resume's record, a fork's
// source) is refused: the engine holds a conversation to the tools it was first sent, so it never runs under another list.
// Such a host exists only across an update or after a downgrade.
import { ENGINE_MAWS_TOOLS_CAPABILITY } from '@shared/host/socket-protocol';
import { FULL_MAWS_TOOL_SET, isFullSet, type MawsToolSet } from '@shared/maws/tool-set';
import type { Setup } from './setup-steps';

export const MAWS_TOOLS_UNSUPPORTED = "This session's tools need a newer MAWS on this machine.";

// `new`: an intent's own set, chosen before its first launch; `kept`: a set the conversation already has (a resume's
// record's, a fork's or a side thread's source record's), each read `?? FULL_MAWS_TOOL_SET`.
export type WantedSet = { kind: 'new' | 'kept'; set: MawsToolSet };

export async function servedSet(s: Pick<Setup, 'hostLists'>, wanted: WantedSet): Promise<{ set: MawsToolSet } | { refused: string }> {
  if (isFullSet(wanted.set) || (await s.hostLists(ENGINE_MAWS_TOOLS_CAPABILITY))) return { set: wanted.set };
  return wanted.kind === 'new' ? { set: FULL_MAWS_TOOL_SET } : { refused: MAWS_TOOLS_UNSUPPORTED };
}
