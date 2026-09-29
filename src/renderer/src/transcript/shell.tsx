// C6's registration into C5's shell (C6 execution document, Public surface and "X2 surface C6 consumes"; C5's Slots):
// the `transcript` slot renders `TranscriptSlot` for a session tab (and, with an agent id, for C5's agent tab), and the
// transcript's path chips open C5's file tab through the layout store. `openExternal` needs no registration: the default
// actions already route links to `layout.openExternal`. Called once from `App.tsx`; a later registration (C8c's
// `openFile`) wins over this one.
import type { Slots } from '../app/slots';
import { registerSlot } from '../app/slots';
import { useLayout } from '../stores/layout';
import { TranscriptSlot } from './view/TranscriptSlot';
import { registerTranscriptActions } from './view/registry';

// The slot's props onto TranscriptSlot's: C5 passes `agentId: null` for a session tab.
export const ShellTranscript: Slots['transcript'] = ({ appSessionId, agentId }) => (
  <TranscriptSlot appSessionId={appSessionId} agentId={agentId ?? undefined} className="h-full" />
);

// A path chip: C5's file tab at that line. The chip's session is not known to a registered action, and a file tab's
// identity is its path alone (C5's `tabId`), so the tab carries none.
export const openFileInTab = (path: string, line?: number) => useLayout.getState().openTab({ kind: 'file', path, line: line ?? null, appSessionId: null });

export function connectTranscript(): () => void {
  registerSlot('transcript', ShellTranscript);
  return registerTranscriptActions({ openFile: openFileInTab });
}
