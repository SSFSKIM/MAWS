// A JavaScript dialog on a tab under a cua lease (the in-app browser spec of 2026-10-08, "Dialogs (after spike S1)";
// P1 A-53, amending A-42): the `-run-dialog` wrap (agent/dialogs.ts) hands the dialog here, which shows nothing and
// answers nothing at first: it holds Electron's callback and lets CDP decide. S1 measured on Electron 44.4.5 that the
// lease receives `Page.javascriptDialogOpening` while the callback is held, that the vendor's
// `Page.handleJavaScriptDialog` answers the page and `Page.javascriptDialogClosed` follows, and that the held callback
// called once afterwards is an inert no-op. A dialog nobody answers within DIALOG_DEFAULT_MS gets A-42's defaults (alert
// dismissed, confirm false) through the held callback, never through CDP (S1: an unanswered dialog stays open for good,
// and collecting the callback answers nothing); Chromium then emits the `Closed` event itself, so a cell that ignores
// dialogs cannot hang the tab. Each dialog's type, a capped excerpt and its answer are told to the windows.
import type { BrowserActivity } from '@shared/browser/activity';
import { BROWSER_DIALOG_EXCERPT_MAX_CHARS } from '@shared/browser/dialog';
import type { RunDialogCallback, RunDialogInfo } from '../agent/dialogs';
import type { TabEntry } from '../tabs';

export const DIALOG_DEFAULT_MS = 30_000;

export interface HeldDialogsDeps {
  activity(entry: TabEntry, activity: BrowserActivity): void;
  log(line: string): void;
}

interface Held {
  type: 'alert' | 'confirm';
  excerpt: string;
  callback: RunDialogCallback;
  timer: ReturnType<typeof setTimeout>;
}

interface TabDialogs {
  dialogs: Held[]; // oldest first
  stop(): void; // the tab's Closed listener
}

export class HeldDialogs {
  private readonly held = new Map<TabEntry, TabDialogs>();

  constructor(private readonly deps: HeldDialogsDeps) {}

  // The wrap's held route: `alert` or `confirm` on a leased tab.
  hold(entry: TabEntry, info: RunDialogInfo, callback: RunDialogCallback): void {
    const type = info.dialogType === 'confirm' ? 'confirm' : 'alert';
    const excerpt = cut(info.messageText ?? '', BROWSER_DIALOG_EXCERPT_MAX_CHARS);
    const dialog: Held = { type, excerpt, callback, timer: setTimeout(() => this.answerByDefault(entry, dialog), DIALOG_DEFAULT_MS) };
    let tab = this.held.get(entry);
    if (!tab) {
      // the page's dialog closed (the vendor answered it): the oldest held one is over
      const stop = entry.debugger?.on('Page.javascriptDialogClosed', (params) => this.closed(entry, params)) ?? (() => {});
      this.held.set(entry, (tab = { dialogs: [], stop }));
    }
    tab.dialogs.push(dialog);
  }

  dispose(): void {
    for (const tab of this.held.values()) {
      for (const dialog of tab.dialogs) clearTimeout(dialog.timer);
      tab.stop();
    }
    this.held.clear();
  }

  private closed(entry: TabEntry, params: unknown): void {
    const dialog = this.held.get(entry)?.dialogs[0];
    if (!dialog) return;
    this.drop(entry, dialog);
    const result = (params as { result?: unknown } | null)?.result === true;
    this.deps.activity(entry, { kind: 'dialog', type: dialog.type, excerpt: dialog.excerpt, answered: result ? 'accepted' : 'dismissed' });
  }

  private answerByDefault(entry: TabEntry, dialog: Held): void {
    if (!this.drop(entry, dialog)) return;
    try {
      dialog.callback(false, ''); // alert dismissed, confirm false; a no-op when CDP answered unseen (S1)
    } catch (error) {
      this.deps.log(`a held dialog's default answer failed on tab ${entry.tab.tabId}: ${(error as Error).message}`);
    }
    this.deps.activity(entry, { kind: 'dialog', type: dialog.type, excerpt: dialog.excerpt, answered: 'default' });
  }

  private drop(entry: TabEntry, dialog: Held): boolean {
    const tab = this.held.get(entry);
    const index = tab?.dialogs.indexOf(dialog) ?? -1;
    if (!tab || index === -1) return false;
    tab.dialogs.splice(index, 1);
    clearTimeout(dialog.timer);
    if (tab.dialogs.length === 0) {
      this.held.delete(entry);
      tab.stop();
    }
    return true;
  }
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text[max - 1]!) ? max - 1 : max;
  return text.slice(0, end);
}
