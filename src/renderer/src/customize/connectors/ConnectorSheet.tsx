// The connector sheet (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding"; built like the
// install sheet, widgets/plugins/ConfirmSheet.tsx): nothing runs before it is confirmed. Adding shows the server's name
// (editable within the engine's rule), publisher, trust label and URL; a choice among the directory's url_options, or a
// required instance URL held to its url_regex with the pattern shown; the transport; the scope (user by default; a
// project's two only on a project's page); "No sign-in needed" for an authless server; and, behind Details (closed at
// every opening, the owner's ruling of 2026-10-25), the exact command and the file it changes. A name already
// configured in any scope that applies here is refused, the existing entry shown; until every such scope's
// configuration is read, Add waits, or says why it cannot, with Retry (M4 fix wave). Removing shows the scope and the
// acknowledgement, with the command and the file behind Details. Where no scope is offered to choose (the user
// configuration's page, a removal), the one scope is a plain line, so it stays in view with the command closed. The
// binary is `plugins.env`'s, read at every opening: until it answers the sheet names no command and confirms nothing.
import { useState } from 'react';
import { isMcpEntryAdd, type McpActionInputs, type McpRemoteAdd, type PluginsScope } from '@shared/plugins/cli';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, DANGER, FIELD, PRIMARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../../widgets/copy';
import { FixedScope, type EngineResolution } from '../../widgets/plugins/ConfirmSheet';
import { argvOf, commandWords, type PluginsRequest } from '../../widgets/plugins/present';
import { SheetDetails } from '../../widgets/plugins/SheetDetails';
import { FOCUSABLE_WORD } from '../../widgets/parts';
import { Tip } from '../../ui/tip';
import { CONNECTORS as C } from './copy';
import { CustomConnectorSheet } from './CustomConnectorSheet';
import { Configured, Problem, Unresolved, type ConnectorSheetEnv } from './sheet-parts';
import { existingOf, nameProblem, scopesFor, urlProblem, writesFor } from './present';

type Add = McpRemoteAdd; // Discover's add: a remote server by name and URL (UX wave U11g narrows the action's two inputs)

export function ConnectorSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  if (request.action === 'mcp-add' && isMcpEntryAdd(request.input)) return <CustomConnectorSheet request={request} env={env} onConfirm={onConfirm} onClose={onClose} />; // UX wave U11g
  return request.action === 'mcp-add' ? <AddSheet request={request} env={env} onConfirm={onConfirm} onClose={onClose} /> : <RemoveSheet request={request} env={env} onConfirm={onConfirm} onClose={onClose} />;
}

// The exact command (none while the form is invalid) and the file it changes, behind Details (the owner's ruling of
// 2026-10-25).
function Details({ engine, request, scope, cwd }: { engine: EngineResolution; request: PluginsRequest | null; scope: PluginsScope; cwd: string }) {
  if (engine.state !== 'ready') return null;
  const argv = request && argvOf(request);
  return (
    <SheetDetails>
      {argv && (
        <Tip content={engine.env.binary} description={engine.env.binary}>
          <code data-plugins-argv={JSON.stringify(argv)} tabIndex={0} className={`block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg ${FOCUSABLE_WORD}`}>
            {commandWords(engine.env.binary, argv)}
          </code>
        </Tip>
      )}
      <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
        <p className="m-0">{C.writes}</p>
        <p data-connector-writes className="m-0 font-mono break-all text-fg">
          {writesFor(scope, { globalConfig: engine.env.globalConfig, cwd })}
        </p>
      </div>
    </SheetDetails>
  );
}

function AddSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const asked = request.input as Add;
  const connector = request.connector;
  const [name, setName] = useState(asked.name);
  const [url, setUrl] = useState(asked.url);
  const [scope, setScope] = useState<PluginsScope>(asked.scope);
  const options = connector?.urlOptions ?? [];
  const pattern = connector?.urlPattern ?? null;
  const typed = pattern !== null && options.length === 0; // an instance URL the person enters
  const nameWrong = nameProblem(name);
  const urlWrong = urlProblem(url, pattern);
  const servers = env.configured.state === 'read' ? env.configured.servers : null;
  const existing = nameWrong === null && servers !== null ? existingOf(name, servers) : null;
  const valid = nameWrong === null && urlWrong === null;
  const confirmed: PluginsRequest | null = valid ? ({ ...request, input: { name, url, transport: asked.transport, scope } } as PluginsRequest) : null;
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  const scopes = scopesFor(env.cwd);
  return (
    <Sheet title={C.addTitle(connector?.name ?? asked.name)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet="mcp-add">
      <SheetForm canSubmit={engine !== null && confirmed !== null && servers !== null && existing === null} onSubmit={() => engine && confirmed && onConfirm(confirmed, engine.binary)} submitLabel={W.submit['mcp-add']} submitClass={PRIMARY}>
        <div data-plugins-sheet-body className="-mx-1 flex max-h-[calc(82vh-8rem)] min-h-0 flex-col gap-3 overflow-y-auto px-1 text-ui-sm">
          {connector && (
            <p data-connector-byline className="m-0 text-fg-muted">
              {[connector.publisher && `by ${connector.publisher}`, connector.trust].filter(Boolean).join(' · ')}
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">{C.name}</span>
            <input value={name} onChange={(event) => setName(event.target.value.trim())} aria-invalid={nameWrong !== null || existing !== null} aria-describedby="connector-name-problem" spellCheck={false} className={`${FIELD} font-mono`} />
          </label>
          <Problem id="connector-name-problem" text={nameWrong ?? (existing && C.exists(existing.scope, existing.path))} />
          <Configured configured={env.configured} retry={env.retryServers} />
          {options.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-fg-muted">{C.urlChoice}</legend>
              {options.map((option) => (
                <label key={option.url} className="flex items-baseline gap-1.5 text-fg">
                  <input type="radio" name="connector-url" value={option.url} checked={url === option.url} onChange={() => setUrl(option.url)} className={CHOICE} />
                  <span>
                    {option.label}
                    {option.description && <span className="text-fg-muted"> · {option.description}</span>}
                    <span className="block font-mono break-all text-fg-muted">{option.url}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : typed ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">{C.instanceUrl}</span>
                <input value={url} onChange={(event) => setUrl(event.target.value.trim())} required aria-invalid={urlWrong !== null} aria-describedby="connector-url-problem" spellCheck={false} placeholder="https://" className={`${FIELD} font-mono`} />
              </label>
              <p data-connector-pattern className="m-0 font-mono break-all text-fg-muted">
                {C.pattern(pattern)}
              </p>
            </>
          ) : (
            <p className="m-0 flex flex-col gap-0.5">
              <span className="text-fg-muted">{C.url}</span>
              <span data-connector-url className="font-mono break-all text-fg">
                {url}
              </span>
            </p>
          )}
          <Problem id="connector-url-problem" text={url === '' && urlWrong === C.urlRequired ? null : urlWrong} />
          <p className="m-0 text-fg-muted">
            {C.transport}: <span className="text-fg">{C.transportName[asked.transport]}</span>
          </p>
          {scopes.length > 1 ? (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-fg-muted">{W.scope}</legend>
              <div className="flex gap-3">
                {scopes.map((option) => (
                  <label key={option} className="flex items-center gap-1.5 text-fg">
                    <input type="radio" name="connector-scope" value={option} checked={scope === option} onChange={() => setScope(option)} className={CHOICE} />
                    {W.scopeName[option]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <FixedScope scope={scope} />
          )}
          {connector && (
            <p data-connector-auth={connector.authPosture} className="m-0 text-fg">
              {connector.authPosture === 'no_auth' ? C.noSignIn : C.signInAfter}
            </p>
          )}
          <Unresolved engine={env.engine} />
          <p className="m-0 text-fg-muted">{C.takesEffect}</p>
          <Details engine={env.engine} request={confirmed} scope={scope} cwd={env.runCwd} />
        </div>
      </SheetForm>
    </Sheet>
  );
}

function RemoveSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const input = request.input as McpActionInputs['mcp-remove'];
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  return (
    <Sheet title={C.removeTitle(input.name)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet="mcp-remove">
      <SheetForm canSubmit={engine !== null && acknowledged} onSubmit={() => engine && onConfirm(request, engine.binary)} submitLabel={W.submit['mcp-remove']} submitClass={DANGER}>
        <div data-plugins-sheet-body className="flex flex-col gap-3 text-ui-sm">
          <FixedScope scope={input.scope} />
          <Unresolved engine={env.engine} />
          <p className="m-0 text-fg-muted">{C.removesFrom}</p>
          <label className="flex items-center gap-2 text-fg">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={CHOICE} />
            {W.understand}
          </label>
          <Details engine={env.engine} request={request} scope={input.scope} cwd={env.runCwd} />
        </div>
      </SheetForm>
    </Sheet>
  );
}
