// The window's follow of a link (UX wave U6b-4c, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md,
// Interfaces §F; decisions 3 and 10; W1): a click on a link in a shown Markdown file, or on a link or a chip in a
// subagent's transcript, asks this Mac's daemon to look in that source for a link to the path and to record what it finds
// (`files.follow`). The window's word is only where to look; the daemon reads the source itself. This is the one module
// that names the command, and it sends it only for a session on this Mac (a read asks by name only there; Q6), and only
// for an absolute path. A failure of any kind is a follow that found nothing: the read that waited goes on and draws what
// it is answered.
//
// One follow at a time per session, path and source: a second click while one is under way starts none. A subagent's
// source is its agent's id with the engine session the session's record holds at the call, so a click after `/clear` is a
// follow of its own (W3). The viewer's store waits for every follow under way for its session and path before a read
// (`following`), and notes how many have answered `linked` (`linkedCount`) to know whether a read it sent before is stale
// (W1 g). Nothing here is stored: the source lives in memory alone (UC-14).
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';

/** Where a link stands: a shown Markdown file (its path, as its tab holds it), or a subagent's transcript (its agent's id). */
export type LinkSource = { file: string } | { agent: string };

const keyOf = (appSessionId: AppSessionId, path: string) => `${appSessionId}\0${path}`;
// Each session and path: its follows under way, by source
const underWay = new Map<string, Map<string, Promise<void>>>();
const linked = new Map<string, number>();

const sourceKey = (appSessionId: AppSessionId, from: LinkSource): string =>
  'file' in from ? JSON.stringify(['file', from.file]) : JSON.stringify(['agent', from.agent, useSessions.getState().records.get(appSessionId)?.engineSessionId ?? null]);

const onThisMac = (appSessionId: AppSessionId): boolean => isAddress(appSessionId) && machineOf(appSessionId) === ipc.localMachine;

/** Asks this Mac's daemon to find and record the link (`files.follow`), once at a time per session, path and source. Sends
    nothing for no session, for a session that is not on this Mac, and for a path that is not absolute. Never throws: a
    failure is a follow that found nothing. */
export function follow(appSessionId: AppSessionId | null, path: string, from: LinkSource): void {
  if (appSessionId === null || !path.startsWith('/')) return;
  const key = keyOf(appSessionId, path);
  const sources = underWay.get(key) ?? new Map<string, Promise<void>>();
  let source: string;
  let call: Promise<CommandResult<'files.follow'>>;
  try {
    if (!onThisMac(appSessionId)) return;
    source = sourceKey(appSessionId, from);
    if (sources.has(source)) return;
    call = ipc.invoke('files.follow', { appSessionId, path, from });
  } catch {
    return; // no bridge, or a session id the window cannot read: nothing was sent
  }
  // The count and the end of the follow move in one step, so a read that waited on it notes the count it left
  const settle = (found: boolean) => {
    if (underWay.get(key)?.get(source) !== settled) return; // forgotten meanwhile (resetFollows)
    if (found) linked.set(key, (linked.get(key) ?? 0) + 1);
    sources.delete(source);
    if (sources.size === 0) underWay.delete(key);
  };
  const settled: Promise<void> = call.then(
    (answer) => settle(answer.ok && answer.value.status === 'linked'),
    () => settle(false),
  );
  sources.set(source, settled);
  underWay.set(key, sources);
}

/** Every follow under way for this session and path, whatever its source, settled (never rejected) when each is answered;
    null when none is. */
export function following(appSessionId: AppSessionId | null, path: string): Promise<void> | null {
  if (appSessionId === null) return null;
  const sources = underWay.get(keyOf(appSessionId, path));
  return sources === undefined ? null : Promise.all(sources.values()).then(() => undefined);
}

/** How many follows for this session and path have answered `linked` since the window loaded. */
export function linkedCount(appSessionId: AppSessionId | null, path: string): number {
  return appSessionId === null ? 0 : (linked.get(keyOf(appSessionId, path)) ?? 0);
}

/** Tests: forget every follow under way and every count. */
export function resetFollows(): void {
  underWay.clear();
  linked.clear();
}
