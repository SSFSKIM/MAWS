// The parts both connector sheets draw (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, M2,
// "The two sheets stop importing each other"): the sheet's environment, the line while the engine is unresolved, a
// field's problem, and why Add waits on what is configured here. `ConnectorSheet` hands a custom add to
// `CustomConnectorSheet`; both import these, and this file imports neither.
import { SECONDARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../../widgets/copy';
import type { EngineResolution } from '../../widgets/plugins/ConfirmSheet';
import { CONNECTORS as C } from './copy';
import type { ConfiguredServers } from './present';

export interface ConnectorSheetEnv {
  cwd: string | null; // the page's directory; null for the user configuration
  runCwd: string; // where the CLI runs: the page's directory, else the engine's configuration directory
  engine: EngineResolution;
  configured: ConfiguredServers; // configured in every scope that applies here (the inventory for `cwd`)
  retryServers(): void; // read them again
  place?: string | null; // UX wave U11g: the page's name for its place, which the custom sheet's "Add to" names
}

// Until `plugins.env` answers there is no command to detail: the sheet says it is resolving the engine, or why it cannot.
export function Unresolved({ engine }: { engine: EngineResolution }) {
  if (engine.state === 'error')
    return (
      <p role="alert" className="m-0 text-ui-sm text-danger">
        {engine.error}
      </p>
    );
  if (engine.state === 'loading')
    return (
      <p role="status" className="m-0 text-ui-sm text-fg-muted">
        {W.resolving}
      </p>
    );
  return null;
}

export function Problem({ text, id }: { text: string | null; id: string }) {
  return text === null ? null : (
    <p id={id} role="alert" data-connector-problem className="m-0 text-ui-sm text-danger [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}

// Why Add waits on what is configured here, with Retry where reading again may help; nothing once it is read whole.
export function Configured({ configured, retry }: { configured: ConfiguredServers; retry(): void }) {
  if (configured.state === 'read') return null;
  if (configured.state === 'reading')
    return (
      <p role="status" className="m-0 text-ui-sm text-fg-muted">
        {C.serversReading}
      </p>
    );
  return (
    <div role="alert" data-connector-configured={configured.state} className="flex flex-wrap items-baseline gap-2 text-ui-sm text-danger [overflow-wrap:anywhere]">
      {configured.state === 'failed' ? C.serversFailed(configured.message) : C.serversPartial}
      <button type="button" className={SECONDARY} onClick={retry}>
        {C.retry}
      </button>
    </div>
  );
}

