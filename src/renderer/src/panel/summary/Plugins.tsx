// Plugins (R1; charter D-9 as amended 2026-10-01): each plugin's pinned status line, the engine's `ui_status`, as
// "<plugin> · <text>" by plugin name, from the session's transcript entry as Sources reads its activity (the card never
// attaches a source of its own). The section shows only while some plugin pins a line; an empty text clears a line.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../stores/transcript';
import { PLUGIN, pluginLines } from '../../transcript';
import { Row, Section } from './Section';

export function Plugins({ appSessionId }: { appSessionId: AppSessionId }) {
  const status = useTranscriptStore((s) => s.entries[appSessionId]?.state.pluginStatus);
  const lines = useMemo(() => (status ? pluginLines(status) : []), [status]);
  if (lines.length === 0) return null;
  return (
    <Section id="plugins">
      {lines.map(({ plugin, text }) => {
        const line = PLUGIN.status(plugin, text);
        return (
          <Row key={plugin}>
            <span data-plugin={plugin} className="block truncate text-fg-muted" title={line}>
              {line}
            </span>
          </Row>
        );
      })}
    </Section>
  );
}
