// The route classes against the registry (P5 O6 M2): a new command lands in a class its author sees in this file's
// snapshot (`routes.json`, rewritten only with MAWS_ROUTES_WRITE=1), and `PATH_COMMANDS`, the zod-free list the bridge's
// types read, is exactly the computed `path` class.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { AppSessionIdSchema, ProjectIdSchema, SessionIdSchema } from '../graph/ids';
import { REGISTRY } from './registry';
import { classify, PATH_COMMANDS, routeOf, type RouteClass } from './routes';
import type { CommandName } from './schema';

const SNAPSHOT = join(__dirname, 'routes.json');
const computed = (): Record<RouteClass, string[]> => {
  const classes: Record<RouteClass, string[]> = { client: [], addressed: [], path: [], 'machine-wide': [] };
  for (const name of Object.keys(REGISTRY.commands).sort()) classes[routeOf(name as CommandName)].push(name);
  return classes;
};

describe('route classes', () => {
  it('match the committed snapshot of every class', () => {
    const now = computed();
    if (process.env.MAWS_ROUTES_WRITE === '1') writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 1)}\n`);
    expect(now).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  });

  it('list in PATH_COMMANDS exactly the path class', () => {
    expect([...PATH_COMMANDS].sort()).toEqual(computed().path);
  });

  it('class a command graded client as client, whatever its input carries', () => {
    expect(routeOf('attention.viewing')).toBe('client');
    expect(routeOf('browser.tabs.list')).toBe('client');
  });

  it('class an input that always carries one of the four ids as addressed, and one that may not as path or machine-wide', () => {
    const cases: [z.ZodType, RouteClass][] = [
      [z.strictObject({ appSessionId: AppSessionIdSchema }), 'addressed'],
      [z.strictObject({ spec: z.strictObject({ appSessionId: AppSessionIdSchema, cwd: z.string() }) }), 'addressed'],
      [z.strictObject({ ids: z.array(AppSessionIdSchema).min(1) }), 'addressed'],
      [z.union([z.strictObject({ appSessionId: AppSessionIdSchema }), z.strictObject({ projectId: ProjectIdSchema })]), 'addressed'],
      [z.strictObject({ ids: z.array(AppSessionIdSchema) }), 'machine-wide'], // an empty list names no machine
      [z.strictObject({ appSessionId: AppSessionIdSchema.nullable(), directory: z.string() }), 'path'],
      [z.strictObject({ appSessionId: AppSessionIdSchema.optional(), cwd: z.string() }), 'path'],
      [z.union([z.strictObject({ appSessionId: AppSessionIdSchema }), z.strictObject({ directory: z.string() })]), 'path'],
      [z.strictObject({ sessionId: SessionIdSchema }), 'path'],
      [z.strictObject({ engineSessionIds: z.array(z.string()) }), 'path'],
      [z.strictObject({ theme: z.string() }), 'machine-wide'],
      [z.void(), 'machine-wide'],
    ];
    for (const [schema, expected] of cases) expect(classify('fixture.command', schema)).toBe(expected);
  });
});
