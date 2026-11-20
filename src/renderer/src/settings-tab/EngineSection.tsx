// The Engine section (C11 execution document, Interfaces "Settings tab" Engine; mockup 06 vignette 04): the binary MAWS
// launches (W13: the installed Claude Code unless one is chosen, shown by its real path and probed version, with the
// version MAWS was verified against as information and the user's own `claude update` one click away; a chosen
// path reaches the engine host through `engine.configure`, which main alone pushes, and this section awaits
// `settings.engineApplied`), and the engine's config home (read-only to MAWS). U11a M9 (l8-settings-06): Engine keeps what
// is about the Claude Code binary itself; what shapes a session MAWS runs went to Sessions, the supervisor and the memory
// budget to Supervisor, and R1's paragraph row on what MAWS shows of a plugin is gone (out of date: plugins' panes are drawn).
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1; G125 to G128): one row, the version, Change…
// and Update…; the binary's path is the version's tooltip and, with the config home, in the row's note; Update… is named
// in full and says what it does as its tooltip, drawn as the `engine.update` row so the search lands on it.
import { useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@shared/ipc/schema';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { toast } from '../stores/notices';
import { homeAbbreviated } from '../tools/session-info/model';
import { ENGINE } from './copy';
import { useDrawnRow } from './drawn';
import { openEngineUpdate } from './engine-update'; // W13
import { Chip, Setting, TEXT_ACTION, TipWord, WORD_OWNER, writeSettings } from './parts';
import { settingsRow } from './rows';
import { Tip } from '../ui/tip';

const BINARY_INFO_KEY = ['maws', 'engine.binaryInfo', undefined];
// W13: the host resolves the binary per call, so the row follows an update made in a terminal while it is shown
export const BINARY_REFRESH_MS = 10_000;

export function EngineSection({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const info = useCommand('engine.binaryInfo', undefined, { refetchInterval: BINARY_REFRESH_MS });
  const chosen = settings.engine.binaryPath !== null;
  const binary = info.data ?? null;

  // C12 start: main is the only sender of `engine.configure` (C12 execution document, Interfaces "Engine custody",
  // Configure). A write is followed by `settings.engineApplied`, which answers once main's push for it has landed (its
  // error the push's), then the rows re-read what the host now holds.
  const writeEngine = async (patch: Partial<Settings['engine']>) => {
    if (!(await writeSettings({ engine: patch }))) return;
    const applied = await ipc.invoke('settings.engineApplied', undefined);
    if (!applied.ok) toast({ level: 'warning', text: applied.error.message, actions: [], dismissible: true });
    const reread = await ipc.invoke('engine.binaryInfo', undefined);
    if (reread.ok) client.setQueryData<BinaryInfo>(BINARY_INFO_KEY, reread.value);
  };
  // C12 end
  const change = async () => {
    const picked = await ipc.invoke('layout.pickFiles', { kind: 'files', directory: null, multiple: false });
    if (!picked.ok) {
      toast({ level: 'warning', text: picked.error.message, actions: [], dismissible: true });
      return;
    }
    const path = picked.value.files[0]?.path;
    if (path) await writeEngine({ binaryPath: path });
  };

  const path = binary ? homeAbbreviated(binary.path) : null;
  return (
    <Setting
      row="engine.binary"
      state={chosen ? 'chosen' : 'installed'}
      values={{ version: binary?.testedVersion ?? null }}
      noteEnd={
        <>
          {path !== null && <p className="m-0 font-mono text-fg">{path}</p>}
          <ConfigHome />
        </>
      }
    >
      {binary === null && <span className="min-w-0 truncate text-ui-sm text-fg-muted">{info.isError ? info.error.message : ENGINE.binaryReading}</span>}
      {binary?.version && (
        <TipWord tip={path}>
          <span tabIndex={0} className={WORD_OWNER}>
            <Chip>{binary.version}</Chip>
          </span>
        </TipWord>
      )}
      <button type="button" className={TEXT_ACTION} onClick={() => void change()}>
        {ENGINE.change}
      </button>
      <UpdateButton state={chosen ? 'chosen' : 'installed'} />
      {chosen && (
        <button type="button" className={TEXT_ACTION} onClick={() => void writeEngine({ binaryPath: null })}>
          {ENGINE.useInstalled}
        </button>
      )}
      {binary && !binary.ok && binary.error && <span className="basis-full text-ui-sm text-warning">{binary.error}</span>}
    </Setting>
  );
}

// W13: the user's own updater, in a terminal tab; MAWS's launches never update themselves. The word cut: a button on the
// Binary row, drawn as the `engine.update` row (the search's result for it lands here, and the focus shows its words).
function UpdateButton({ state }: { state: 'installed' | 'chosen' }) {
  useDrawnRow('engine.update', state);
  const words = settingsRow('engine.update').states[state]!.note!;
  return (
    <Tip content={words} description={words}>
      <button type="button" aria-label={ENGINE.updateName} data-settings-row="engine.update" data-settings-state={state} className={TEXT_ACTION} onClick={() => openEngineUpdate()}>
        {ENGINE.updateAction}
      </button>
    </Tip>
  );
}

// The engine's config home as the engine host resolves it (CLAUDE_CONFIG_DIR from the environment main gave it, else
// ~/.claude; C4's fs.state reports it), in the Binary row's note.
function ConfigHome() {
  const state = useCommand('fs.state', undefined, { staleTime: Infinity });
  return (
    <>
      <p className="m-0">
        {ENGINE.configHome} · <span className="font-mono text-fg">{state.data ? homeAbbreviated(state.data.configHome) : state.isError ? state.error.message : '…'}</span> · {ENGINE.readOnly}
      </p>
      <p className="m-0">{ENGINE.configHomeNote}</p>
    </>
  );
}
