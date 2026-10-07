// E4b (Task 3.2): Settings › Browser's imported Chrome profiles (E4b execution document, Design §11 and §12; P-21),
// mounted from BrowserSection.tsx's E4b block under E4a's rows:
//
// - "Chrome profile": Import a Chrome profile… opens the import sheet; while a run goes on (started here, in another
//   window, or before a reload) the row says its step and Show reopens the running sheet.
// - One group per imported record: its date, the report's summary with Show report, an On/Off toggle per extension
//   (main loads or unloads it at once when the profile's partition is open; wallets start off), and Remove imported
//   profile behind its confirm sheet.
//
// The records and the run come from the import store (App.tsx connects it); the toggles live in `profiles.json`, never
// in settings (Decision Log 1). The sheets render here, on this block's own state (Decision Log 21).
import { useState } from 'react';
import type { ImportedExtension } from '@shared/browser/import';
import { summaryWords } from '@shared/browser/import-summary';
import type { ImportedProfile } from '@shared/browser/profiles';
import { importDate, IMPORT_COPY } from '../tools/browser/import/copy';
import { ImportSheet } from '../tools/browser/import/ImportSheet';
import { RemoveSheet } from '../tools/browser/import/RemoveSheet';
import { StatusChip } from '../tools/browser/import/Report';
import { openImport, setExtension, showReport, useBrowserImport } from '../tools/browser/import/store';
import { BROWSER } from './copy';
import { Segment, Setting, TEXT_ACTION } from './parts';

const DANGER_ACTION =
  'rounded-sm px-1.5 py-0.5 text-ui-sm whitespace-nowrap text-danger outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export function BrowserImport() {
  const [sheet, setSheet] = useState(false);
  const [removing, setRemoving] = useState<ImportedProfile | null>(null);
  const records = useBrowserImport((s) => s.records);
  const running = useBrowserImport((s) => (s.stage.kind === 'running' ? s.stage : null));
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
          <button type="button" className={TEXT_ACTION} onClick={() => open(openImport)}>
            {BROWSER.import}
          </button>
        )}
      </Setting>
      {records.map((record) => (
        <section key={record.profileDir} aria-label={record.name} data-imported-profile={record.profileDir} className="border-t border-border pt-1">
          <Setting label={record.name} note={summaryWords(record.report)}>
            <span className="text-fg-muted">{BROWSER.importedOn(importDate(record.importedAt))}</span>
            <button type="button" className={TEXT_ACTION} disabled={running !== null} onClick={() => open(() => showReport(record.report))}>
              {BROWSER.showReport}
            </button>
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

function ExtensionToggle({ profileDir, extension }: { profileDir: string; extension: ImportedExtension }) {
  return (
    <Setting label={extension.name} note={extension.wallet ? BROWSER.walletOff : undefined}>
      <span className="text-fg-muted">{extension.version}</span>
      <StatusChip extension={extension} />
      <Segment
        label={extension.name}
        value={extension.enabled ? 'on' : 'off'}
        options={BROWSER.toggles}
        onChange={(next) => void setExtension(profileDir, extension.id, next === 'on')}
      />
    </Setting>
  );
}
