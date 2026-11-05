// ClaudeUsage's relay URL (C11; moved here from launch.ts in P5 O7 M9, so mawsd's run path reads it without the
// launch module's graph).
// C11 start: the dev-only relay override (C11 execution document, M6; ruled 2026-09-29). The relay-down live cases point
// the host at a loopback forwarder they stop and start, so ClaudeUsage itself is never quit. Read once, when this module
// loads in the host, and only as `http://127.0.0.1:<port>`; any other value is ignored. Main deletes the variable before
// forking a packaged app's hosts (`main/hosts/supervisor.ts`), and terminals never carry `MAWS_*`.
export function relayUrlFrom(env: Record<string, string | undefined>): string {
  const override = env.MAWS_RELAY_URL;
  const port = override ? /^http:\/\/127\.0\.0\.1:([0-9]{1,5})$/.exec(override)?.[1] : undefined;
  return port !== undefined && Number(port) >= 1 && Number(port) <= 65_535 ? override! : 'http://127.0.0.1:8641';
}
// C11 end
export const RELAY_URL = relayUrlFrom(process.env); // ClaudeUsage's relay, http://127.0.0.1:8641, unless C11's dev override names a loopback port
