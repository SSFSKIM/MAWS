// scalpel-2#1: a sign-in runs only in a session whose engine uses the entry the row is. The engine is asked for a server
// by name alone, so a session whose directory has another entry of the name (a local override of a user server, MAWS's
// own server) would sign that one in, and its success would be shown on the wrong row.
import { describe, expect, it, vi } from 'vitest';
import * as rule from '@shared/plugins/plugin-connector';
import { dynamicRefusal, entryRefusal, pluginEntryOf, pluginOwnerRefusal, pluginServerRefusal, type PluginEntry } from './sign-in-entry';

// UX wave U11h: (c) asks `addressMatches` only of an address it may sign in at; the spy shows a templated-origin one never is
vi.mock('@shared/plugins/plugin-connector', async (actual) => {
  const real = await actual<typeof import('@shared/plugins/plugin-connector')>();
  return { ...real, addressMatches: vi.fn(real.addressMatches) };
});

const GLOBAL = '/cfg/.claude.json';
const URL_U = 'https://u.example/mcp';
const user = { name: 'linear', scope: 'user', path: GLOBAL, transport: 'http', url: URL_U } as const;
const local = { name: 'linear', scope: 'local', path: GLOBAL, transport: 'http', url: 'https://l.example/mcp' } as const;
const project = (path: string) => ({ name: 'linear', scope: 'project', path, transport: 'http', url: 'https://p.example/mcp' }) as const;
const DIFFERENT = 'this session uses a different linear; start a new session to sign in';
// what 2.1.309's mcp_status reports for a server (cli.pretty.js 1128186): its scope, transport and redacted config
const live = (scope: string, url: string, transport = 'http') => ({ name: 'linear', status: 'needs-auth', scope, transport, config: { type: transport, url } });

describe('the session’s entry for a sign-in', () => {
  it('is the requested one: nothing to refuse', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [])).toBeNull();
    expect(entryRefusal({ ...local, cwd: '/p' }, '/p', [user, local], [])).toBeNull();
    expect(entryRefusal({ name: 'linear', scope: 'project', path: '/p/.mcp.json', cwd: '/p' }, '/p', [project('/p/.mcp.json')], [])).toBeNull();
  });

  it('is another: a local override, MAWS’s own server, a nearer project file, or none at all', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user, local], [])).toBe(`that session uses the local entry in ${GLOBAL}`);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user, { name: 'linear', scope: 'app', path: '/maws/settings.json', transport: 'http', url: URL_U }], [])).toBe('that session uses MAWS’s linear server');
    expect(entryRefusal({ name: 'linear', scope: 'project', path: '/p/.mcp.json', cwd: '/p/app' }, '/p/app', [project('/p/.mcp.json'), project('/p/app/.mcp.json')], [])).toBe('that session uses the project entry in /p/app/.mcp.json');
    expect(entryRefusal({ ...user, cwd: null }, '/p', [], [])).toBe('that session has no linear entry');
  });

  it('a local entry is its project’s: a session in another directory does not use it', () => {
    expect(entryRefusal({ ...local, cwd: '/p' }, '/q', [user, local], [])).toBe('that session runs in /q, not /p');
  });

  // fix-D#4: the engine signs in the server it holds, which is what it read at launch, not what the files say now
  it('is the one the running engine holds: same scope and endpoint, as its mcp_status reports them', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U)])).toBeNull();
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [])).toBeNull(); // not in its status yet: it reads the files when asked
  });

  it('reads streamable-http as http on either side, as the engine does (2.1.309 cli.pretty.js 719781)', () => {
    // an entry typed streamable-http on disk: the inventory reads it as http; the engine may report either spelling
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U, 'streamable-http')])).toBeNull();
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U, 'http')])).toBeNull();
    const raw = { ...user, transport: 'streamable-http' } as const;
    expect(entryRefusal({ ...user, cwd: null }, '/p', [raw], [live('user', URL_U, 'http')])).toBeNull();
  });

  it('is not, when the running engine holds another: an app server given at launch and since removed, or a changed endpoint', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('dynamic', URL_U)])).toBe(DIFFERENT);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', 'https://old.example/mcp')])).toBe(DIFFERENT);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U, 'sse')])).toBe(DIFFERENT);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [{ name: 'linear' }])).toBe(DIFFERENT); // says nothing of its entry
  });
});

