// UX wave U1a §H (A14): what a waiting request offers away from its session's pane, row by row of the table and per
// surface. The first row that fits decides.
import { describe, expect, it } from 'vitest';
import { ev } from '../../../test/support/events';
import { NOTIFICATION_COMMAND_MAX, outsideAnswers, shownCommand, type OutsideSurface } from './outside-answers';

const SURFACES: readonly OutsideSurface[] = ['notification', 'hover'];
const BOTH = { allowOnce: true, deny: true };
const DENY_ONLY = { allowOnce: false, deny: true };
const NEITHER = { allowOnce: false, deny: false };

const permission = (toolName: string, input: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ev('permission.requested', { toolName, input, ...over });
const command = (text: string, over: Record<string, unknown> = {}) => permission('Bash', { command: text }, over);
const of = (length: number) => 'echo '.padEnd(length, 'x');

describe('what may be answered from outside a session’s pane', () => {
  it.each(SURFACES)('offers nothing for a request that is not a permission, or none read (%s)', (surface) => {
    expect(outsideAnswers(null, surface)).toEqual(NEITHER);
    expect(outsideAnswers(ev('question.requested', { questions: [] }), surface)).toEqual(NEITHER);
    expect(outsideAnswers(ev('plan.requested', { plan: '1. Split the parser' }), surface)).toEqual(NEITHER);
  });

  it.each(SURFACES)('offers Deny alone on a request flagged “default to no” or needing its own consent surface, a read-only tool’s included (%s)', (surface) => {
    expect(outsideAnswers(permission('Read', { file_path: '/w/notes.txt' }, { defaultToNo: true }), surface)).toEqual(DENY_ONLY);
    expect(outsideAnswers(permission('Read', { file_path: '/w/notes.txt' }, { requiresUserInteraction: true }), surface)).toEqual(DENY_ONLY);
    expect(outsideAnswers(command('ls', { defaultToNo: true }), surface)).toEqual(DENY_ONLY);
  });

  it.each(SURFACES)('offers Allow once and Deny on a read-only tool (%s)', (surface) => {
    for (const tool of ['Read', 'Glob', 'Grep', 'WebFetch']) expect(outsideAnswers(permission(tool), surface), tool).toEqual(BOTH);
  });

  it('on a notification, allows a command of one line and at most 120 characters, and only denies a longer one', () => {
    expect(NOTIFICATION_COMMAND_MAX).toBe(120);
    expect(outsideAnswers(command(of(120)), 'notification')).toEqual(BOTH);
    expect(outsideAnswers(command(of(121)), 'notification')).toEqual(DENY_ONLY);
    expect(outsideAnswers(command('cd /w\nmake build'), 'notification')).toEqual(DENY_ONLY);
    expect(outsideAnswers(command('make build\r'), 'notification')).toEqual(DENY_ONLY);
  });

  it('on the hover card, allows any command, since its preview scrolls', () => {
    expect(outsideAnswers(command(of(121)), 'hover')).toEqual(BOTH);
    expect(outsideAnswers(command(of(4000)), 'hover')).toEqual(BOTH);
    expect(outsideAnswers(command('cd /w\nmake build'), 'hover')).toEqual(BOTH);
  });

  it.each(SURFACES)('offers Deny alone on a file change, an MCP tool, an agent launch, and a shell call that names no command (%s)', (surface) => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__tracker__create_issue', 'Task']) expect(outsideAnswers(permission(tool), surface), tool).toEqual(DENY_ONLY);
    expect(outsideAnswers(permission('Bash', {}), surface)).toEqual(DENY_ONLY);
  });

  it('names the command a surface shows whole, and none it does not', () => {
    expect(shownCommand(command('make build'), 'notification')).toBe('make build');
    expect(shownCommand(command(of(121)), 'notification')).toBeNull();
    expect(shownCommand(command(of(121)), 'hover')).toBe(of(121));
    expect(shownCommand(permission('Read', { file_path: '/w/notes.txt' }), 'hover')).toBeNull();
    expect(shownCommand(null, 'hover')).toBeNull();
  });
});
