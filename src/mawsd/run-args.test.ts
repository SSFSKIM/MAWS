import { describe, expect, it } from 'vitest';
import { parseRun } from './run-args';

describe('mawsd run’s arguments', () => {
  it('takes one kind and an absolute directory, in either order', () => {
    expect(parseRun(['--unit', '--dir', '/p/mawsd'])).toEqual({ kind: 'unit', dir: '/p/mawsd' });
    expect(parseRun(['--dir', '/p/mawsd', '--private'])).toEqual({ kind: 'private', dir: '/p/mawsd' });
  });

  it('refuses a missing or doubled kind, a missing or relative directory, and anything else', () => {
    expect(parseRun(['--dir', '/p/mawsd'])).toBe('run needs --unit or --private');
    expect(parseRun(['--unit', '--private', '--dir', '/p/mawsd'])).toBe('run takes one of --unit and --private');
    expect(parseRun(['--unit'])).toBe('run needs --dir <profile>/mawsd');
    expect(parseRun(['--unit', '--dir'])).toBe('--dir needs a directory');
    expect(parseRun(['--unit', '--dir', 'p/mawsd'])).toBe('--dir needs an absolute path, not p/mawsd');
    expect(parseRun(['--unit', '--dir', '/p/mawsd', '--verbose'])).toBe('run does not take --verbose');
  });
});
