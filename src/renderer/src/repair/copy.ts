// The repair window's words (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §B), as the
// document writes them: each kind's headline, body and actions, the first action the default.
import type { RepairAction, RepairKind } from '@shared/repair';

export const REPAIR = {
  attempting: 'Starting…', // the word cut (C168)
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

const LOGIN_ITEMS = 'System Settings › General › Login Items & Extensions';

// The word cut (C166): each body is the cause and the fix; the headline names the machine daemon, so no body explains
// it or names the process
export function body(kind: RepairKind, why: string): BodyPart[] {
  switch (kind) {
    case 'no-unit':
      return [{ text: 'Only an installed MAWS.app sets it up for the main profile. Run this build on a profile of its own with ' }, { code: 'pnpm dev:scratch' }, { text: ', or install MAWS.app and open this build again.' }];
    case 'not-loaded':
      return [{ text: `macOS has not loaded it. In ${LOGIN_ITEMS}, turn MAWS on and come back.` }];
    case 'install-refused':
      return [{ text: `${why}. If MAWS is off in ${LOGIN_ITEMS}, turn it on and come back.` }];
    case 'not-started':
      return [{ text: `It did not answer within 10 seconds: ${why}.` }];
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
