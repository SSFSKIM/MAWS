// `/status` (C11 execution document, the widget table): `get_status`'s sections (`Session`, `Environment`, an optional
// `Internal`) as key/value groups, every row verbatim: the engine renders these strings, so the widget shows what the
// terminal's `/status` prints, labels in the key column and unlabeled rows full width.
import type { AppSessionId } from '@shared/graph/ids';
import type { GetStatusResponse } from '@shared/wire/control';
import { WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Group, KeyValues } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export interface StatusView {
  sections: { title: string; rows: { label: string | null; value: string }[] }[];
}

export function present(answer: GetStatusResponse): StatusView {
  return { sections: answer.sections.map((s) => ({ title: s.title, rows: s.rows.map((r) => ({ label: r.label ?? null, value: r.value })) })) };
}

export function StatusBody({ view }: { view: StatusView }) {
  return (
    <div className="flex flex-col">
      {view.sections.map((s) => (
        <Group key={s.title} label={s.title}>
          <KeyValues rows={s.rows} label={s.title} />
        </Group>
      ))}
    </div>
  );
}

export function StatusWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getStatus', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.status} command="status" foot={WIDGET_FOOT.status} state={read.state} error={read.error} close={close}>
      {read.data && <StatusBody view={present(read.data)} />}
    </WidgetFrame>
  );
}
