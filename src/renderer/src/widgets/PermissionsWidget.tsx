// `/permissions` (C11 execution document, the widget table; mockup 06 vignette 05, the pattern for every engine-read
// widget): the effective mode from the init frame with a refusal in words (D-18), then every rule of
// `list_permission_rules` grouped allow, ask, deny, each with the engine's own phrasing, the rule in mono and its source
// file, then the workspace directories. The mode segment is C7's mode menu over `session.setPermissionMode`: it selects
// the effective mode the engine answered, whatever was asked, and a refusal never moves it.
import { useMemo, type ReactNode } from 'react';
import * as z from 'zod';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import type { ListPermissionRulesResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';
import { liveModeBinding, ModeMenu, MODE_REFUSAL_WORDS } from '../statusline';
import { useSessions } from '../stores/sessions';
import { PERMISSIONS, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Group, Mono, parseEach, Row, Rows } from './parts';
import { transportWords, useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const DescriptionSchema = z.looseObject({ prefix: z.string(), emphasis: z.string().optional() });
const BEHAVIORS = ['allow', 'ask', 'deny'] as const;
// A workspace directory is a path, or an object carrying one (the wire leaves the entry's shape open).
const WorkspaceDirectorySchema = z.union([z.string(), z.looseObject({ path: z.string() }).transform((d) => d.path)]);
const directories = (raw: readonly unknown[]) => parseEach(WorkspaceDirectorySchema, raw);

export interface RuleView {
  rule: string;
  source: string; // the source in words, or verbatim when unknown
  editability: string | null;
  description: { prefix: string; emphasis: string | null } | null;
}

export interface PermissionsView {
  mode: { effective: string; refusal: string | null } | null; // null before any status
  groups: { behavior: (typeof BEHAVIORS)[number]; label: string; rules: RuleView[] }[];
  workspace: { path: string; note: string }[];
  managedOnly: boolean;
  grants: number; // the session's grant snapshot, re-applied after a resume (C3's status)
}

export function present(state: ListPermissionRulesResponse['state'], status: Pick<EngineSessionStatus, 'permissionMode' | 'grants'> | null): PermissionsView {
  const ruleView = (r: ListPermissionRulesResponse['state']['rules'][number]): RuleView => {
    const description = DescriptionSchema.safeParse(r.description);
    return {
      rule: r.rule,
      source: PERMISSIONS.source[r.source] ?? r.source,
      editability: r.editability ?? null,
      description: description.success ? { prefix: description.data.prefix, emphasis: description.data.emphasis ?? null } : null,
    };
  };
  const added = directories(state.workspaceDirectories).filter((d) => d !== state.originalCwd);
  return {
    mode: status && { effective: status.permissionMode.effective, refusal: status.permissionMode.refusal === null ? null : MODE_REFUSAL_WORDS[status.permissionMode.refusal] },
    groups: BEHAVIORS.map((behavior) => ({ behavior, label: PERMISSIONS.group[behavior], rules: state.rules.filter((r) => r.behavior === behavior).map(ruleView) })),
    workspace: [{ path: state.originalCwd, note: PERMISSIONS.original }, ...added.map((path) => ({ path, note: PERMISSIONS.added }))],
    managedOnly: state.managedOnly,
    grants: status?.grants.length ?? 0,
  };
}

export function PermissionsBody({ view, mode }: { view: PermissionsView; mode?: ReactNode }) {
  const none = view.groups.every((g) => g.rules.length === 0);
  return (
    <div className="flex flex-col">
      {view.mode && (
        <div className="mb-2">
          <p className="m-0">
            {PERMISSIONS.effective} <strong className="font-semibold">{view.mode.effective}</strong> <span className="text-ui-sm text-fg-muted">· {PERMISSIONS.fromInit}</span>
          </p>
          {/* the mode menu words a refusal itself */}
          {!mode && view.mode.refusal && <p className="m-0 mt-1 border-l-2 border-warning pl-2 text-ui-sm">{view.mode.refusal}</p>}
          {view.grants > 0 && <p className="m-0 mt-1 text-ui-sm text-fg-muted">{PERMISSIONS.grants(view.grants)}</p>}
          {mode && <div className="mt-1">{mode}</div>}
        </div>
      )}
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
                  note={<span className={r.editability === 'session' ? 'text-info' : undefined}>{r.source}</span>}
                  detail={
                    r.description || r.editability ? (
                      <>
                        {r.description && (
                          <>
                            {r.description.prefix}
                            {r.description.emphasis && <strong className="font-semibold text-fg">{r.description.emphasis}</strong>}
                          </>
                        )}
                        {r.editability && <span className="text-fg-faint">{r.description ? ' · ' : ''}{PERMISSIONS.editability[r.editability] ?? r.editability}</span>}
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

// The segment's control (and the harness's `control('setPermissionMode', …)`): C3's `{ effective, refusal, error }`
// with the refusal in C7's words, and a rejected invoke as the transport branch, which moves nothing.
export async function setPermissionMode(input: { appSessionId: AppSessionId; mode: PermissionMode }): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await ipc.invoke('session.setPermissionMode', input);
  if (!result.ok) return { ok: false, error: transportWords(result.error) };
  if (result.value.refusal !== null) return { ok: false, error: MODE_REFUSAL_WORDS[result.value.refusal] };
  if (result.value.error !== null) return { ok: false, error: result.value.error };
  return { ok: true };
}

// C7's mode menu over C7's live binding (the chip's and the status line's, so all three read the same effective mode
// and word refusals alike); the models it checks auto against come through the widget's own read, which a passive
// harness does not issue.
function ModeSegment({ appSessionId, status }: { appSessionId: AppSessionId; status: EngineSessionStatus }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const models = useEngineRead('session.listModels', { appSessionId });
  const binding = useMemo(
    () => ({ ...liveModeBinding(record ?? { appId: appSessionId, permissionMode: status.permissionMode, model: status.model }, status, models.data?.models ?? null), set: (mode: PermissionMode) => setPermissionMode({ appSessionId, mode }) }),
    [record, appSessionId, status, models.data],
  );
  return <ModeMenu binding={binding} />;
}

export function PermissionsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.listPermissionRules', { appSessionId });
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.permissions} command="permissions" foot={WIDGET_FOOT.permissions} state={read.state} error={read.error} close={close}>
      {read.data && <PermissionsBody view={present(read.data.state, status)} mode={status && <ModeSegment appSessionId={appSessionId} status={status} />} />}
    </WidgetFrame>
  );
}
