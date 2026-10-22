// The bridge's route table as the fake machine applies it (the desk control surface spec, §2 and Interfaces, "The route
// table"), over the fixture vendored from doperpowers: the five rows M0 enables run, and every other class is refused
// with its reason before anything runs — a panel, a routed command, a follow, a drop, a local one, args out of form, a
// row not enabled yet, the bridge's own plugin, and a name no session lists.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Commands, defaultOutcome, listedOf, loadRoutes, ROUTES_2_1_307, routeOf } from '../../fake-machine';

const table = loadRoutes();
const check = (name: string, args = '') => routeOf(table, listedOf(table, name), name, args, 'mini');

describe('the vendored route fixture', () => {
  it('is the 2.1.307 table the README names, byte for byte', () => {
    const readme = readFileSync(join(ROUTES_2_1_307, '..', 'README.md'), 'utf8');
    const sha = createHash('sha256').update(readFileSync(ROUTES_2_1_307)).digest('hex');
    expect(readme).toContain(sha);
    expect(table.engine).toBe('2.1.307');
    expect(table.entries.length).toBeGreaterThan(60);
  });
});

describe('routeOf', () => {
  it('runs the five rows M0 enables, in their measured forms', () => {
    for (const [name, args] of [['rename', 'desk-m0'], ['color', 'red'], ['reload-plugins', ''], ['reload-skills', ''], ['mcp', 'disable github'], ['mcp', 'enable github'], ['mcp', 'reconnect github']]) {
      expect(check(name, args), `${name} ${args}`).toMatchObject({ ok: true, route: { class: 'run', enabled: true } });
    }
    // Trimmed args decide the form.
    expect(check('rename', '  desk-m0  ')).toMatchObject({ ok: true });
  });

  it("refuses args out of form with the row's hint, or what its forms say", () => {
    expect(check('rename')).toEqual({ ok: false, code: 'bad-args', reason: 'a name is needed' });
    expect(check('rename', '   ')).toEqual({ ok: false, code: 'bad-args', reason: 'a name is needed' });
    expect(check('color', 'Red')).toMatchObject({ ok: false, code: 'bad-args' });
    expect(check('reload-plugins', 'now')).toEqual({ ok: false, code: 'bad-args', reason: 'it takes no arguments' });
    expect(check('mcp', 'restart github')).toMatchObject({ ok: false, code: 'bad-args' });
  });

  it('refuses each other class with its reason (A4)', () => {
    expect(check('usage')).toEqual({ ok: false, code: 'panel', reason: "opens a panel in the terminal; it would hold the session's queue" });
    expect(check('mcp')).toMatchObject({ ok: false, code: 'panel' });
    expect(check('model', 'sonnet')).toEqual({ ok: false, code: 'routed', reason: 'use Model instead: /model saves a default for new sessions' });
    expect(check('foo')).toEqual({ ok: false, code: 'unknown-builtin', reason: 'not a command this session knows' });
    expect(check('clear')).toMatchObject({ ok: false, code: 'follow', reason: 'changes the session id; following comes with M4' });
    expect(check('config', 'theme=dark')).toEqual({ ok: false, code: 'drop', reason: 'saves a default on mini; terminal only' });
    expect(check('recap')).toMatchObject({ ok: false, code: 'drop' });
    expect(check('copy')).toMatchObject({ ok: false, code: 'local' });
  });

  it('enables measured M1 forms, keeps exit disabled, and selects goal otherwise', () => {
    expect(check('cd', '/src/maws')).toMatchObject({ ok: true, route: { class: 'run' } });
    expect(check('exit')).toMatchObject({ ok: false, code: 'disabled' });
    expect(check('goal')).toMatchObject({ ok: false, code: 'panel' });
    expect(check('goal', 'clear')).toMatchObject({ ok: true, route: { class: 'run' } });
    expect(check('goal', 'ship the release')).toMatchObject({ ok: true, route: { class: 'run-prompt' } });
  });

  it("checks a route's forms before its class: arguments a non-run row's forms forbid are bad-args, not its class", () => {
    expect(check('clear')).toMatchObject({ ok: false, code: 'follow' });
    expect(check('clear', 'extra')).toEqual({ ok: false, code: 'bad-args', reason: 'it takes no arguments' });
  });

  it("routes a non-built-in as run-prompt (enabled with M1), a plugin exception by its row, and the bridge's own plugin as self", () => {
    expect(check('doperpowers:execspec', 'go')).toMatchObject({ ok: true, route: { class: 'run-prompt' } });
    expect(routeOf(table, { name: 'diff', source: 'plugin', plugin: 'cc-plugin-diff' }, 'diff', '', 'mini')).toMatchObject({ ok: false, code: 'panel' });
    expect(check('sminos:who')).toEqual({ ok: false, code: 'self', reason: 'run it from the terminal' });
    expect(routeOf(table, { name: 'brand-new', source: 'builtin' }, 'brand-new', '', 'mini')).toEqual({ ok: false, code: 'unknown-builtin', reason: 'not measured on 2.1.307' });
  });
});

describe('Commands', () => {
  it("plans an enabled command with the engine's line and an id, and refuses the rest", () => {
    const commands = new Commands();
    const rename = commands.plan('rename', 'desk-m0', 's', 'mini');
    expect(rename).toMatchObject({ ok: true, route: 'run', name: 'rename', args: 'desk-m0', outcome: { settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: desk-m0' }, title: 'desk-m0' } });
    expect(commands.plan('usage', '', 's', 'mini')).toMatchObject({ ok: false, code: 'panel' });
    // A plugin exception the session lists by its bare name (cc-plugin-diff's `/diff`) takes its row: a panel.
    expect(commands.plan('diff', '', 's', 'mini')).toEqual({ ok: false, code: 'panel', reason: "opens a panel in the terminal; it would hold the session's queue" });
    expect(defaultOutcome('reload-plugins', '')).toEqual({ readback: { how: 'effect' } });
    expect(defaultOutcome('reload-skills', '').readback.how).toBe('text');
    expect(defaultOutcome('mcp', 'disable github').readback).toMatchObject({ how: 'row', text: 'MCP server "github" disabled' });
  });

  it('takes a script in the place of the defaults, a refusal included', () => {
    const commands = new Commands({ color: () => ({ refuse: { code: 'stopped', reason: 'the session was stopped and nobody has sent input since' } }), rename: () => ({ settled: { ok: true }, readback: { how: 'none' } }) });
    expect(commands.plan('color', 'red', 's', 'mini')).toEqual({ ok: false, code: 'stopped', reason: 'the session was stopped and nobody has sent input since' });
    expect(commands.plan('rename', 'x', 's', 'mini')).toMatchObject({ ok: true, outcome: { readback: { how: 'none' } } });
  });
});