// UX wave U11a (§A, "The check"): a dynamic connector, one a plugin brings or one of MAWS's own list, is the session's
// own server of the name, which its mcp_status lists with scope `dynamic`; a press from a row of MAWS's own list also
// names the configuration that row was drawn from, by its revision, which must still be the entry's and the session's.
describe('the session’s server for a dynamic sign-in', () => {
  const OWN_URL = 'https://own.example.test/mcp';
  const NEW_URL = 'https://own-moved.example.test/mcp';
  const held = (name: string, over: Record<string, unknown> = {}) => ({ name, status: 'needs-auth', scope: 'dynamic', transport: 'http', config: { type: 'http', url: OWN_URL }, ...over });
  const own = (over: Record<string, unknown> = {}) => ({ name: 'fx-own', scope: 'app', path: '/maws/machine-settings.json', transport: 'http', url: OWN_URL, revision: 'rev-1', ...over }) as const;
  const PRESS = { name: 'fx-own', entry: { revision: 'rev-1' } };
  const CHANGED = 'MAWS’s fx-own server changed since this page read it; refresh the page, then sign in';
  const OTHER = 'this session uses a different fx-own; start a new session to sign in';

  it('is the dynamic server the session lists: a plugin’s, or one of MAWS’s own list pressed from the dialog', () => {
    expect(dynamicRefusal({ name: 'plugin:fx-plugin:fx-oauth' }, [held('plugin:fx-plugin:fx-oauth')], [])).toBeNull();
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-own')], [])).toBeNull();
    // a press from the dialog names no entry: MAWS's list is not consulted, whatever it says now
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-own')], [own({ url: NEW_URL, revision: 'rev-2' })])).toBeNull();
  });

  it('is none, or a file-configured one, in a session that does not hold it', () => {
    expect(dynamicRefusal({ name: 'fx-own' }, [], [])).toBe('that session has no fx-own server');
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-other')], [])).toBe('that session has no fx-own server');
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-own', { scope: 'user' })], [])).toBe(OTHER);
    expect(dynamicRefusal(PRESS, [held('fx-own', { scope: 'project' })], [own()])).toBe(OTHER);
  });

  it('a press from MAWS’s own list: the entry of the revision it was drawn with, and the session’s server is that entry', () => {
    expect(dynamicRefusal(PRESS, [held('fx-own')], [own()])).toBeNull();
    // `streamable-http` is the engine's `http`; an address written with ${…} is the engine's to expand, not compared
    expect(dynamicRefusal(PRESS, [held('fx-own', { transport: 'streamable-http' })], [own()])).toBeNull();
    expect(dynamicRefusal(PRESS, [held('fx-own', { config: { type: 'http', url: 'https://expanded.example.test/mcp' } })], [own({ url: 'https://${HOST}/mcp' })])).toBeNull();
  });

  it('a press from MAWS’s own list whose entry is gone, replaced, or has no revision now is refused as changed', () => {
    expect(dynamicRefusal(PRESS, [held('fx-own')], [])).toBe(CHANGED);
    expect(dynamicRefusal(PRESS, [held('fx-own', { config: { type: 'http', url: NEW_URL } })], [own({ url: NEW_URL, revision: 'rev-2' })])).toBe(CHANGED);
    expect(dynamicRefusal(PRESS, [held('fx-own')], [own({ revision: null })])).toBe(CHANGED);
    const older: Record<string, unknown> = { ...own() };
    delete older.revision; // an engine host of an earlier build answers none
    expect(dynamicRefusal(PRESS, [held('fx-own')], [older as never])).toBe(CHANGED);
    // only MAWS's own entries count: a file entry of the name is not the list's
    expect(dynamicRefusal(PRESS, [held('fx-own')], [own({ scope: 'user', path: '/cfg/.claude.json' })])).toBe(CHANGED);
  });

  it('a press from MAWS’s own list in a session whose server is another configuration than the entry’s', () => {
    expect(dynamicRefusal(PRESS, [held('fx-own', { config: { type: 'http', url: NEW_URL } })], [own()])).toBe(OTHER);
    expect(dynamicRefusal(PRESS, [held('fx-own', { transport: 'sse', config: { type: 'sse', url: OWN_URL } })], [own()])).toBe(OTHER);
    expect(dynamicRefusal(PRESS, [{ name: 'fx-own', scope: 'dynamic' }], [own()])).toBe(OTHER); // says nothing of its configuration
  });
});

// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §B, "The rule"): a press from a
// plugin's row in Customize names the entry it was drawn from by its revision, among the plugins' connectors the engine
// host reads at the session's folder (d); the plugins that session reported hold exactly one possible owner of the engine
// name, with the row's key (a); the session's server of the name is a plugin's, of the entry's transport (b), at the
// entry's address (c). These are point 1's words; points 2 and 3 have one sentence of their own (sign-in.ts).
describe('a plugin’s connector, by the rule’s parts at the press (UX wave U11h)', () => {
  const NAME = 'plugin:mani-tides:tides-http';
  const URL_T = 'https://tides.example.com/mcp';
  // an entry found by its name (`name` is a string there); (d)'s cases also give one with none
  const entry = (over: Partial<PluginEntry> = {}) => ({ plugin: 'key-tides@harbour', name: NAME, version: '1.2.0', transport: 'http', url: URL_T, revision: 'rev-1', ...over }) as PluginEntry & { name: string };
  // a server as 2.1.322's mcp_status reports a plugin's (spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn.ndjson [2])
  const live = (over: Record<string, unknown> = {}, url: unknown = URL_T) => ({ name: NAME, status: 'needs-auth', scope: 'dynamic', source: 'plugin', transport: 'http', config: { type: 'http', url }, serverInfo: { name: 'tides', version: '1.2.0' }, tools: [], ...over });
  const DIFFERENT = `this session uses a different ${NAME}; start a new session to sign in`;
  const LAUNCH = `${NAME}’s address is set when a chat starts; sign in from that chat’s Connectors dialog`;
  const AT = '2026-11-14T22:39:19.282Z';

  describe('(d) the entry, by its name and its revision', () => {
    const other = entry({ plugin: 'key-tides@other-harbour', revision: 'rev-2' });
    it('is the entry of the press’s name whose revision is the press’s: two entries of one engine name told apart', () => {
      expect(pluginEntryOf({ name: NAME, revision: 'rev-1' }, [other, entry()])).toEqual(entry());
      expect(pluginEntryOf({ name: NAME, revision: 'rev-2' }, [other, entry()])).toEqual(other);
    });
    it('is none where the entry is gone, its revision is another, or the host answered no revision', () => {
      expect(pluginEntryOf({ name: NAME, revision: 'rev-1' }, [])).toBeNull();
      expect(pluginEntryOf({ name: NAME, revision: 'rev-1' }, [other])).toBeNull();
      expect(pluginEntryOf({ name: NAME, revision: 'rev-1' }, [entry({ revision: null })])).toBeNull();
      expect(pluginEntryOf({ name: NAME, revision: 'rev-1' }, [entry({ name: null })])).toBeNull();
      expect(pluginEntryOf({ name: 'plugin:mani-tides:other', revision: 'rev-1' }, [entry()])).toBeNull();
    });
  });

  describe('(a) the owner, in the words of the press', () => {
    const tides = (source: string | null = 'key-tides@harbour', version: string | null = '1.2.0') => ({ name: 'mani-tides', source, version });
    it('admits the one possible owner with the row’s key', () => {
      expect(pluginOwnerRefusal(entry(), [tides(), { name: 'cc-plugin-telemetry', source: 'cc-plugin-telemetry@builtin', version: null }], AT)).toBeNull();
    });
    it('says why for each verdict that is not ok', () => {
      expect(pluginOwnerRefusal(entry(), [tides()], null)).toBe('that session has not reported its plugins yet; send it a message, then sign in');
      expect(pluginOwnerRefusal(entry(), [], AT)).toBe(`that session loaded no plugin that supplies ${NAME}`);
      expect(pluginOwnerRefusal(entry(), [tides(), tides('key-tides@other-harbour')], AT)).toBe(`more than one plugin in that session supplies ${NAME}; turn the others off, start a new session, then sign in`);
      expect(pluginOwnerRefusal(entry(), [tides('key-tides@other-harbour')], AT)).toBe(`that session loaded ${NAME} from another plugin`);
      expect(pluginOwnerRefusal(entry(), [tides('key-tides@harbour', '1.3.0')], AT)).toBe('that session loaded another version of this plugin; start a new session to sign in');
    });
  });

  describe('(b) the server', () => {
    it('is the session’s plugin server of the name, scope dynamic, of the entry’s transport, `streamable-http` read as `http`', () => {
      expect(pluginServerRefusal(entry(), [live()])).toBeNull();
      expect(pluginServerRefusal(entry(), [live({ transport: 'streamable-http', config: { type: 'streamable-http', url: URL_T } })])).toBeNull();
      expect(pluginServerRefusal(entry({ transport: 'sse' }), [live({ transport: 'sse', config: { type: 'sse', url: URL_T } })])).toBeNull();
    });
    it('refuses no server of the name, a scope not dynamic, a source not plugin, and another transport', () => {
      expect(pluginServerRefusal(entry(), [])).toBe(`that session has no ${NAME} server`);
      expect(pluginServerRefusal(entry(), [live({ name: 'plugin:mani-tides:other' })])).toBe(`that session has no ${NAME} server`);
      expect(pluginServerRefusal(entry(), [live({ scope: 'user' })])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry(), [live({ source: 'sdk' })])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry(), [live({ source: undefined })])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry(), [live({ transport: 'sse' })])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry({ transport: 'sse' }), [live()])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry(), [{ name: NAME }])).toBe(DIFFERENT); // says nothing of itself
    });
  });

  describe('(c) the address', () => {
    it('a literal address: equal admits, unequal refuses, a trailing slash a difference', () => {
      expect(pluginServerRefusal(entry(), [live()])).toBeNull();
      expect(pluginServerRefusal(entry(), [live({}, 'https://other.example.com/mcp')])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry(), [live({}, `${URL_T}/`)])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry(), [live({ config: { type: 'http' } })])).toBe(DIFFERENT); // no address reported
    });
    it('a templated address: a live address that matches admits, one that does not or where a ${…} would stand for nothing refuses', () => {
      const templated = entry({ url: 'https://tides.example.com/${TENANT}/mcp' });
      expect(pluginServerRefusal(templated, [live({}, 'https://tides.example.com/harbour/mcp')])).toBeNull();
      expect(pluginServerRefusal(templated, [live({}, 'https://tides.example.com/harbour/sse')])).toBe(DIFFERENT);
      expect(pluginServerRefusal(templated, [live({}, 'https://tides.example.com//mcp')])).toBe(DIFFERENT);
      expect(pluginServerRefusal(templated, [live({}, 'https://other.example.com/harbour/mcp')])).toBe(DIFFERENT); // another origin
      expect(pluginServerRefusal(templated, [live({}, 'not a url')])).toBe(DIFFERENT); // does not parse
    });
    it('the strict form’s refusals are templated-origin, in the launch’s words, and never asked of addressMatches', () => {
      const asked = vi.mocked(rule.addressMatches);
      asked.mockClear();
      for (const url of ['https:///${HOST}/mcp', 'https://tides.example.com\\x/${TENANT}', 'https://user@tides.example.com/${TENANT}', 'https://tides.example.com:${PORT}/mcp', 'HTTPS://tides.example.com/${TENANT}']) {
        expect([url, pluginServerRefusal(entry({ url }), [live({}, 'https://tides.example.com/harbour/mcp')])]).toEqual([url, LAUNCH]);
      }
      expect(asked).not.toHaveBeenCalled();
      expect(pluginServerRefusal(entry(), [live()])).toBeNull();
      expect(asked).toHaveBeenCalledOnce(); // the spy is the one the rule asks
    });
    it('a remote entry with no address (its declared address past the endpoints’ bound) refuses, a session at its first 4096 characters included', () => {
      const bound = `https://tides.example.com/${'a'.repeat(4096 - 'https://tides.example.com/'.length)}`;
      expect(bound).toHaveLength(4096);
      expect(pluginServerRefusal(entry({ url: null }), [live({}, bound)])).toBe(DIFFERENT);
      expect(pluginServerRefusal(entry({ url: null }), [live({ config: { type: 'http' } })])).toBe(DIFFERENT);
    });
  });
});
