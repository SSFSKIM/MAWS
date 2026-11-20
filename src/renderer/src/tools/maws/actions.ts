// E1 (M3): the transcript actions behind the `maws` server's rows, registered from App.tsx's E1 block (E1 execution
// document, Interfaces "The renderer"). A delivered file opens in its viewer or shows in Finder through main's
// `files.openExternal` and `files.reveal`, under the session's allowlist; what main refused comes back as the text the
// row shows. A capsule opens the Question sheet (M4's X5 tool) with the ask's id and the capsule's own data (residue 14):
// the sheet answers a pending ask it holds and shows any other read-only from that data; until a build registers the
// sheet, opening does nothing.
// P5 O7 M5a (A10): a lane B session on another machine's delivered file opens as a copy here (lane-b/open-copy.ts).
// Ticket 627: a session on another machine over RL2, either lane, reveals nothing here: the window's helper's sentence.
import type { MawsBridge } from '@shared/ipc/schema';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { ipc } from '../../ipc/client';
import { openSessionFile } from '../../lane-b/open-copy';
import { remoteUnavailableOf } from '../../lane-b/remote-unavailable';
import { panelHost, usePanelHost } from '../../panel/host';
import type { AskRowData, TranscriptActions } from '../../transcript';
import { VIEWER_COPY } from '../code/copy';

// The Question sheet's params (M4's tool reads them).
export interface AskSheetParams {
  askId?: string;
  historical?: AskRowData;
}

export function mawsTranscriptActionsOver(client: MawsBridge): Pick<TranscriptActions, 'openAsk' | 'openDelivered' | 'revealDelivered'> {
  return {
    openAsk(appSessionId, ask) {
      if (!usePanelHost.getState().tools.has(ASK_SHEET_TOOL_ID)) return;
      panelHost.addTool<AskSheetParams>(ASK_SHEET_TOOL_ID, { appSessionId, params: { askId: ask.askId, historical: ask }, activate: true });
    },
    async openDelivered(appSessionId, path) {
      const result = await openSessionFile(appSessionId, path, client);
      if (!result.ok) return VIEWER_COPY.refused(result.error.message);
      return result.value.opened ? null : VIEWER_COPY.notOpened(result.value.message ?? '');
    },
    async revealDelivered(appSessionId, path) {
      const unavailable = remoteUnavailableOf(appSessionId, 'files.reveal');
      if (unavailable !== null) return VIEWER_COPY.refused(unavailable);
      const result = await client.invoke('files.reveal', { appSessionId, path });
      if (!result.ok) return VIEWER_COPY.refused(result.error.message);
      return result.value.revealed ? null : VIEWER_COPY.refused(result.value.message ?? '');
    },
  };
}

export const mawsTranscriptActions = mawsTranscriptActionsOver(ipc);
