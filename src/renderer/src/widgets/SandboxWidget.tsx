// `/sandbox` (C11 execution document, the widget table; E11's sitting, owner-notes 00-consolidated-plan §2.2):
// `get_sandbox_dialog` read first as "Sandbox on" or "Sandbox off", with why it is off (not turned on in your settings,
// turned on but unavailable or not in effect, or not supported on this Mac) or, when on, what happens to a command that
// fails inside it (the unsandboxed fallback), and a policy lock. Dependency problems stay in view; the settings behind
// the first read, excluded commands and every non-empty restriction are under Details. Read-only: the terminal's toggle
// writes settings.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetSandboxDialogResponse } from '@shared/wire/control';
import { SANDBOX, SHARED, WIDGET_TITLE } from './copy';
import { Group, KeyValues, Mono, Row, Rows } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const Strings = z.array(z.string());
const DependenciesSchema = z.looseObject({ errors: Strings.catch([]), warnings: Strings.catch([]) });
const yes = (value: unknown) => (value === true ? SHARED.yes : value === false ? SHARED.no : '—');
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

export interface SandboxView {
  headline: string; // Sandbox on, Sandbox off
  reason: string; // why it is off, or what happens to a command that fails inside it
  locked: boolean; // set by policy
  rows: { label: string; value: string }[];
  dependencies: { errors: string[]; warnings: string[] };
  excluded: string[];
  restrictions: { label: string; values: string[] }[];
}

function reasonOf(dialog: GetSandboxDialogResponse): string {
  if (dialog.enabled) return dialog.unsandboxed_fallback === false ? SANDBOX.fallbackRefused : SANDBOX.fallbackAllowed;
  if (!dialog.supported) return SANDBOX.unsupported(text(dialog.unsupported_reason));
  if (dialog.enabled_in_settings !== true) return SANDBOX.notInSettings;
  const unavailable = text(dialog.unavailable_reason);
  return unavailable ? SANDBOX.unavailable(unavailable) : SANDBOX.notInEffect;
}

export function present(dialog: GetSandboxDialogResponse): SandboxView {
  const restrictions = (typeof dialog.restrictions === 'object' && dialog.restrictions !== null ? dialog.restrictions : {}) as Record<string, unknown>;
  const excluded = Strings.safeParse(dialog.excluded_commands);
  return {
    headline: dialog.enabled ? SANDBOX.on : SANDBOX.off,
    reason: reasonOf(dialog),
    locked: dialog.locked === true,
    rows: [
      { label: SANDBOX.inSettings, value: dialog.enabled_in_settings === true ? SHARED.on : dialog.enabled_in_settings === false ? SHARED.off : '—' },
      { label: SANDBOX.lockedRow, value: yes(dialog.locked) },
      { label: SANDBOX.autoAllow, value: dialog.auto_allow_available === true ? SANDBOX.available : SANDBOX.notAvailable },
      { label: SANDBOX.fallback, value: dialog.unsandboxed_fallback === true ? SANDBOX.allowed : dialog.unsandboxed_fallback === false ? SANDBOX.refused : '—' },
      ...(restrictions.network_managed === true ? [{ label: SANDBOX.network, value: SANDBOX.managed }] : []),
    ],
    dependencies: DependenciesSchema.catch({ errors: [], warnings: [] }).parse(dialog.dependencies),
    excluded: excluded.success ? excluded.data : [],
    restrictions: Object.entries(SANDBOX.restriction).flatMap(([key, label]) => {
      const values = Strings.safeParse(restrictions[key]);
      return values.success && values.data.length > 0 ? [{ label, values: values.data }] : [];
    }),
  };
}

export function SandboxBody({ view }: { view: SandboxView }) {
  const problems = [...view.dependencies.errors.map((text) => ({ text, level: 'error' })), ...view.dependencies.warnings.map((text) => ({ text, level: 'warning' }))];
  return (
    <div className="flex flex-col">
      <p className="m-0 font-semibold">{view.headline}</p>
      <p className="m-0 text-ui-sm text-fg-muted">{view.reason}</p>
      {view.locked && <p className="m-0 mt-1 text-ui-sm text-fg-muted">{SANDBOX.locked}</p>}
      {problems.length > 0 && (
        <Group label={SANDBOX.dependencies}>
          <Rows>
            {problems.map((p, i) => (
              <Row key={i} main={p.text} note={p.level} />
            ))}
          </Rows>
        </Group>
      )}
      <details className="mt-2">
        <summary className="cursor-default text-ui-sm text-fg-muted">{SANDBOX.details}</summary>
        <div className="mt-1">
          <KeyValues rows={view.rows} label={SANDBOX.settings} />
          {view.excluded.length > 0 && (
            <Group label={SANDBOX.excluded} count={view.excluded.length}>
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
      </details>
    </div>
  );
}

export function SandboxWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getSandboxDialog', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.sandbox} command="sandbox" state={read.state} error={read.error} close={close}>
      {read.data && <SandboxBody view={present(read.data)} />}
    </WidgetFrame>
  );
}
