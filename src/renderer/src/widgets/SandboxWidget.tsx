// `/sandbox` (C11 execution document, the widget table): `get_sandbox_dialog` as the terminal's menu shows it: support
// and mode on one line, the settings behind them, dependency problems, excluded commands and every non-empty
// restriction. The terminal's toggle writes settings; the widget shows the value and says where it is set (D-12).
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetSandboxDialogResponse } from '@shared/wire/control';
import { WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Group, KeyValues, Mono, Row, Rows } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const Strings = z.array(z.string());
const DependenciesSchema = z.looseObject({ errors: Strings.catch([]), warnings: Strings.catch([]) });
const yes = (value: unknown) => (value === true ? 'yes' : value === false ? 'no' : '—');

// The restriction lists in the terminal's order, by their wire keys.
const RESTRICTIONS: [key: string, label: string][] = [
  ['fs_deny_read', 'Deny reading'],
  ['fs_allow_read', 'Allow reading'],
  ['fs_allow_write', 'Allow writing'],
  ['fs_deny_write', 'Deny writing'],
  ['network_allowed_domains', 'Allowed domains'],
  ['network_denied_domains', 'Denied domains'],
  ['unix_sockets', 'Unix sockets'],
  ['ignored_glob_patterns', 'Ignored patterns'],
];

export interface SandboxView {
  line: string;
  rows: { label: string; value: string }[];
  dependencies: { errors: string[]; warnings: string[] };
  excluded: string[];
  restrictions: { label: string; values: string[] }[];
}

export function present(dialog: GetSandboxDialogResponse): SandboxView {
  const reason = typeof dialog.unsupported_reason === 'string' ? dialog.unsupported_reason : null;
  const restrictions = (typeof dialog.restrictions === 'object' && dialog.restrictions !== null ? dialog.restrictions : {}) as Record<string, unknown>;
  const excluded = Strings.safeParse(dialog.excluded_commands);
  const unavailable = typeof dialog.unavailable_reason === 'string' ? dialog.unavailable_reason : null;
  return {
    line: `${dialog.mode} · ${dialog.supported ? 'supported' : `unsupported${reason ? `: ${reason}` : ''}`}`,
    rows: [
      { label: 'Enabled', value: yes(dialog.enabled) },
      { label: 'Enabled in settings', value: yes(dialog.enabled_in_settings) },
      { label: 'Locked', value: yes(dialog.locked) },
      { label: 'Auto-allow', value: dialog.auto_allow_available === true ? 'available' : 'not available' },
      { label: 'Unsandboxed fallback', value: yes(dialog.unsandboxed_fallback) },
      ...(unavailable ? [{ label: 'Unavailable', value: unavailable }] : []),
      ...(restrictions.network_managed === true ? [{ label: 'Network', value: 'managed' }] : []),
    ],
    dependencies: DependenciesSchema.catch({ errors: [], warnings: [] }).parse(dialog.dependencies),
    excluded: excluded.success ? excluded.data : [],
    restrictions: RESTRICTIONS.flatMap(([key, label]) => {
      const values = Strings.safeParse(restrictions[key]);
      return values.success && values.data.length > 0 ? [{ label, values: values.data }] : [];
    }),
  };
}

export function SandboxBody({ view }: { view: SandboxView }) {
  const problems = [...view.dependencies.errors.map((text) => ({ text, level: 'error' })), ...view.dependencies.warnings.map((text) => ({ text, level: 'warning' }))];
  return (
    <div className="flex flex-col">
      <p className="m-0 mb-2">{view.line}</p>
      <KeyValues rows={view.rows} label="Sandbox settings" />
      {problems.length > 0 && (
        <Group label="Dependencies">
          <Rows>
            {problems.map((p, i) => (
              <Row key={i} main={p.text} note={p.level} />
            ))}
          </Rows>
        </Group>
      )}
      {view.excluded.length > 0 && (
        <Group label="Excluded commands" count={view.excluded.length}>
          <Rows>
            {view.excluded.map((c) => (
              <Row key={c} main={<Mono>{c}</Mono>} />
            ))}
          </Rows>
        </Group>
      )}
      {view.restrictions.map((r) => (
        <Group key={r.label} label={r.label} count={r.values.length}>
          <Rows>
            {r.values.map((v) => (
              <Row key={v} main={<Mono>{v}</Mono>} />
            ))}
          </Rows>
        </Group>
      ))}
    </div>
  );
}

export function SandboxWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getSandboxDialog', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.sandbox} command="sandbox" foot={WIDGET_FOOT.sandbox} state={read.state} error={read.error} close={close}>
      {read.data && <SandboxBody view={present(read.data)} />}
    </WidgetFrame>
  );
}
