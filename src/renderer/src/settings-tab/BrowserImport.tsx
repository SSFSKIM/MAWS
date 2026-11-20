// E4b (Task 3.2): Settings › Browser's imported Chrome profiles (E4b execution document, Design §11 and §12; P-21),
// mounted from BrowserSection.tsx's E4b block under E4a's rows:
//
// - "Chrome profile": Import a Chrome profile… opens the import sheet; while a run goes on (started here, in another
//   window, or before a reload) the row says its step and Show reopens the running sheet. A run that ended cancelled
//   or failed with no sheet showing it is offered beside the button, with Show, until a sheet shows its report.
// - One group per imported record: its date, the report's summary with Show report (cua board #90: and, when its
//   bookmarks were imported, Sync bookmarks now with the mirror's last read), an On/Off toggle per extension
//   (main loads or unloads it at once when the profile's partition is open; wallets start off; cua #90: under a muted
//   line saying what their popups cannot see here), and Remove imported
//   profile behind its confirm sheet.
//
// The records and the run come from the import store (App.tsx connects it); the toggles live in `profiles.json`, never
// in settings (Decision Log 1). The sheets render here, on this block's own state (Decision Log 21).
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1): Import… is named in full (G70); a profile's
// row is its date and a "…" menu holding Show report, Sync bookmarks now and Remove, its summary in the report (G73,
// G74), a failed sync's line at rest and a good one in the row's note; the popup limit is an ⓘ beside the Extensions
// heading (G76); each extension is a switch (G77).
import { useState } from 'react';
import type { ImportedExtension } from '@shared/browser/import';
import type { ImportedBookmarks, ImportedProfile } from '@shared/browser/profiles';
import { useNow } from '../app/use-now';
import { syncLine } from '../tools/browser/chrome/profile';
import { BROWSER_COPY } from '../tools/browser/copy';
import { importDate, IMPORT_COPY } from '../tools/browser/import/copy';
import { ImportSheet } from '../tools/browser/import/ImportSheet';
import { RemoveSheet } from '../tools/browser/import/RemoveSheet';
import { StatusChip } from '../tools/browser/import/Report';
import { openImport, setExtension, showReport, syncBookmarks, useBrowserImport } from '../tools/browser/import/store';
import { Tip } from '../ui/tip';
import { BROWSER } from './copy';
import { Setting, Switch, TEXT_ACTION, WORD_OWNER } from './parts';
import { RowMenu } from './row-menu';

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
      <Setting row="browser.chromeProfile" state={running ? 'running' : 'default'}>
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
            <button type="button" aria-label={BROWSER.importName} className={TEXT_ACTION} onClick={() => open(openImport)}>
              {BROWSER.import}
            </button>
          </>
        )}
      </Setting>
      {records.map((record) => (
        <section key={record.profileDir} aria-label={record.name} data-imported-profile={record.profileDir} className="border-t border-border pt-1">
          {/* U11a M9: a row made at run time, drawn under the profile's own name from its declaration */}
          <ProfileRow record={record} running={running !== null} onReport={() => open(() => showReport(record.report))} onRemove={() => setRemoving(record)} />
          {record.extensions.length > 0 && (
            <p className="m-0 mt-1 flex items-center gap-1.5 text-ui-sm font-medium text-fg-muted">
              {BROWSER.extensions}
              {/* cua #90: what their popups cannot see here */}
              <Tip content={BROWSER.popupLimit}>
                <span role="img" aria-label={BROWSER.popupLimit} tabIndex={0} data-extension-popup-limit="" className={`cursor-default font-normal ${WORD_OWNER}`}>
                  ⓘ
                </span>
              </Tip>
            </p>
          )}
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

// An imported profile's row: its date and its "…" menu. Show report waits while an import runs; cua #90: Sync bookmarks
// now, when its bookmarks were imported, with the last read's time in the row's note, or why it failed at rest, as the
// profile popover says it.
function ProfileRow({ record, running, onReport, onRemove }: { record: ImportedProfile; running: boolean; onReport(): void; onRemove(): void }) {
  const [syncing, setSyncing] = useState(false);
  const now = useNow();
  const bookmarks: ImportedBookmarks | null = record.bookmarks;
  const line = bookmarks === null ? null : syncLine(bookmarks, now);
  const failed = bookmarks !== null && bookmarks.error !== null;
  const sync = async () => {
    setSyncing(true);
    await syncBookmarks(record.profileDir);
    setSyncing(false);
  };
  return (
    <Setting row="browser.importedProfile" label={record.name} noteEnd={line !== null && !failed ? <p className="m-0">{line}</p> : undefined}>
      <span className="text-fg-muted">{BROWSER.importedOn(importDate(record.importedAt))}</span>
      {line !== null && failed && <span className="text-warning">{line}</span>}
      <RowMenu
        label={BROWSER.actions(record.name)}
        actions={[
          { label: BROWSER.showReport, disabled: running, onSelect: onReport },
          bookmarks !== null && { label: syncing ? BROWSER_COPY.profile.syncing : BROWSER_COPY.profile.syncNow, disabled: syncing, onSelect: () => void sync() },
          { label: BROWSER.remove, danger: true, onSelect: onRemove },
        ]}
      />
    </Setting>
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
    <Setting row="browser.extension" state={extension.wallet ? 'wallet' : 'default'} label={extension.name}>
      <span className="text-fg-muted">{extension.version}</span>
      {pending === null ? (
        <StatusChip extension={extension} />
      ) : (
        <span role="status" className="text-ui-sm text-fg-muted">
          {IMPORT_COPY.toggling(pending)}
        </span>
      )}
      <span aria-busy={pending !== null} className={`inline-flex ${pending === null ? '' : 'pointer-events-none opacity-60'}`}>
        <Switch checked={pending ?? extension.enabled} label={extension.name} onChange={(next) => void toggle(next)} />
      </span>
    </Setting>
  );
}
