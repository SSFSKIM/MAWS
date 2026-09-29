// `/permissions` (C11 execution document, the widget table; mockup 06 vignette 05, the pattern for every engine-read
// widget): the effective mode from the init frame with a refusal in words (D-18), then every rule of
// `list_permission_rules` grouped allow, ask, deny, each with the engine's own phrasing, the rule in mono and its source
// file, then the workspace directories. M2 is the read half; M3 adds the mode segment over `session.setPermissionMode`.
import * as z from 'zod';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { ListPermissionRulesResponse } from '@shared/wire/control';
import { MODE_REFUSAL_WORDS } from '../statusline/mode-menu';
import { useSessions } from '../stores/sessions';
import { EFFECTIVE_MODE, NO_RULES, RULE_EDITABILITY, RULE_GROUP, RULE_SOURCE, WIDGET_FOOT, WIDGET_TITLE, WORKSPACE } from './copy';
import { Group, Mono, Row, Rows } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const DescriptionSchema = z.looseObject({ prefix: z.string(), emphasis: z.string().optional() });
const BEHAVIORS = ['allow', 'ask', 'deny'] as const;
// A workspace directory is a path, or an object carrying one (the wire leaves the entry's shape open).
const WorkspaceDirectorySchema = z.union([z.string(), z.looseObject({ path: z.string() }).transform((d) => d.path)]);
const directories = (raw: readonly unknown[]) => raw.flatMap((d) => {
  const parsed = WorkspaceDirectorySchema.safeParse(d);
  return parsed.success ? [parsed.data] : [];
});

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
  grants: number;
}

export function present(state: ListPermissionRulesResponse['state'], status: Pick<EngineSessionStatus, 'permissionMode' | 'grants'> | null): PermissionsView {
  const ruleView = (r: ListPermissionRulesResponse['state']['rules'][number]): RuleView => {
    const description = DescriptionSchema.safeParse(r.description);
    return {
      rule: r.rule,
      source: RULE_SOURCE[r.source] ?? r.source,
      editability: r.editability ?? null,
      description: description.success ? { prefix: description.data.prefix, emphasis: description.data.emphasis ?? null } : null,
    };
  };
  const added = directories(state.workspaceDirectories).filter((d) => d !== state.originalCwd);
  return {
    mode: status && { effective: status.permissionMode.effective, refusal: status.permissionMode.refusal === null ? null : MODE_REFUSAL_WORDS[status.permissionMode.refusal] },
    groups: BEHAVIORS.map((behavior) => ({ behavior, label: RULE_GROUP[behavior], rules: state.rules.filter((r) => r.behavior === behavior).map(ruleView) })),
    workspace: [{ path: state.originalCwd, note: 'original directory' }, ...added.map((path) => ({ path, note: 'added' }))],
    managedOnly: state.managedOnly,
    grants: status?.grants.length ?? 0,
  };
}

export function PermissionsBody({ view }: { view: PermissionsView }) {
  const none = view.groups.every((g) => g.rules.length === 0);
  return (
    <div className="flex flex-col">
      {view.mode && (
        <div className="mb-2">
          <p className="m-0">
            Effective <strong className="font-semibold">{view.mode.effective}</strong> <span className="text-ui-sm text-fg-muted">· {EFFECTIVE_MODE}</span>
          </p>
          {view.mode.refusal && <p className="m-0 mt-1 border-l-2 border-warning pl-2 text-ui-sm">{view.mode.refusal}</p>}
        </div>
      )}
      {none && <p className="m-0 text-ui-sm text-fg-muted">{NO_RULES}</p>}
      {view.groups
        .filter((g) => g.rules.length > 0)
        .map((g) => (
          <Group key={g.behavior} label={g.label} count={g.rules.length}>
            <Rows label={`${g.label} rules`}>
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
                        {r.editability && <span className="text-fg-faint">{r.description ? ' · ' : ''}{RULE_EDITABILITY[r.editability] ?? r.editability}</span>}
                      </>
                    ) : null
                  }
                />
              ))}
            </Rows>
          </Group>
        ))}
      <Group label={WORKSPACE}>
        <Rows label="Workspace directories">
          {view.workspace.map((w) => (
            <Row key={w.path} main={<Mono>{w.path}</Mono>} note={w.note} />
          ))}
        </Rows>
        {view.managedOnly && <p className="m-0 mt-1 text-ui-sm text-fg-muted">Only managed rules apply</p>}
      </Group>
    </div>
  );
}

export function PermissionsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.listPermissionRules', { appSessionId });
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.permissions} command="permissions" foot={WIDGET_FOOT.permissions} state={read.state} error={read.error} close={close}>
      {read.data && <PermissionsBody view={present(read.data.state, status)} />}
    </WidgetFrame>
  );
}
