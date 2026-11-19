// What the UX wave's U11h sends that build F can meet (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md,
// H10 and §H; the root's UC-14). Customize's two reads of the engine host gain optional lists, a plugin's connectors and
// the plugins kept for the folder: build F's main reads its engine host's answers with `readTolerant` and drops what it
// does not know, and this build reads F's answers, which never carry them.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { commands } from './schema';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from './schema/customization';
import { readTolerant } from './tolerant';

// The two answers as build F (`f1852de3a`) has them, copied literally from its `ipc/schema/customization.ts`: F's skill has
// no `pluginName` (U11a) and its endpoint no `revision` (U11a M8). `ipc/tolerant.ts` is unchanged from F to this branch.
const AbsolutePath = z.string().min(1).max(4096).refine((path) => path.startsWith('/') && !path.includes('\0'), 'expected an absolute path');
const BUILD_F_SKILL = z.strictObject({
  name: z.string(), description: z.string(), source: z.enum(['user', 'project', 'plugin']), path: AbsolutePath, plugin: z.string().nullable(),
});
const BUILD_F_SERVER = z.strictObject({
  name: z.string(), scope: z.enum(['app', 'user', 'project', 'local']), path: AbsolutePath, transport: z.enum(['stdio', 'http', 'sse', 'ws', 'unknown']),
});
const BUILD_F_ENDPOINT = z.strictObject({ name: z.string(), scope: z.enum(['app', 'user', 'project', 'local']), path: AbsolutePath, transport: BUILD_F_SERVER.shape.transport, url: z.string().max(4096).nullable() });
const BUILD_F_INVENTORY = z.strictObject({
  skills: z.array(BUILD_F_SKILL), servers: z.array(BUILD_F_SERVER), warnings: z.array(z.string()),
  serversRead: z.boolean(),
});
const BUILD_F_ENDPOINTS = z.strictObject({ servers: z.array(BUILD_F_ENDPOINT) });

const COVERAGE = 'Plugin MCP servers and marketplace-only skill declarations are not inventoried; see Plugins.'; // F's constant, and this build's
const skill = { name: 'tide-tables', description: 'Reads the tide tables', source: 'plugin', path: '/plugins/tides/skills/tide-tables/SKILL.md', plugin: 'key-tides@harbour-market' } as const;
const server = { name: 'harbour', scope: 'user', path: '/config/.claude.json', transport: 'http' } as const;
const endpoint = { ...server, url: 'https://harbour.example.com/mcp' } as const;
const pluginServer = { plugin: 'key-tides@harbour-market', pluginName: 'mani-tides', server: 'tides-http', name: 'plugin:mani-tides:tides-http', installScope: 'user', version: '1.2.0', path: '/plugins/tides/.mcp.json', transport: 'http', address: 'literal', sameAddressAs: null } as const;
const pluginEndpoint = { plugin: 'key-tides@harbour-market', pluginName: 'mani-tides', server: 'tides-http', name: 'plugin:mani-tides:tides-http', version: '1.2.0', path: '/plugins/tides/.mcp.json', transport: 'http', url: 'https://tides.example.com/mcp', revision: 'a'.repeat(32) } as const;

// Representative answers of each build
const F_INVENTORY = { skills: [skill], servers: [server], warnings: [COVERAGE], serversRead: true };
const F_ENDPOINTS = { servers: [endpoint] };
const THIS_INVENTORY = { skills: [{ ...skill, pluginName: 'mani-tides' }], servers: [server], warnings: [COVERAGE], serversRead: true, pluginServers: [pluginServer], plugins: [{ plugin: 'key-tides@harbour-market', pluginName: 'mani-tides', installScope: 'user' }] };
const THIS_ENDPOINTS = { servers: [{ ...endpoint, revision: 'b'.repeat(32) }], pluginServers: [pluginEndpoint] };

describe('Customize’s reads of the engine host, between builds (UX wave U11h)', () => {
  it('this build’s answers are its own schemas’', () => {
    expect(commands['customization.inventory'].output.parse(THIS_INVENTORY)).toEqual(THIS_INVENTORY);
    expect(commands['customization.serverEndpoints'].output.parse(THIS_ENDPOINTS)).toEqual(THIS_ENDPOINTS);
  });

  it('build F reads this build’s inventory with only what it does not know dropped: the skill’s plugin name and the two lists', () => {
    expect(BUILD_F_INVENTORY.safeParse(THIS_INVENTORY).success).toBe(false); // strict: F refuses the keys outright
    const read = readTolerant(BUILD_F_INVENTORY, THIS_INVENTORY);
    expect(read.ok && read.value).toEqual(F_INVENTORY);
    expect(read.ok && [...read.dropped].sort()).toEqual(['pluginServers', 'plugins', 'skills.0.pluginName']);
  });

  it('build F reads this build’s endpoints with only what it does not know dropped: the revision and the plugins’ connectors', () => {
    const read = readTolerant(BUILD_F_ENDPOINTS, THIS_ENDPOINTS);
    expect(read.ok && read.value).toEqual(F_ENDPOINTS);
    expect(read.ok && [...read.dropped].sort()).toEqual(['pluginServers', 'servers.0.revision']);
  });

  it('this build reads build F’s answers as they are: no plugin’s connector, the coverage mark as F sends it', () => {
    const inventory = commands['customization.inventory'].output.parse(F_INVENTORY);
    expect(inventory).toEqual(F_INVENTORY);
    expect(inventory.pluginServers).toBeUndefined();
    expect(inventory.warnings).toEqual([COVERAGE]);
    expect(CUSTOMIZATION_INVENTORY_COVERAGE).toBe(COVERAGE); // the mark on the wire keeps its value
    const endpoints = commands['customization.serverEndpoints'].output.parse(F_ENDPOINTS);
    expect(endpoints).toEqual(F_ENDPOINTS);
    expect(endpoints.pluginServers).toBeUndefined();
  });
});
