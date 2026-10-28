import { appInitialize } from '@shared/engine/initialize';
import { appHostHooks } from './host-hooks'; // P5 O2 M2
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { JournalRow } from '@shared/wire/journal';

// Old probes declared fewer client capabilities and attested their own scratch cwd. App/session replay deliberately
// projects only those launch-owned initialize fields; raw protocol conformance keeps the recorded handshake intact.
// This is not evidence of capability/trust parity with the old recording. P5 O2 M2: the hooks are launch-owned now, the
// Stop callback every launch registers (host-hooks.ts), so the app's own replace a recording's. Every other field stays
// exact.
// Checked-in recordings are never rewritten; new app-shaped probes use appInitialize at recording time.
export function appReplayHandshake(rows: JournalRow[], trust: LaunchSpec['trust']): JournalRow[] {
  return rows.map((row) => {
    const frame = row.frame as { type?: string; request?: Record<string, unknown> };
    if (row.direction !== 'out' || frame.type !== 'control_request' || frame.request?.subtype !== 'initialize') return row;
    const request = { ...frame.request };
    delete request.supportedDialogKinds;
    delete request.perTaskStopAffordance;
    delete request.workspaceTrust;
    delete request.sdkMcpServers; // E1: the app's own list, never an older recording's (pass3/p1-sdk-mcp-roundtrip carries one)
    return { ...row, frame: { ...frame, request: { ...request, ...appInitialize(trust ?? undefined), hooks: appHostHooks() /* P5 O2 M2 */ } } };
  });
}
