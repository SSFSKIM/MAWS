// The sheet's pick state (E4b Design §2): the profiles Chrome's `Local State` names in the default folder, or in one the
// owner points at ("Choose another Chrome folder…"), the last-used one preselected; a profile already imported shows
// when and cannot be chosen until removed (Decision Log 2). Continue inspects the chosen profile. cua board #90: a
// re-import opens it on the removed record's Chrome folder with that profile chosen (`preselect`).
import { useState } from 'react';
import type { ChromeProfile } from '@shared/browser/import';
import { ipc } from '../../../ipc/client';
import { useCommand } from '../../../ipc/query';
import { SheetForm } from '../../../sessions/Sheet';
import { CHOICE, PRIMARY, QUIET } from '../../../sessions/ui';
import { IMPORT_COPY, importDate } from './copy';
import { inspect, useBrowserImport } from './store';

const firstChoice = (profiles: ChromeProfile[]): string | null =>
  (profiles.find((p) => p.lastUsed && !p.imported) ?? profiles.find((p) => !p.imported))?.profileDir ?? null;

export interface PickerPreselect {
  userDataDir: string;
  profileDir: string;
}

export function ProfilePicker({ preselect }: { preselect?: PickerPreselect }) {
  const [folder, setFolder] = useState<string | null>(preselect?.userDataDir ?? null); // null: Chrome's default folder
  const [chosen, setChosen] = useState<string | null>(preselect?.profileDir ?? null);
  const [chooseError, setChooseError] = useState<string | null>(null);
  const query = useCommand('browser.import.profiles', { userDataDir: folder });
  const answer = query.data;
  const busy = useBrowserImport((s) => s.busy);
  const records = useBrowserImport((s) => s.records);
  const profiles = answer?.found ? answer.profiles : [];
  const selected = chosen !== null && profiles.some((p) => p.profileDir === chosen && !p.imported) ? chosen : firstChoice(profiles);
  const importedOn = (profileDir: string) => {
    const record = records.find((r) => r.profileDir === profileDir && r.userDataDir === answer?.userDataDir);
    return IMPORT_COPY.imported(record ? importDate(record.importedAt) : null);
  };
  const chooseFolder = async () => {
    const result = await ipc.invoke('browser.import.chooseUserData', undefined);
    setChooseError(result.ok ? null : IMPORT_COPY.chooseFailed(result.error.message));
    if (result.ok && result.value.userDataDir !== null) {
      setFolder(result.value.userDataDir);
      setChosen(null);
    }
  };

  return (
    <SheetForm
      canSubmit={answer !== undefined && selected !== null && !busy}
      onSubmit={() => answer && selected && void inspect(answer.userDataDir, selected)}
      submitLabel={IMPORT_COPY.continue}
      submitClass={PRIMARY}
      extra={
        <button type="button" onClick={() => void chooseFolder()} className={`${QUIET} mr-auto`}>
          {IMPORT_COPY.chooseFolder}
        </button>
      }
    >
      {answer === undefined ? (
        query.error ? (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {IMPORT_COPY.profilesFailed(query.error.message)}
          </p>
        ) : (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {IMPORT_COPY.reading}
          </p>
        )
      ) : !answer.found ? (
        <p role="alert" className="m-0 text-ui-sm break-all text-fg-muted">
          {IMPORT_COPY.notFound(answer.userDataDir)}
        </p>
      ) : answer.error !== null ? (
        <p role="alert" title={answer.error} className="m-0 text-ui-sm text-danger">
          {IMPORT_COPY.localStateUnreadable}
        </p>
      ) : profiles.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">{IMPORT_COPY.noProfiles}</p>
      ) : (
        <fieldset className="m-0 flex max-h-[50vh] flex-col gap-1 overflow-y-auto border-0 p-0">
          <legend className="mb-1 p-0 text-ui-sm break-all text-fg-muted">{answer.userDataDir}</legend>
          {profiles.map((profile) => (
            <label key={profile.profileDir} data-chrome-profile={profile.profileDir} className="flex items-center gap-2 rounded-sm px-1 py-1 text-ui has-[:checked]:bg-bg-active">
              <input
                type="radio"
                name="chrome-profile"
                value={profile.profileDir}
                checked={selected === profile.profileDir}
                disabled={profile.imported}
                onChange={() => setChosen(profile.profileDir)}
                className={CHOICE}
              />
              <span className={profile.imported ? 'text-fg-muted' : 'text-fg'}>{profile.name}</span>
              {[profile.gaiaName, profile.userName]
                .filter((part): part is string => part !== null && part !== '' && part !== profile.name)
                .map((part) => (
                  <span key={part} className="truncate text-ui-sm text-fg-muted">
                    {part}
                  </span>
                ))}
              {profile.imported && <span className="ml-auto text-ui-sm whitespace-nowrap text-fg-muted">{importedOn(profile.profileDir)}</span>}
            </label>
          ))}
        </fieldset>
      )}
      {answer?.chromeRunning && <p className="m-0 text-ui-sm text-fg-muted">{IMPORT_COPY.chromeRunning}</p>}
      {chooseError && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {chooseError}
        </p>
      )}
      {busy && (
        <p role="status" className="m-0 text-ui-sm text-fg-muted">
          {IMPORT_COPY.inspecting}
        </p>
      )}
    </SheetForm>
  );
}
