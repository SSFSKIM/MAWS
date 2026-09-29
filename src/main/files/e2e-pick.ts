// The e2e seam for `layout.pickFiles` (C10 M6 fix; the architect's ruling that no test or acceptance driver may raise a
// native panel on the owner's desktop): under `MAWS_E2E=1` the injected open dialog never opens the native panel. It
// answers the paths `MAWS_E2E_PICK_PATHS` lists (separated as PATH is, read at each pick so a driver can set the next
// answer through the main process's environment), or answers as cancelled when the variable is unset or empty. Gated
// as the Trash seam is (`src/main/sessions/e2e-trash.ts`): outside MAWS_E2E the native dialog is returned untouched. A
// listed path is checked as the native panel would guarantee it (absolute, present, a directory exactly when the pick
// asks for one, one path unless the pick allows several), so a misconfigured run fails loudly instead of passing on
// an answer no panel could give.
import { stat } from 'node:fs/promises';
import { delimiter, isAbsolute } from 'node:path';
import type { OpenDialog } from './pick';

export function openDialogFor(env: NodeJS.ProcessEnv, showOpenDialog: OpenDialog): OpenDialog {
  if (env.MAWS_E2E !== '1') return showOpenDialog;
  return async (options) => {
    const filePaths = (env.MAWS_E2E_PICK_PATHS ?? '').split(delimiter).filter(Boolean);
    if (filePaths.length === 0) return { canceled: true, filePaths: [] };
    const properties = options.properties ?? [];
    const wantsDirectory = properties.includes('openDirectory');
    if (filePaths.length > 1 && !properties.includes('multiSelections')) throw new Error(`MAWS_E2E_PICK_PATHS: ${filePaths.length} paths for a single pick`);
    for (const path of filePaths) {
      if (!isAbsolute(path)) throw new Error(`MAWS_E2E_PICK_PATHS: not an absolute path: ${path}`);
      const found = await stat(path).catch(() => null);
      if (found === null) throw new Error(`MAWS_E2E_PICK_PATHS: no such path: ${path}`);
      if (wantsDirectory && !found.isDirectory()) throw new Error(`MAWS_E2E_PICK_PATHS: not a directory: ${path}`);
      if (!wantsDirectory && found.isDirectory()) throw new Error(`MAWS_E2E_PICK_PATHS: a directory where the pick asks for a file: ${path}`);
    }
    return { canceled: false, filePaths };
  };
}
