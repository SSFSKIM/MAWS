// What a Transcript does for an action its caller did not supply: the two X2 commands C6 can call itself (a spilled
// result through fs.readSpill, a link through layout.openExternal); the rest belong to C5, C7 and C8 and do nothing.
// Loading this module makes them the actions a row reads outside any Transcript too (./context.tsx's host actions);
// it is kept apart from ./context.tsx so the views import without MAWS's IPC client.
import { ipcLoadSpill, ipcOpenExternal } from '../source/ipc';
import { NO_ACTIONS, setHostActions, type TranscriptActions } from './context';

export const DEFAULT_ACTIONS: TranscriptActions = { ...NO_ACTIONS, loadSpill: ipcLoadSpill, openExternal: ipcOpenExternal };

setHostActions(DEFAULT_ACTIONS);
