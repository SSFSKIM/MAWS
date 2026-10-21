// P4-R8 (settings version 16): Settings › Engine › MCP servers, the HTTP servers MAWS passes to every session it launches
// (`--mcp-config`, src/shared/engine/app-mcp-servers.ts) and to no terminal session. An entry is a name and a URL; Add
// writes the list with the entry appended and × writes it without that entry, each through `settings.set` (a patch
// replaces the list whole), so a change reaches each session at its next launch. An entry the schema refuses is said
// beside the fields and nothing is written.
import { useState, type KeyboardEvent } from 'react';
import type { Settings } from '@shared/ipc/schema';
import { AppMcpServerSchema, MAX_APP_MCP_SERVERS, type AppMcpServer } from '@shared/engine/app-mcp-servers';
import { INPUT, Setting, TEXT_ACTION, writeSettings } from './parts';
import { MCP_SERVERS } from './copy';

// Why an entry cannot join the list, in the row's words, or null. The fields are trimmed first: the schema refuses
// surrounding whitespace rather than trimming it.
export function entryProblem(entry: AppMcpServer, servers: readonly AppMcpServer[]): string | null {
  const parsed = AppMcpServerSchema.safeParse(entry);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] !== 'name') return MCP_SERVERS.badUrl;
    return issue.code === 'custom' ? MCP_SERVERS.reservedName : MCP_SERVERS.badName;
  }
  if (servers.some((s) => s.name === entry.name)) return MCP_SERVERS.duplicate(entry.name);
  if (servers.length >= MAX_APP_MCP_SERVERS) return MCP_SERVERS.full;
  return null;
}

export function McpServers({ settings }: { settings: Settings }) {
  const servers = settings.engine.mcpServers;
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<AppMcpServer[] | null>(null);
  if (pending !== null && servers.length === pending.length && servers.every((s, i) => s.name === pending[i].name && s.url === pending[i].url)) setPending(null);
  const write = async (next: AppMcpServer[]) => {
    if (pending !== null) return false;
    setPending(next); // the store's matching list, not the write's answer, enables the controls again
    const ok = await writeSettings({ engine: { mcpServers: next } });
    if (!ok) setPending(null);
    return ok;
  };
  const add = () => {
    if (pending !== null) return;
    const entry: AppMcpServer = { name: name.trim(), type: 'http', url: url.trim() };
    const refused = entryProblem(entry, servers);
    setProblem(refused);
    if (refused !== null) return;
    void write([...servers, entry]).then((ok) => {
      if (!ok) return; // the write's own toast says why; the fields keep what was typed
      setName('');
      setUrl('');
    });
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') add();
    if (e.key === 'Escape') {
      setName('');
      setUrl('');
      setProblem(null);
    }
  };
  return (
    <Setting label={MCP_SERVERS.label} note={MCP_SERVERS.note}>
      {servers.map((server) => (
        <div key={server.name} className="flex min-w-0 basis-full items-center gap-2">
          <span className="font-mono text-ui-sm text-fg">{server.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-fg-muted" title={server.url}>
            {server.url}
          </span>
          <button type="button" aria-label={MCP_SERVERS.remove(server.name)} className={TEXT_ACTION} disabled={pending !== null} onClick={() => void write(servers.filter((s) => s.name !== server.name))}>
            ×
          </button>
        </div>
      ))}
      <div className="flex min-w-0 basis-full items-center gap-2">
        <input aria-label={MCP_SERVERS.name} placeholder={MCP_SERVERS.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={keys} className={`${INPUT} max-w-[140px] font-mono`} />
        <input aria-label={MCP_SERVERS.url} placeholder={MCP_SERVERS.urlPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={keys} className={`${INPUT} flex-1 font-mono`} />
        <button type="button" className={TEXT_ACTION} disabled={pending !== null || name.trim() === '' || url.trim() === ''} onClick={add}>
          {MCP_SERVERS.add}
        </button>
      </div>
      {problem !== null && (
        <span role="alert" className="basis-full text-ui-sm text-warning">
          {problem}
        </span>
      )}
    </Setting>
  );
}
