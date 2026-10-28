// P4-AGG acceptance 12 (the Discover spec, "What agents see"; the owner's ruling, 2026-10-24): Discover is for the
// person. No MCP tool name, no text MAWS gives the model, no engine launch argument or environment variable built by
// MAWS mentions the catalog, and nothing an agent's session is built from imports it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { MAWS_SERVER_INSTRUCTIONS } from '@shared/maws/instructions';
import { MAWS_TOOL_NAMES } from '@shared/maws/tools';
import { TO_HUMAN_SUPPLEMENT } from '@shared/owner/contract';
import { buildLaunch, ENGINE_FLAGS } from '../../engine-host/launch';
import { CATALOG_FIXTURES_ENV } from './fetch';
import { CATALOG_TEST_SOURCES_ENV } from './sources';

const CATALOG_WORDS = /\bdiscover\b|\bcatalog\b|catalog\.|marketplace|plugin-icons|directory\/plugins|directory\/servers|MAWS_CATALOG/i;
const SRC = resolve(__dirname, '../..');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe('what agents see of the catalog: nothing', () => {
  it('no MAWS tool is named for it', () => {
    expect(MAWS_TOOL_NAMES.filter((name) => CATALOG_WORDS.test(name))).toEqual([]);
  });

  it('no text MAWS gives the model mentions it: the server’s instructions and the to-human supplement', () => {
    for (const [name, text] of Object.entries({ MAWS_SERVER_INSTRUCTIONS, TO_HUMAN_SUPPLEMENT })) expect(text.match(CATALOG_WORDS), name).toBeNull();
  });

  it('no launch argument or environment variable carries it, even when main runs with the catalog’s seams set', () => {
    const spec = LaunchSpecSchema.parse({ appSessionId: 'app-1', cwd: '/tmp/maws-agents', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null, resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null });
    const captured = { PATH: '/usr/bin', HOME: '/tmp/home', [CATALOG_FIXTURES_ENV]: '/tmp/fixtures', [CATALOG_TEST_SOURCES_ENV]: '/tmp/sources.json' };
    const plan = buildLaunch(spec, captured, { relayUrl: 'http://127.0.0.1:8641', bin: '/opt/claude', engineVersion: '2.1.309', spawnerPid: 1, sdkMcpServers: ['maws'] });
    expect([...ENGINE_FLAGS, ...plan.args].filter((arg) => CATALOG_WORDS.test(arg))).toEqual([]);
    expect(Object.keys(plan.env).filter((key) => CATALOG_WORDS.test(key))).toEqual([]);
    expect(Object.values(plan.env).filter((value) => CATALOG_WORDS.test(value))).toEqual([]);
  });

  it('nothing an agent’s session is built from imports it: the engine host, the MAWS tools, the owner channel, the launch spec', () => {
    const importing = ['engine-host', 'shared/maws', 'shared/owner', 'shared/engine'].flatMap((dir) =>
      sources(join(SRC, dir)).filter((path) => /from\s+'[^']*(?:schema\/catalog|main\/catalog|customize\/discover)'/.test(readFileSync(path, 'utf8'))),
    );
    expect(importing.map((path) => relative(SRC, path))).toEqual([]);
  });
});
