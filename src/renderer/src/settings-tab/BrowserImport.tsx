// E4b (Task 3.2): Settings › Browser's imported Chrome profiles (E4b execution document, Design §11 and §12; P-21),
// mounted from BrowserSection.tsx's E4b block under E4a's rows:
//
// - "Chrome profile": Import a Chrome profile… opens the import sheet; while a run goes on (started here, in another
//   window, or before a reload) the row says its step and Show reopens the running sheet. A run that ended cancelled
//   or failed with no sheet showing it is offered beside the button, with Show, until a sheet shows its report.
// - One group per imported record: its date, the report's summary with Show report (cua board #90: and, when its
//   bookmarks were imported, Sync bookmarks now with the mirror's last read), an On/Off toggle per extension
//   (main loads or unloads it at once when the profile's partition is open; wallets start off), and Remove imported
//   profile behind its confirm sheet.
//
// The records and the run come from the import store (App.tsx connects it); the toggles live in `profiles.json`, never
// in settings (Decision Log 1). The sheets render here, on this block's own state (Decision Log 21).
import { useState } from 'react';
import type { ImportedExtension } from '@shared/browser/import';
import { summaryWords } from '@shared/browser/import-summary';
import type { ImportedBookmarks, ImportedProfile } from '@shared/browser/profiles';
import { useNow } from '../app/use-now';
import { syncLine } from '../tools/browser/chrome/profile';
import { BROWSER_COPY } from '../tools/browser/copy';
import { importDate, IMPORT_COPY } from '../tools/browser/import/copy';
import { ImportSheet } from '../tools/browser/import/ImportSheet';
import { RemoveSheet } from '../tools/browser/import/RemoveSheet';
import { StatusChip } from '../tools/browser/import/Report';
import { openImport, setExtension, showReport, syncBookmarks, useBrowserImport } from '../tools/browser/import/store';
import { BROWSER } from './copy';
import { Segment, Setting, TEXT_ACTION } from './parts';

// TEXT_ACTION in the danger colour, at rest and on hover.
const DANGER_ACTION = TEXT_ACTION.split(' ')
  .map((name) => (name === 'text-fg-muted' ? 'text-danger' : name === 'hover:text-fg' ? 'hover:text-danger' : name))
  .join(' ');

export function BrowserImport() {
  const [sheet, setSheet] = useState(false);
  const [removing, setRemoving] = useState<ImportedProfile | null>(null);
  const records = useBrowserImport((s) => s.records);
  const running = useBrowserImport((s) => (s.stage.kind === 'running' ? s.stage : null));
  const unseen = useBrowserImport((s) => s.unseen);
  const open = (prepare: () => void) => {
    prepare();
    setSheet(true);
  };
  return (
    <>
      <Setting label={BROWSER.chromeProfile} note={running ? undefined : BROWSER.importNote}>
        {running ? (
          <>
            <span className="text-fg-muted">{BROWSER.importing(running.progress ? IMPORT_COPY.phase(running.progress.phase) : IMPORT_COPY.starting)}</span>
            <button type="button" className={TEXT_ACTION} onClick={() => setSheet(true)}>
              {BROWSER.show}
            </button>
          </>
        ) : (
          <>
            {unseen && unseen.outcome !== 'done' && (
              <>
                <span className="text-fg-muted">{BROWSER.lastImport(unseen.outcome)}</span>
                <button type="button" className={TEXT_ACTION} onClick={() => open(() => showReport(unseen))}>
                  {BROWSER.show}
                </button>
              </>
            )}
            <button type="button" className={TEXT_ACTION} onClick={() => open(openImport)}>
              {BROWSER.import}
            </button>
          </>
        )}
      </Setting>
      {records.map((record) => (
        <section key={record.profileDir} aria-label={record.name} data-imported-profile={record.profileDir} className="border-t border-border pt-1">
          <Setting label={record.name} note={summaryWords(record.report)}>
            <span className="text-fg-muted">{BROWSER.importedOn(importDate(record.importedAt))}</span>
            <button type="button" className={TEXT_ACTION} disabled={running !== null} onClick={() => open(() => showReport(record.report))}>
              {BROWSER.showReport}
            </button>
            {record.bookmarks !== null && <SyncBookmarks profileDir={record.profileDir} bookmarks={record.bookmarks} />}
            <button type="button" className={DANGER_ACTION} onClick={() => setRemoving(record)}>
              {BROWSER.remove}
            </button>
          </Setting>
          {record.extensions.length > 0 && <p className="m-0 mt-1 text-ui-sm font-medium text-fg-muted">{BROWSER.extensions}</p>}
          {record.extensions.map((extension) => (
            <ExtensionToggle key={extension.id} profileDir={record.profileDir} extension={extension} />
          ))}
        </section>
      ))}
      {sheet && <ImportSheet onClose={() => setSheet(false)} />}
      {removing && <RemoveSheet record={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

// cua #90: Sync bookmarks now, the last read's time (or why it failed) before it, as the profile popover says it
function SyncBookmarks({ profileDir, bookmarks }: { profileDir: string; bookmarks: ImportedBookmarks }) {
  const [syncing, setSyncing] = useState(false);
  const line = syncLine(bookmarks, useNow());
  const sync = async () => {
    setSyncing(true);
    await syncBookmarks(profileDir);
    setSyncing(false);
  };
  return (
    <>
      {line && <span className={bookmarks.error === null ? 'text-fg-muted' : 'text-warning'}>{line}</span>}
      <button type="button" className={TEXT_ACTION} disabled={syncing} onClick={() => void sync()}>
        {syncing ? BROWSER_COPY.profile.syncing : BROWSER_COPY.profile.syncNow}
      </button>
    </>
  );
}

// While main loads (and lets the background settle) or unloads the extension, the row says so and the toggle waits.
function ExtensionToggle({ profileDir, extension }: { profileDir: string; extension: ImportedExtension }) {
  const [pending, setPending] = useState<boolean | null>(null); // the value asked for, until main answers
  const toggle = async (enabled: boolean) => {
    if (pending !== null) return;
    setPending(enabled);
    await setExtension(profileDir, extension.id, enabled);
    setPending(null);
  };
  return (
    <Setting label={extension.name} note={extension.wallet ? BROWSER.walletOff : undefined}>
      <span className="text-fg-muted">{extension.version}</span>
      {pending === null ? (
        <StatusChip extension={extension} />
      ) : (
        <span role="status" className="text-ui-sm text-fg-muted">
          {IMPORT_COPY.toggling(pending)}
        </span>
      )}
      <span aria-busy={pending !== null} className={`flex max-w-[260px] flex-1 ${pending === null ? '' : 'pointer-events-none opacity-60'}`}>
        <Segment label={extension.name} value={(pending ?? extension.enabled) ? 'on' : 'off'} options={BROWSER.toggles} onChange={(next) => void toggle(next === 'on')} />
      </span>
    </Setting>
  );
}
