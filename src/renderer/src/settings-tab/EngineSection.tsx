// The Engine section (C11 execution document, Interfaces "Settings tab" Engine; mockup 06 vignette 04): the binary MAWS
// launches and the version it is pinned to (both reach the engine host through `engine.configure`, which main pushes on
// every change; C12: main alone, and this section awaits `settings.engineApplied`), the engine's config home (read-only
// to MAWS), and the subagent model new sessions launch with.
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Settings } from '@shared/ipc/schema';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import { isGatewayModel } from '@shared/sessions/models';
import { DEFAULT_ROW, listName } from '../composer/frame/model-label';
import { GatewaySheet } from '../gateway/GatewaySheet';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { toast } from '../stores/notices';
import { homeAbbreviated } from '../tools/session-info/model';
import { ENGINE } from './copy';
import { Chip, INPUT, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';
import { MemoryBudget, StatefulServers } from './BudgetSettings'; // C12
import { CUSTODY_KEY, CustodySetting } from './CustodySetting'; // C12

const BINARY_INFO_KEY = ['maws', 'engine.binaryInfo', undefined];

export function EngineSection({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const info = useCommand('engine.binaryInfo', undefined);
  const [repinning, setRepinning] = useState<string | null>(null);
  const pin = settings.engine.pinnedVersion;
  const binary = info.data ?? null;

  // C12 start: main is the only sender of `engine.configure` (C12 execution document, Interfaces "Engine custody",
  // Configure). A write is followed by `settings.engineApplied`, which answers once main's push for it has landed (custody
  // for a new pin included, its error custody's or the push's), then the rows re-read what the host now holds.
  const writeEngine = async (patch: Partial<Settings['engine']>) => {
    if (!(await writeSettings({ engine: patch }))) return;
    const applied = await ipc.invoke('settings.engineApplied', undefined);
    if (!applied.ok) toast({ level: 'warning', text: applied.error.message, actions: [], dismissible: true });
    const reread = await ipc.invoke('engine.binaryInfo', undefined);
    if (reread.ok) client.setQueryData<BinaryInfo>(BINARY_INFO_KEY, reread.value);
    void client.invalidateQueries({ queryKey: CUSTODY_KEY });
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

  const mismatch = binary !== null && binary.version !== null && binary.version !== pin;
  return (
    <>
      <Setting label={ENGINE.binary} note={ENGINE.binaryNote}>
        <span className="min-w-0 truncate font-mono text-ui-sm text-fg" title={binary?.path}>
          {binary ? homeAbbreviated(binary.path) : info.isError ? info.error.message : ENGINE.binaryReading}
        </span>
        <button type="button" className={TEXT_ACTION} onClick={() => void change()}>
          {ENGINE.change}
        </button>
        {settings.engine.binaryPath !== null && (
          <button type="button" className={TEXT_ACTION} onClick={() => void writeEngine({ binaryPath: null })}>
            {ENGINE.useDefault}
          </button>
        )}
        {mismatch && <span className="basis-full text-ui-sm text-warning">{ENGINE.binaryMismatch}</span>}
        {binary && !binary.ok && !mismatch && binary.error && <span className="basis-full text-ui-sm text-warning">{binary.error}</span>}
      </Setting>
      <Setting label={ENGINE.pinned} note={ENGINE.pinnedNote}>
        <span>{pin}</span>
        {binary && <Chip>{binary.version === null ? ENGINE.noVersion : mismatch ? ENGINE.reports(binary.version) : ENGINE.matches}</Chip>}
        <button type="button" className={TEXT_ACTION} disabled={!mismatch} onClick={() => setRepinning(binary!.version)}>
          {ENGINE.repin}
        </button>
      </Setting>
      <CustodySetting settings={settings} /> {/* C12 */}
      <ConfigHome />
      <SubagentModel settings={settings} />
      {/* C12 start: the memory budget and the stateful MCP servers (settings v4) */}
      <MemoryBudget settings={settings} />
      <StatefulServers settings={settings} />
      {/* C12 end */}
      {repinning !== null && (
        <GatewaySheet
          title={ENGINE.repinTitle(repinning)}
          onClose={() => setRepinning(null)}
          canSubmit
          onSubmit={() => {
            setRepinning(null);
            void writeEngine({ pinnedVersion: repinning });
          }}
          submitLabel={ENGINE.repinConfirm(repinning)}
          cancelLabel={ENGINE.cancel}
        >
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ENGINE.repinBody(pin, repinning)}</p>
        </GatewaySheet>
      )}
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
