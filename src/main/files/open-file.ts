// Open File… and the sender's guard (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md,
// §C; write rule line 2, decisions 3, 9 and 14).
//
// The guard: `files.writeOutside` and `layout.openFile` are answered only for a live page of an app window, the window
// `createWindow` registered (`appWindows()`). The router's sender check already refuses a subframe, a web contents that
// is no window's and a page at another origin; this refuses, too, a window of the app's origin that is not an app window
// (a presentation, the repair window) and main's in-process callers, whose asker is no page. The app registers it with
// `guardCommand`, which runs it before anything is forwarded (src/main/ipc/router.ts).
//
// Open File…: `layout.openFile` is main's own command, as `layout.pickFiles` is, since a request to the daemon has ten
// seconds and a person choosing takes longer. Its handler shows the system's chooser for one file on the asking page's
// window (the client port; under MAWS_E2E=1 its seam answers in place of the panel), then records the person's choice
// for the session with `files.grant`, a command only main sends, and answers the real path the daemon granted. The
// session's id is bare here and its machine is the router's target: `layout.*` is graded `client`, so a session of
// another machine is refused by the router before this runs.
import type { ClientPort, PickAnswer } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import type { OpenFileOutput } from '@shared/ipc/schema/layout';
import { pageOf } from '../ipc/clients';
import type { CommandGuard, MainContext } from '../ipc/router';
import { appWindows } from '../windows';

// The asker is a page instance that still lives, shown by a window the app registered as its own.
export function isAppPage(client: ClientRef): boolean {
  const page = pageOf(client);
  return page !== null && appWindows().some((win) => win.webContents === page);
}

export const appPageOnly: CommandGuard = (name, _input, ctx) =>
  isAppPage(ctx.client) ? undefined : ipcError('forbidden_sender', `${name} may only be invoked by the app window`);

export interface OpenFileDeps {
  port: Pick<ClientPort, 'pick'>;
  isAppPage(client: ClientRef): boolean;
  grant(input: CommandInput<'files.grant'>): Promise<CommandResult<'files.grant'>>; // main's own send, the id bare as it came
}

const CANCELLED: OpenFileOutput = { status: 'cancelled' };
const UNAVAILABLE: OpenFileOutput = { status: 'refused', reason: 'unavailable' };

// The askers whose Open File… is being answered: one chooser per page, and one grant from it.
const asking = new WeakSet<ClientRef>();

export async function openChosenFile(input: CommandInput<'layout.openFile'>, ctx: Pick<MainContext, 'client' | 'target'>, deps: OpenFileDeps): Promise<OpenFileOutput> {
  const { client } = ctx;
  if (asking.has(client)) return CANCELLED; // C2: its chooser is open
  asking.add(client);
  try {
    let answer: PickAnswer;
    try {
      answer = await deps.port.pick(client, { kind: 'file', multiple: false }); // no filter, no starting folder: the system remembers the last
    } catch (error) {
      console.error('[open-file] the chooser failed', error);
      return UNAVAILABLE;
    }
    const path = 'paths' in answer ? answer.paths[0] : undefined;
    if (path === undefined) return CANCELLED; // cancelled, or no client to ask
    if (!deps.isAppPage(client)) return CANCELLED; // C1: the page reloaded or its window closed meanwhile; nothing is granted
    let granted: CommandResult<'files.grant'>;
    try {
      granted = await deps.grant({ appSessionId: input.appSessionId, path });
    } catch (error) {
      console.error('[open-file] files.grant failed', error);
      return UNAVAILABLE;
    }
    if (!granted.ok) return UNAVAILABLE; // C3: refused, unknown to an older daemon, or not answered in time; nothing is assumed granted
    return granted.value.status === 'granted' ? { status: 'opened', path: granted.value.path } : { status: 'refused', reason: 'not-a-file' }; // C4
  } finally {
    asking.delete(client);
  }
}
