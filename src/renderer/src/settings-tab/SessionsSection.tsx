// U11a M9 (l8-settings-06): Settings › Sessions, everything that shapes a session MAWS runs, out of Engine: the launch
// profile (P4-A2: its plugins and hooks, settings version 17), MAWS's own MCP servers (P4-R8: settings version 16), the
// subagent model new sessions launch with, (W3) the mode a session takes when the engine refuses auto, and the archive
// rule, the old one-row Sessions section. The line under its heading says once that terminal sessions and the person's
// Claude Code settings files are not changed.
import { useId } from 'react';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { PERMISSION_MODES } from '@shared/graph/enums';
import type { Settings } from '@shared/ipc/schema';
import type { AutoFallback } from '@shared/ipc/schema/settings';
import { isGatewayModel } from '@shared/sessions/models';
import { DEFAULT_ROW, listName } from '@shared/sessions/model-label';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { SESSIONS } from './copy';
import { LaunchProfileSettings } from './LaunchProfileSettings'; // P4-A2
import { McpServers } from './McpServersSettings'; // P4-R8
import { INPUT, Setting, useCommittedDraft, writeSettings } from './parts';

export function SessionsSection({ settings }: { settings: Settings }) {
  return (
    <>
      <LaunchProfileSettings settings={settings} />
      <McpServers settings={settings} />
      <SubagentModel settings={settings} />
      <AutoFallback settings={settings} />
      <ArchiveInactive settings={settings} />
    </>
  );
}

// W3: the mode MAWS sets when the engine refuses auto for a session (settings version 6), any engine mode but auto.
const FALLBACKS = PERMISSION_MODES.filter((mode): mode is AutoFallback => mode !== 'auto');
function AutoFallback({ settings }: { settings: Settings }) {
  return (
    <Setting row="sessions.autoFallback">
      <select
        aria-label={SESSIONS.autoFallback}
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
  const models = useCommand('engine.models', { refresh: false, gateway: settings.gateway.defaultRoute }, { staleTime: 60_000 }, { machine: ipc.localMachine }); // P5 O6 M4: this machine's engine
  const suggestions = (models.data?.models ?? []).filter((m) => !isGatewayModel(m.value));
  return (
    <Setting row="sessions.subagent">
      <input
        role="combobox"
        aria-label={SESSIONS.subagent}
        list={list}
        placeholder={SESSIONS.subagentPlaceholder}
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

function ArchiveInactive({ settings }: { settings: Settings }) {
  return (
    <Setting row="sessions.archive">
      <select
        aria-label={SESSIONS.archive}
        value={settings.sessions.archiveInactiveDays ?? 'never'}
        className={`${INPUT} max-w-[180px]`}
        onChange={(event) => void writeSettings({ sessions: { archiveInactiveDays: event.target.value === 'never' ? null : (Number(event.target.value) as 7 | 14 | 30) } })}
      >
        <option value="never">Never</option>
        <option value="7">7 days</option>
        <option value="14">14 days</option>
        <option value="30">30 days</option>
      </select>
    </Setting>
  );
}
