// The repair window's words (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §B), as the
// document writes them: each kind's headline, body and actions, the first action the default.
import type { RepairAction, RepairKind } from '@shared/repair';

export const REPAIR = {
  attempting: 'Starting mawsd…',
  logLabel: 'Its last log lines',
} as const;

// A body is text with one optional command, drawn as code
export type BodyPart = { text: string } | { code: string };

export const HEADLINE: Record<RepairKind, string> = {
  'no-unit': 'This development build has no machine daemon for your main profile',
  'not-loaded': "MAWS's machine daemon is turned off",
  'install-refused': 'macOS did not let MAWS set up or start its machine daemon',
  'not-started': "MAWS's machine daemon did not start",
};

const LOGIN_ITEMS = 'System Settings › General › Login Items & Extensions, under Allow in the Background';

export function body(kind: RepairKind, why: string): BodyPart[] {
  switch (kind) {
    case 'no-unit':
      return [
        { text: 'MAWS runs its sessions, terminals and index in a background process, mawsd, which only an installed MAWS.app sets up for the main profile. Run this build on a profile of its own with ' },
        { code: 'pnpm dev:scratch' },
        { text: ', or install MAWS.app and open this build again.' },
      ];
    case 'not-loaded':
      return [{ text: `mawsd is installed, but macOS has not loaded it. In ${LOGIN_ITEMS}, turn MAWS on, then come back to this window.` }];
    case 'install-refused':
      return [{ text: `MAWS runs its sessions, terminals and index in a background process, mawsd, and could not load or start it: ${why}. If MAWS is turned off in ${LOGIN_ITEMS}, turn it on, then come back to this window.` }];
    case 'not-started':
      return [{ text: `macOS loaded mawsd, but it did not answer within 10 seconds: ${why}. Its last log lines are below.` }];
  }
}

export interface ActionCopy {
  action: RepairAction;
  label: string;
}

const QUIT: ActionCopy = { action: 'quit', label: 'Quit MAWS' };
const TRY_AGAIN: ActionCopy = { action: 'retry', label: 'Try Again' };
const REINSTALL: ActionCopy = { action: 'retry', label: 'Reinstall and Start' };
const LOGIN: ActionCopy = { action: 'open-login-items', label: 'Open Login Items…' };
const SHOW_LOG: ActionCopy = { action: 'reveal-log', label: 'Show Log in Finder' };

// Reinstall and Start and Try Again are the same action, `retry`: on a packaged build §A's table installs or repairs
// the unit before it starts it, and the label says so
export function actions(kind: RepairKind, packaged: boolean): ActionCopy[] {
  switch (kind) {
    case 'no-unit':
      return [QUIT, TRY_AGAIN];
    case 'not-loaded':
      return [LOGIN, TRY_AGAIN, QUIT];
    case 'install-refused':
      return [LOGIN, packaged ? REINSTALL : TRY_AGAIN, QUIT]; // a development build never installs a unit
    case 'not-started':
      return [packaged ? REINSTALL : TRY_AGAIN, SHOW_LOG, QUIT];
  }
}
