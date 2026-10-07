// "Remove imported profile"'s confirm sheet (E4b Design §12): what goes (the cookies and site data, the history, the
// extensions, the profile's open tabs, counted from this window's mirror of main's tabs), an acknowledgement gating the
// destructive Remove (DeleteDialog's shape), and a refusal kept in the sheet in words. Main closes the tabs, drops the
// storage and the record; the store then puts new tabs back on Default if this profile was active.
import { useState } from 'react';
import type { ImportedProfile } from '@shared/browser/profiles';
import { Sheet, SheetForm } from '../../../sessions/Sheet';
import { CHOICE, DANGER } from '../../../sessions/ui';
import { useBrowser } from '../store';
import { IMPORT_COPY } from './copy';
import { removeProfile } from './store';

export function RemoveSheet({ record, onClose }: { record: ImportedProfile; onClose(): void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabs = useBrowser((s) => [...s.sessions.values()].reduce((n, { tabs }) => n + tabs.filter((tab) => tab.partition === record.partition).length, 0));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const refused = await removeProfile(record.profileDir);
    setBusy(false);
    if (refused === null) onClose();
    else setError(IMPORT_COPY.removeFailed(refused));
  };
  const counts = { history: record.report.history?.imported ?? 0, extensions: record.extensions.length, tabs };
  return (
    <Sheet title={IMPORT_COPY.removeTitle(record.name)} onClose={() => !busy && onClose()} data-browser-import-remove={record.profileDir}>
      <SheetForm canSubmit={acknowledged && !busy} onSubmit={() => void submit()} submitLabel={IMPORT_COPY.remove} submitClass={DANGER}>
        <p className="m-0 text-fg-muted">{IMPORT_COPY.removeBody(record.name, counts)}</p>
        <label className="flex items-center gap-2 text-ui-sm text-fg">
          <input
            type="checkbox"
            aria-label={IMPORT_COPY.removeAcknowledge(record.name)}
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className={CHOICE}
          />
          {IMPORT_COPY.removeAcknowledge(record.name)}
        </label>
        {error && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {error}
          </p>
        )}
      </SheetForm>
    </Sheet>
  );
}
