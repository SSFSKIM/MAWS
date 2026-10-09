// cua board #90: the profile popover's Re-import this profile… at app level (the spec's "The avatar and the profile
// popover"): mounted once from App.tsx, so neither the popover closing nor the removal closing the profile's tabs (the
// popover's own included) cuts the flow. The removal's confirm sheet, then the import sheet at the picker on the
// removed profile's Chrome folder with it chosen; either sheet's close ends the flow.
import { ImportSheet } from './ImportSheet';
import { RemoveSheet } from './RemoveSheet';
import { endReimport, reimportRemoved, useBrowserImport } from './store';

export function ProfileSheets() {
  const reimport = useBrowserImport((s) => s.reimport);
  if (!reimport) return null;
  const { record } = reimport;
  return reimport.step === 'remove' ? (
    <RemoveSheet record={record} onClose={endReimport} onRemoved={() => reimportRemoved()} />
  ) : (
    <ImportSheet preselect={{ userDataDir: record.userDataDir, profileDir: record.profileDir }} onClose={endReimport} />
  );
}
