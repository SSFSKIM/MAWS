// `/permissions` (C11 execution document, the widget table; mockup 06 vignette 05, the pattern for every engine-read
// widget): the effective mode from the init frame with a refusal in words (D-18), then every rule of
// `list_permission_rules` grouped allow, ask, deny, each with the engine's own phrasing, the rule in mono and its source
// file, then the workspace directories. The mode segment is C7's mode menu over `session.setPermissionMode`: it selects
// the effective mode the engine answered, whatever was asked, and a refusal never moves it.
// The word cut (P580, P582): the segment's checked row is the effective mode, with no line above it naming it, and the
// mode's scope is the segment's note; a rule's source is one word with its file under the pointer (P586).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import * as z from 'zod';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ListModelsResponse, ListPermissionRulesResponse } from '@shared/wire/control';
import { liveModeBinding, ModeMenu, MODE_OPTIONS, MODE_REFUSAL_WORDS, NOT_RUNNING } from '../statusline';
import { useSessions } from '../stores/sessions';
import { QuietSpinner } from '../ui/spinner';
import { RowNote, useRowNote } from '../ui/row-note';
import { FRAME, PERMISSIONS, TYPED, WIDGET_TITLE } from './copy';
import { Group, Mono, parseEach, Row, Rows, SourceWord, sourceWords } from './parts';
import { engineReadKey, isDormant, useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const DescriptionSchema = z.looseObject({ prefix: z.string(), emphasis: z.string().optional() });
const BEHAVIORS = ['allow', 'ask', 'deny'] as const;
// A workspace directory is a path, or an object carrying one (the wire leaves the entry's shape open).
const WorkspaceDirectorySchema = z.union([z.string(), z.looseObject({ path: z.string() }).transform((d) => d.path)]);
const directories = (raw: readonly unknown[]) => parseEach(WorkspaceDirectorySchema, raw);

export interface RuleView {
  rule: string;
  source: string; // the source in one word, or verbatim when unknown
  file: string | null; // the settings file the source names, where the renderer can name it
  editability: string | null;
  description: { prefix: string; emphasis: string | null } | null;
}

export interface PermissionsView {
  mode: { effective: PermissionMode; refusal: string | null } | null; // null before any status
  groups: { behavior: (typeof BEHAVIORS)[number]; label: string; rules: RuleView[] }[];
  workspace: { path: string; note: string | null }[]; // the first, the session's own folder, without a note
  managedOnly: boolean;
  grants: number; // the session's grant snapshot, re-applied after a resume (C3's status)
}

// The effective mode from the init frame, with the refusal in words (D-18).
const modeOf = (status: Pick<EngineSessionStatus, 'permissionMode'>): NonNullable<PermissionsView['mode']> => ({
  effective: status.permissionMode.effective,
  refusal: status.permissionMode.refusal === null ? null : MODE_REFUSAL_WORDS[status.permissionMode.refusal],
});

export function present(state: ListPermissionRulesResponse['state'], status: Pick<EngineSessionStatus, 'permissionMode' | 'grants'> | null): PermissionsView {
  const ruleView = (r: ListPermissionRulesResponse['state']['rules'][number]): RuleView => {
    const description = DescriptionSchema.safeParse(r.description);
    const { word, file } = sourceWords(r.source);
    return {
      rule: r.rule,
      source: word,
      file,
      editability: r.editability ?? null,
      description: description.success ? { prefix: description.data.prefix, emphasis: description.data.emphasis ?? null } : null,
    };
  };
  const added = directories(state.workspaceDirectories).filter((d) => d !== state.originalCwd);
  return {
    mode: status && modeOf(status),
    groups: BEHAVIORS.map((behavior) => ({ behavior, label: PERMISSIONS.group[behavior], rules: state.rules.filter((r) => r.behavior === behavior).map(ruleView) })),
    workspace: [{ path: state.originalCwd, note: null }, ...added.map((path) => ({ path, note: PERMISSIONS.added }))],
    managedOnly: state.managedOnly,
    grants: status?.grants.length ?? 0,
  };
}

// The session's grants and the mode segment, which words a refusal itself; the scope of the mode is the segment's note.
export function ModeHeader({ grants, segment }: { grants: number; segment: ReactNode }) {
  const note = useRowNote();
  return (
    <div className="mb-2">
      {grants > 0 && <p className="m-0 text-ui-sm text-fg-muted">{PERMISSIONS.grants(grants)}</p>}
      <div role="group" aria-label={PERMISSIONS.mode} {...note.rowProps} className="relative mt-1">
        {segment}
        <RowNote note={note}>{PERMISSIONS.modeScope}</RowNote>
      </div>
    </div>
  );
}

export function PermissionsBody({ view }: { view: PermissionsView }) {
  const none = view.groups.every((g) => g.rules.length === 0);
  return (
    <div className="flex flex-col">
      {none && <p className="m-0 text-ui-sm text-fg-muted">{PERMISSIONS.none}</p>}
      {view.groups
        .filter((g) => g.rules.length > 0)
        .map((g) => (
          <Group key={g.behavior} label={g.label} count={g.rules.length}>
            <Rows label={PERMISSIONS.rules(g.label)}>
              {g.rules.map((r, i) => (
                <Row
                  key={`${r.rule}:${i}`}
                  main={<Mono>{r.rule}</Mono>}
                  note={<SourceWord word={r.source} file={r.file} className={r.editability === 'session' ? 'text-info' : undefined} />}
                  detail={
                    r.description || (r.editability && PERMISSIONS.editability[r.editability] !== undefined) ? (
                      <>
                        {r.description && (
                          <>
                            {r.description.prefix}
                            {r.description.emphasis && <strong className="font-semibold text-fg">{r.description.emphasis}</strong>}
                          </>
                        )}
                        {r.editability && PERMISSIONS.editability[r.editability] !== undefined && (
                          <span className="text-fg-faint">
                            {r.description ? ' · ' : ''}
                            {PERMISSIONS.editability[r.editability]}
                          </span>
                        )}
                      </>
                    ) : null
                  }
                />
              ))}
            </Rows>
          </Group>
        ))}
      <Group label={PERMISSIONS.workspace}>
        <Rows label={PERMISSIONS.workspaceList}>
          {view.workspace.map((w) => (
            <Row key={w.path} main={<Mono>{w.path}</Mono>} note={w.note} />
          ))}
        </Rows>
        {view.managedOnly && <p className="m-0 mt-1 text-ui-sm text-fg-muted">{PERMISSIONS.managedOnly}</p>}
      </Group>
    </div>
  );
}

// C7's live binding for a session (the chip's and the status line's, so all three read the same effective mode, word
// refusals and a rejected invoke alike, and set through the same `session.setPermissionMode`).
const bindingOf = (appSessionId: AppSessionId, record: SessionRecord | null, status: EngineSessionStatus, models: ListModelsResponse['models'] | null) =>
  liveModeBinding(record ?? { appId: appSessionId, permissionMode: status.permissionMode, model: status.model }, status, models);

// The harness's `control('setPermissionMode', …)`: C7's binding's own `set`, over the session as the stores hold it.
export function setPermissionMode(input: { appSessionId: AppSessionId; mode: PermissionMode }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { records, engine } = useSessions.getState();
  const status = engine.get(input.appSessionId);
  if (!status) return Promise.resolve({ ok: false, error: NOT_RUNNING });
  return bindingOf(input.appSessionId, records.get(input.appSessionId) ?? null, status, null).set(input.mode);
}

// C7's mode menu over that binding; the models it checks auto against come through the widget's own read, which a
// passive harness does not issue (C7's useLiveModeBinding reads them whenever the process is ready).
function ModeSegment({ appSessionId, status }: { appSessionId: AppSessionId; status: EngineSessionStatus }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const models = useEngineRead('session.listModels', { appSessionId });
  const binding = useMemo(() => bindingOf(appSessionId, record, status, models.data?.models ?? null), [record, appSessionId, status, models.data]);
  return <ModeMenu binding={binding} />;
}

// The mode is C3's status and needs no read, so the segment shows while the rules read is loading, has failed, or (a
// passive harness over a journal that never recorded `list_permission_rules`) never runs.
// A typed argument the widget did not apply (it asks first, or names no mode), said above the segment.
const argumentLine = (args: string): string | null => {
  const arg = args.trim();
  if (arg === '') return null;
  const option = MODE_OPTIONS.find((o) => o.mode.toLowerCase() === arg.toLowerCase());
  if (!option) return TYPED.modeUnknown(arg);
  return option.confirm ? TYPED.modeAsks(option.mode) : null;
};

export function PermissionsWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.listPermissionRules', { appSessionId });
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const argument = argumentLine(args);
  // A rules read cached before an approval card's session grant can still be fresh when the widget opens (live, M6):
  // when the status counts more grants than the list shows, the list is read again, once per count.
  const grants = status?.grants.length ?? 0;
  const listedGrants = read.data ? read.data.state.rules.filter((rule) => rule.source === 'session').length : null;
  const client = useQueryClient();
  useEffect(() => {
    if (listedGrants !== null && grants > listedGrants) void client.invalidateQueries({ queryKey: engineReadKey('session.listPermissionRules', { appSessionId }) });
  }, [client, appSessionId, grants, listedGrants]);
  return (
    <WidgetFrame
      appSessionId={appSessionId}
      title={WIDGET_TITLE.permissions}
      command="permissions"
      state={isDormant(read.state) || !status ? read.state : 'ready'}
      error={read.data || isDormant(read.state) ? read.error : null}
      close={close}
    >
      {argument && (
        <p role="status" className="m-0 mb-1 text-ui-sm text-fg-muted">
          {argument}
        </p>
      )}
      {status && <ModeHeader grants={status.grants.length} segment={<ModeSegment appSessionId={appSessionId} status={status} />} />}
      {read.data ? (
        <PermissionsBody view={present(read.data.state, status)} />
      ) : read.state === 'error' ? (
        <p className="m-0 text-ui-sm text-danger">{read.error}</p>
      ) : (
        <QuietSpinner label={FRAME.reading} />
      )}
    </WidgetFrame>
  );
}
