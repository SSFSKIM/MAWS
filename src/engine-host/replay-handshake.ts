import { appInitialize } from '@shared/engine/initialize';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { JournalRow } from '@shared/wire/journal';

// Old probes declared fewer client capabilities and attested their own scratch cwd. App/session replay deliberately
// projects only those launch-owned initialize fields; raw protocol conformance keeps the recorded handshake intact.
// This is not evidence of capability/trust parity with the old recording. Hooks and every other field stay exact.
// Checked-in recordings are never rewritten; new app-shaped probes use appInitialize at recording time.
export function appReplayHandshake(rows: JournalRow[], trust: LaunchSpec['trust']): JournalRow[] {
  return rows.map((row) => {
    const frame = row.frame as { type?: string; request?: Record<string, unknown> };
    if (row.direction !== 'out' || frame.type !== 'control_request' || frame.request?.subtype !== 'initialize') return row;
    const request = { ...frame.request };
    delete request.supportedDialogKinds;
    delete request.perTaskStopAffordance;
    delete request.workspaceTrust;
    return { ...row, frame: { ...frame, request: { ...request, ...appInitialize(trust ?? undefined) } } };
  });
}
