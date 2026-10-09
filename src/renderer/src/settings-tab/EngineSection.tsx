// The Engine section (C11 execution document, Interfaces "Settings tab" Engine; mockup 06 vignette 04): the binary MAWS
// launches (W13: the installed Claude Code unless one is chosen, shown by its real path and probed version, with the
// version MAWS was verified against as information and the user's own `claude update` one click away; a chosen
// path reaches the engine host through `engine.configure`, which main alone pushes, and this section awaits
// `settings.engineApplied`), the engine's config home (read-only to MAWS), the subagent model new sessions launch with,
// and (W3) the mode a session takes when the engine refuses auto. W7: the memory budget's switch, whose rows show only
// while it is on. R1: one information line on what MAWS shows of a plugin. E10: the Background supervisor group last.
import { useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { PERMISSION_MODES } from '@shared/graph/enums';
import type { Settings } from '@shared/ipc/schema';
import type { AutoFallback } from '@shared/ipc/schema/settings';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import { isGatewayModel } from '@shared/sessions/models';
import { DEFAULT_ROW, listName } from '@shared/sessions/model-label';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { toast } from '../stores/notices';
import { homeAbbreviated } from '../tools/session-info/model';
import { ENGINE } from './copy';
import { openEngineUpdate } from './engine-update'; // W13
import { Chip, INPUT, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';
import { BudgetSwitch, MemoryBudget, StatefulServers } from './BudgetSettings'; // C12; W7: the switch
import { SupervisorSettings } from './SupervisorSettings'; // E10

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

  return (
    <>
      <Setting
        label={ENGINE.binary}
        note={
          <>
            {chosen ? ENGINE.binaryChosenNote : ENGINE.binaryNote}
            {binary && <span className="block">{ENGINE.tested(binary.testedVersion)}</span>}
          </>
        }
      >
        <span className="min-w-0 truncate font-mono text-ui-sm text-fg" title={binary?.path}>
          {binary ? homeAbbreviated(binary.path) : info.isError ? info.error.message : ENGINE.binaryReading}
        </span>
        {binary?.version && <Chip>{binary.version}</Chip>}
        <button type="button" className={TEXT_ACTION} onClick={() => void change()}>
          {ENGINE.change}
        </button>
        {chosen && (
          <button type="button" className={TEXT_ACTION} onClick={() => void writeEngine({ binaryPath: null })}>
            {ENGINE.useInstalled}
          </button>
        )}
        {binary && !binary.ok && binary.error && <span className="basis-full text-ui-sm text-warning">{binary.error}</span>}
      </Setting>
      {/* W13: the user's own updater, in a terminal tab; MAWS's launches never update themselves */}
      <Setting label={ENGINE.update} note={chosen ? ENGINE.updateChosenNote : ENGINE.updateNote}>
        <button type="button" className={TEXT_ACTION} onClick={() => openEngineUpdate()}>
          {ENGINE.updateAction}
        </button>
      </Setting>
      <ConfigHome />
      <Setting label={ENGINE.plugins}>
        <span className="text-ui-sm text-fg-muted">{ENGINE.pluginsNote}</span>
      </Setting>
      <SubagentModel settings={settings} />
      <AutoFallback settings={settings} /> {/* W3 */}
      {/* C12 start: the memory budget and the stateful MCP servers (settings v4); W7: behind its switch (settings v7) */}
      <BudgetSwitch settings={settings} />
      {settings.engine.memoryBudget.enabled && (
        <>
          <MemoryBudget settings={settings} />
          <StatefulServers settings={settings} />
        </>
      )}
      {/* C12 end */}
      <SupervisorSettings settings={settings} /> {/* E10: settings version 10 */}
    </>
  );
}

// The engine's config home as the engine host resolves it (CLAUDE_CONFIG_DIR from the environment main gave it, else
// ~/.claude; C4's fs.state reports it).
function ConfigHome() {
  const state = useCommand('fs.state', undefined, { staleTime: Infinity });
  return (
    <Setting label={ENGINE.configHome} note={ENGINE.configHomeNote}>
      <span className="min-w-0 truncate font-mono text-ui-sm text-fg">{state.data ? homeAbbreviated(state.data.configHome) : state.isError ? state.error.message : '…'}</span>
      <Chip>{ENGINE.readOnly}</Chip>
    </Setting>
  );
}

// W3: the mode MAWS sets when the engine refuses auto for a session (settings version 6), any engine mode but auto.
const FALLBACKS = PERMISSION_MODES.filter((mode): mode is AutoFallback => mode !== 'auto');
function AutoFallback({ settings }: { settings: Settings }) {
  return (
    <Setting label={ENGINE.autoFallback} note={ENGINE.autoFallbackNote}>
      <select
        aria-label={ENGINE.autoFallback}
        value={settings.permissions.autoFallback}
        onChange={(e) => void writeSettings({ permissions: { autoFallback: e.target.value as AutoFallback } })}
        className={`${INPUT} max-w-[200px]`}
      >
        {FALLBACKS.map((mode) => (
          <option key={mode} value={mode}>
            {PERMISSION_MODE_LABELS[mode]}
          </option>
        ))}
      </select>
    </Setting>
  );
}

// A text field, since CLAUDE_CODE_SUBAGENT_MODEL takes any model name the engine resolves; the suggestions are the
// Claude values of the catalogue new sessions launch against (the default route's).
function SubagentModel({ settings }: { settings: Settings }) {
  const list = useId();
  const saved = settings.engine.subagentModel;
  const [, field] = useCommittedDraft(saved, (next) => writeSettings({ engine: { subagentModel: next } }));
  const models = useCommand('engine.models', { refresh: false, gateway: settings.gateway.defaultRoute }, { staleTime: 60_000 });
  const suggestions = (models.data?.models ?? []).filter((m) => !isGatewayModel(m.value));
  return (
    <Setting label={ENGINE.subagent} note={ENGINE.subagentNote}>
      <input
        role="combobox"
        aria-label={ENGINE.subagent}
        list={list}
        placeholder={ENGINE.subagentPlaceholder}
        {...field}
        className={`${INPUT} max-w-[260px] font-mono`}
      />
      <datalist id={list}>
        {suggestions.map((m) => (
          <option key={m.value} value={m.value}>
            {m.value === DEFAULT_ROW ? `${listName(m, suggestions)} · Default` : m.displayName}
          </option>
        ))}
      </datalist>
    </Setting>
  );
}
