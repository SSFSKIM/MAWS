// The permission card's first line by the tool's class (UX wave U1a, §D): what is asked, in the card's words.
import { describe, expect, it } from 'vitest';
import { permission, syntheticRequest, type PermissionEvent } from './test-requests';
import { askedLine, pathIn, toolVerb } from './tools';

const ask = (toolName: string, input: unknown, over: Partial<PermissionEvent> = {}) => askedLine(permission({ toolName, displayName: toolName, input, ...over }));

describe('the first line of a permission prompt', () => {
  it.each([
    ['Bash', { command: 'ls -la', description: 'List the folder' }, 'Run a command'],
    ['Read', { file_path: '/w/notes.txt' }, 'Read a file'],
    ['NotebookRead', { notebook_path: '/w/n.ipynb' }, 'Read a file'],
    ['LS', { path: '/w' }, 'Read a file'],
    ['Glob', { pattern: '**/*.ts' }, 'Search files'],
    ['Grep', { pattern: 'TODO', path: '/w' }, 'Search files'],
    ['WebFetch', { url: 'https://example.com/page' }, 'Fetch a page'],
    ['WebSearch', { query: 'release notes' }, 'Search the web'],
  ])('%s reads "%s"', (tool, input, line) => expect(ask(tool, input)).toBe(line));

  it('names the file a file tool changes: Write writes it, the others edit it (M4 decides Create from the file read)', () => {
    expect(ask('Edit', { file_path: '/w/src/app.ts', old_string: 'a', new_string: 'b' })).toBe('Edit app.ts');
    expect(ask('Write', { file_path: '/w/src/new.ts', content: 'x' })).toBe('Write new.ts');
    expect(ask('NotebookEdit', { notebook_path: '/w/analysis.ipynb', new_source: 'x' })).toBe('Edit analysis.ipynb');
    expect(ask('MultiEdit', { file_path: '/w/a.ts', edits: [{ old_string: 'a', new_string: 'b' }] })).toBe('Edit a.ts');
  });

  it('says "Create" for a file the diff creates and "Edit" for one it changes, whatever the tool (M4, §I)', () => {
    const write = permission({ toolName: 'Write', displayName: 'Write', input: { file_path: '/w/src/new.ts', content: 'x' } });
    expect(askedLine(write, { kind: 'diff', change: 'create', hunks: [] })).toBe('Create new.ts');
    expect(askedLine(write, { kind: 'diff', change: 'update', hunks: [] })).toBe('Edit new.ts');
    expect(askedLine(write, { kind: 'input' })).toBe('Write new.ts');
    const edit = permission({ toolName: 'Edit', displayName: 'Edit', input: { file_path: '/w/src/app.ts', old_string: 'a', new_string: 'b' } });
    expect(askedLine(edit, { kind: 'input' })).toBe('Edit app.ts');
    expect(askedLine(edit, { kind: 'diff', change: 'update', hunks: [] })).toBe('Edit app.ts');
  });

  it('counts the files when the call names several', () => {
    const input = { file_path: '/w/a.ts', edits: [{ file_path: '/w/b.ts', old_string: 'a', new_string: 'b' }, { file_path: '/w/c.ts', old_string: 'c', new_string: 'd' }] };
    expect(ask('MultiEdit', input)).toBe('Edit 3 files');
  });

  it('says "a file" when a file tool names none', () => {
    expect(ask('Edit', { old_string: 'a', new_string: 'b' })).toBe('Edit a file');
    expect(ask('Write', {})).toBe('Write a file');
  });

  it('names an MCP tool by its server and its own name', () => {
    expect(askedLine(syntheticRequest('mcp-permission') as PermissionEvent)).toBe('Use github · create_issue');
    expect(ask('mcp__notes__append', { text: 'x' }, { displayName: 'append' })).toBe('Use notes · append');
  });

  it('names any other tool by its display name', () => {
    expect(ask('Task', { prompt: 'x' }, { displayName: 'Agent' })).toBe('Use Agent');
    expect(ask('ExitWorktree', {}, { displayName: null })).toBe('Use ExitWorktree');
  });

  it('shows a path relative to the working folder when it lies inside it, else whole (M4, §I)', () => {
    expect(pathIn('/w/proj/src/a.ts', '/w/proj')).toBe('src/a.ts');
    expect(pathIn('/w/proj/src/a.ts', '/w/proj/')).toBe('src/a.ts');
    expect(pathIn('/w/project-two/a.ts', '/w/proj')).toBe('/w/project-two/a.ts');
    expect(pathIn('/w/proj', '/w/proj')).toBe('/w/proj');
    expect(pathIn('/elsewhere/a.ts', '/w/proj')).toBe('/elsewhere/a.ts');
    expect(pathIn('/w/proj/a.ts', null)).toBe('/w/proj/a.ts');
    expect(pathIn('/w/proj/a.ts', '')).toBe('/w/proj/a.ts'); // a record that names no folder
  });

  it('keeps the verb desk web reads', () => {
    expect(toolVerb(permission())).toBe('run a command');
  });
});
