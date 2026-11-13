// What a waiting request offers away from its session's pane: a notification's buttons and the sidebar's hover card
// (UX wave U1a §H; l4-approvals-09, ticket 333). One rule for both, the surface a parameter, so the two never disagree
// about the same request. The first row that fits decides:
//   - not a permission (a question, a plan, a dialog, a form, MAWS's ask), or not read: nothing
//   - flagged "default to no", or needing its own consent surface: Deny alone
//   - a read-only tool (`READ_ONLY_TOOLS`): Allow once and Deny
//   - a shell command the surface shows whole: Allow once and Deny. The hover card shows any command (its preview
//     scrolls); a notification's banner, one line of at most NOTIFICATION_COMMAND_MAX characters
//   - anything else (a longer command on a notification, a file change, an MCP tool, an agent launch): Deny alone
// Allow once is the once-only answer and Deny the plain deny with no reason; no lasting scope is given from outside. The
// caller adds what this cannot know: that the item waits (UC-1), and that the session's port carries the answer. Pure.
import type { SessionEvent } from '../graph/events';
import { isReadOnlyRequest } from './read-only-tools';

export type OutsideSurface = 'notification' | 'hover';
export interface OutsideAnswers { allowOnce: boolean; deny: boolean }

/** The longest command a notification's banner is taken to show whole, in characters, on one line. */
export const NOTIFICATION_COMMAND_MAX = 120;

const NEITHER: OutsideAnswers = { allowOnce: false, deny: false };
const DENY_ONLY: OutsideAnswers = { allowOnce: false, deny: true };
const BOTH: OutsideAnswers = { allowOnce: true, deny: true };

/** The shell command a request runs, when `surface` shows it whole; null for any other request. */
export function shownCommand(request: SessionEvent | null, surface: OutsideSurface): string | null {
  if (request?.kind !== 'permission.requested' || request.toolName !== 'Bash') return null;
  const command = request.input !== null && typeof request.input === 'object' ? (request.input as { command?: unknown }).command : undefined;
  if (typeof command !== 'string') return null;
  if (surface === 'hover') return command;
  return !/[\r\n]/.test(command) && [...command].length <= NOTIFICATION_COMMAND_MAX ? command : null;
}

/** What a waiting request offers away from its session's pane. */
export function outsideAnswers(request: SessionEvent | null, surface: OutsideSurface): OutsideAnswers {
  if (request?.kind !== 'permission.requested') return NEITHER;
  if (request.defaultToNo === true || request.requiresUserInteraction === true) return DENY_ONLY;
  if (isReadOnlyRequest(request) || shownCommand(request, surface) !== null) return BOTH;
  return DENY_ONLY;
}
