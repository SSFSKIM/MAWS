// `/config` (C11 execution document, the widget table): `get_settings` as the engine merged it: the effective settings,
// the sources that contributed (each with the keys it set, and Reveal showing a settings file in Finder through
// `settings.reveal`), what the session applied (advisor, ultracode) and any errors. The terminal's `/config` writes
// settings; the widget shows them (D-12). "MAWS settings" opens MAWS's own Settings tab. The word cut (P606 to P609,
// P586): "Defaults only", no line under a source that sets nothing, Reveal, a source in the permission rules' one word,
// and Applied without Model and Effort, which the model chip carries.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetSettingsResponse } from '@shared/wire/control';
import { runAction } from '../keymap/actions-runtime';
import { useSessions } from '../stores/sessions';
import { CONFIG, SHARED, WIDGET_TITLE } from './copy';
import { Group, KeyValues, Mono, parseEach, RevealButton, Row, Rows, SourceWord, sourceWords, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';

const SourceSchema = z.looseObject({ source: z.string(), settings: z.record(z.string(), z.unknown()).catch({}) });
const AppliedSchema = z.looseObject({ advisor: z.unknown().optional(), ultracode: z.boolean().optional() });
const ErrorSchema = z.union([z.string(), z.looseObject({ message: z.string() }).transform((e) => e.message)]);

export interface ConfigView {
  effective: { key: string; value: string }[];
  sources: { source: string; label: string; keys: string[] }[];
  applied: { label: string; value: string }[];
  errors: string[];
}

const shown = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? SHARED.none : JSON.stringify(value));

export function present(answer: GetSettingsResponse): ConfigView {
  const applied = AppliedSchema.safeParse(answer.applied ?? null);
  return {
    effective: Object.entries(answer.effective).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
    sources: parseEach(SourceSchema, answer.sources).map((s) => ({ source: s.source, label: sourceWords(s.source).word, keys: Object.keys(s.settings) })),
    applied: applied.success
      ? [
          { label: CONFIG.advisor, value: shown(applied.data.advisor) },
          { label: CONFIG.ultracode, value: applied.data.ultracode ? SHARED.on : SHARED.off },
        ]
      : [],
    errors: parseEach(ErrorSchema, answer.errors ?? []),
  };
}

// The file a source lives in, where the renderer can name it: the project's two files under the session's directory,
// the user's under the engine's config home (the directory of the user memory file the engine itself names).
export function sourceFile(source: string, cwd: string | null, configHome: string | null): string | null {
  if (source === 'projectSettings' && cwd) return `${cwd}/.claude/settings.json`;
  if (source === 'localSettings' && cwd) return `${cwd}/.claude/settings.local.json`;
  if (source === 'userSettings' && configHome) return `${configHome}/settings.json`;
  return null;
}

export function ConfigBody({ view, machine, cwd, configHome, close }: { view: ConfigView; machine: MachineRef; cwd: string | null; configHome: string | null; close(): void }) {
  return (
    <div className="flex flex-col">
      <Group label={CONFIG.effective}>
        {view.effective.length === 0 ? (
          <p className="m-0 text-ui-sm text-fg-muted">{CONFIG.noEffective}</p>
        ) : (
          <KeyValues rows={view.effective.map((e) => ({ label: e.key, value: <Mono>{e.value}</Mono> }))} label={CONFIG.effectiveList} />
        )}
      </Group>
      {view.sources.length > 0 && (
        <Group label={CONFIG.sources} count={view.sources.length}>
          <Rows label={CONFIG.sourceList}>
            {view.sources.map((s) => {
              const file = sourceFile(s.source, cwd, configHome);
              return <Row key={s.source} main={<SourceWord word={s.label} file={sourceWords(s.source).file} />} detail={s.keys.length > 0 ? s.keys.join(', ') : null} actions={file ? <RevealButton path={file} machine={machine}>{SHARED.reveal}</RevealButton> : null} />;
            })}
          </Rows>
        </Group>
      )}
      {view.applied.length > 0 && (
        <Group label={CONFIG.applied}>
          <KeyValues rows={view.applied} label={CONFIG.appliedList} />
        </Group>
      )}
      {view.errors.length > 0 && (
        <Group label={CONFIG.errors} count={view.errors.length}>
          <Rows>
            {view.errors.map((e, i) => (
              <Row key={i} main={<span className="text-danger">{e}</span>} />
            ))}
          </Rows>
        </Group>
      )}
      <div className="mt-2">
        <TextButton
          onClick={() => {
            close();
            runAction('settings.open');
          }}
        >
          {CONFIG.mawsSettings}
        </TextButton>
      </div>
    </div>
  );
}

const dirname = (path: string) => path.slice(0, path.lastIndexOf('/'));

export function ConfigWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getSettings', { appSessionId });
  const memory = useEngineRead('session.getMemoryDialog', { appSessionId });
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null);
  const userFile = memory.data?.files.find((f) => f.kind === 'user')?.path;
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.config} command="config" state={read.state} error={read.error} readAt={read.readAt} close={close}>
      {read.data && <ConfigBody view={present(read.data)} machine={machineOf(appSessionId)} cwd={cwd} configHome={userFile ? dirname(userFile) : null} close={close} />}
    </WidgetFrame>
  );
}
