// The display helpers of the Push and PR sheets (E6 execution document, Design §8): the command as a shell would read
// it, for display only (main spawns the plan's argv with no shell), and a push destination as the sheet names it.
import { describe, expect, it } from 'vitest';
import { destinationLabel, shellWords } from './copy';

describe('shellWords quotes the plan for display', () => {
  it('leaves plain words bare', () => {
    expect(shellWords('/usr/bin/git', ['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main'])).toBe(
      '/usr/bin/git push --progress --recurse-submodules=no origin refs/heads/main:refs/heads/main',
    );
  });

  it('quotes spaces, quotes and empty arguments as one word each', () => {
    expect(shellWords('/opt/gh', ['pr', 'create', '--title=Panel PR', '--body=', ''])).toBe("/opt/gh pr create '--title=Panel PR' --body= ''");
    expect(shellWords('/opt/gh', ["--title=it's here"])).toBe("/opt/gh '--title=it'\\''s here'");
    expect(shellWords('/opt/gh', ['--body=line one\nline two', '$HOME', 'a;b', '*'])).toBe("/opt/gh '--body=line one\nline two' '$HOME' 'a;b' '*'");
  });

  it('quotes a program path with a space', () => {
    expect(shellWords('/Applications/My Tools/gh', ['--version'])).toBe("'/Applications/My Tools/gh' --version");
  });
});

describe('destinationLabel names where a push goes', () => {
  it('reads a URL as host and path without the scheme and .git', () => {
    expect(destinationLabel('https://github.com/o/r.git')).toBe('github.com/o/r');
    expect(destinationLabel('ssh://github.com/o/r.git')).toBe('github.com/o/r');
    expect(destinationLabel('https://ghe.example.com:8443/team/r')).toBe('ghe.example.com:8443/team/r');
  });

  it('reads an scp-like address as host and path', () => {
    expect(destinationLabel('git@github.com:o/r.git')).toBe('github.com/o/r');
  });

  it('keeps a local path as it is, .git included', () => {
    expect(destinationLabel('/tmp/scratch/origin.git')).toBe('/tmp/scratch/origin.git');
    expect(destinationLabel('file:///tmp/scratch/origin.git')).toBe('/tmp/scratch/origin.git');
    expect(destinationLabel('../origin.git')).toBe('../origin.git');
  });
});
