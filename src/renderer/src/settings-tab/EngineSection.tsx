// The Engine section (C11 execution document, Interfaces "Settings tab" Engine; mockup 06 vignette 04): the binary MAWS
// launches and the version it is pinned to (both reach the engine host through `engine.configure`, which main also
// pushes on every change), the engine's config home (read-only to MAWS), and the subagent model new sessions launch
// with.
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Settings } from '@shared/ipc/schema';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import { isGatewayModel } from '@shared/sessions/models';
import { GatewaySheet } from '../gateway/GatewaySheet';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { toast } from '../stores/notices';
import { homeAbbreviated } from '../tools/session-info/model';
import { ENGINE } from './copy';
import { Chip, INPUT, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';
import { MemoryBudget, StatefulServers } from './BudgetSettings'; // C12

const BINARY_INFO_KEY = ['maws', 'engine.binaryInfo', undefined];

export function EngineSection({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const info = useCommand('engine.binaryInfo', undefined);
  const [repinning, setRepinning] = useState<string | null>(null);
  const pin = settings.engine.pinnedVersion;
  const binary = info.data ?? null;

  // The host answers `engine.binaryInfo`'s shape for the configuration it now holds; that answer is what the rows show.
  const configure = async (engine: Settings['engine']) => {
    const result = await ipc.invoke('engine.configure', { binaryPath: engine.binaryPath, expectedVersion: engine.pinnedVersion });
    if (result.ok) client.setQueryData<BinaryInfo>(BINARY_INFO_KEY, result.value);
    else toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true });
  };
  const writeEngine = async (patch: Partial<Settings['engine']>) => {
    if (await writeSettings({ engine: patch })) await configure({ ...settings.engine, ...patch });
  };
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
            {m.displayName}
          </option>
        ))}
      </datalist>
    </Setting>
  );
}
