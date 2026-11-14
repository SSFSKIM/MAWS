// UX wave U2 (O-49; the U2a document, M3, Interfaces §D): the short form of a shell call's command, as Claude Desktop's
// rule makes it, one case per branch of that function (`web/app/v1/c52b02f3f-C1Vcib4H.js:1675-1714` of app 5.1231.2)
// and of the refusals it calls. Every command is invented; a credential-shaped word is built at run time, so no file of
// the repository holds one.
import { describe, expect, it } from 'vitest';
import { shortCommand } from './short-command';

describe('shortCommand: what it shows', () => {
  it('a short command whole, its words joined by one space', () => {
    expect(shortCommand('pnpm test')).toBe('pnpm test');
    expect(shortCommand('  git   status  ')).toBe('git status');
  });

  it('drops a leading `cd … &&` (or `;`), however many', () => {
    expect(shortCommand('cd /repo && pnpm test')).toBe('pnpm test');
    expect(shortCommand("cd 'my repo'; cd src && ls")).toBe('ls');
  });

  it('four words at most, with `…` when it cut', () => {
    expect(shortCommand('git log main feature extra')).toBe('git log main feature…');
    expect(shortCommand('git log main feature')).toBe('git log main feature');
  });

  it('cuts at the first word it refuses to show: a flag, a URL, an operator, a quote', () => {
    expect(shortCommand('git commit -m wip')).toBe('git commit…');
    expect(shortCommand('git clone https://git.example.org/a.git')).toBe('git clone…');
    expect(shortCommand('git log | head')).toBe('git log…');
    expect(shortCommand('git commit "wip"')).toBe('git commit…');
  });

  it('shows the first line only, and says that more follows', () => {
    expect(shortCommand('pnpm install\npnpm test')).toBe('pnpm install…');
    expect(shortCommand('\n\n  pnpm test\n')).toBe('pnpm test');
  });

  it('drops a trailing line continuation before the next line', () => {
    expect(shortCommand('pnpm test \\\n  --watch')).toBe('pnpm test…');
  });

  it('keeps the last argument after the `…` for a read-only file command (cat, head, tail, grep, rg, sed)', () => {
    expect(shortCommand('cat -n notes.txt')).toBe('cat … notes.txt');
    expect(shortCommand('head -n 20 src/notes.txt')).toBe('head … notes.txt');
    expect(shortCommand('grep -rn TODO src/app.ts')).toBe('grep … app.ts');
    expect(shortCommand("sed -n '1,20p' src/app.ts")).toBe('sed … app.ts');
    expect(shortCommand('tail -n 5 build.log 2>/dev/null')).toBe('tail … build.log…');
  });

  it('keeps no last argument when the file names something credential-like, is no file name, or the command writes', () => {
    expect(shortCommand('cat -n secrets.txt')).toBe('cat…');
    expect(shortCommand('cat -n notes')).toBe('cat…');
    expect(shortCommand("sed -i 's/a/b/' notes.txt")).toBe('sed…');
    expect(shortCommand('cat -n notes.txt > copy.txt')).toBe('cat…');
  });

  it('ignores an assignment, `time` or `nice` before the command when it asks whether the command is known', () => {
    expect(shortCommand('time pnpm test')).toBe('time pnpm test');
    expect(shortCommand('nice make')).toBe('nice make');
    expect(shortCommand('nice -n 5 make')).toBeNull(); // the flag is the first word it asks about
  });
});

describe('shortCommand: what it refuses whole (null)', () => {
  it('an empty command', () => {
    expect(shortCommand('')).toBeNull();
    expect(shortCommand(' \n\t ')).toBeNull();
  });

  it('a command it does not know, anywhere on the line', () => {
    expect(shortCommand('./deploy.sh production')).toBeNull();
    expect(shortCommand('pnpm test && ./deploy.sh')).toBeNull();
  });

  it('a command substitution or a process substitution', () => {
    expect(shortCommand('git log $(cat ref)')).toBeNull();
    expect(shortCommand('diff <(ls a) <(ls b)')).toBeNull();
  });

  it('a first word it would not show', () => {
    expect(shortCommand('FOO=1 pnpm test')).toBeNull();
  });

  it('a credential: a bearer header, a named secret, a user and password, a login', () => {
    expect(shortCommand('curl -H "Authorization: Bearer abc" https://api.example.org')).toBeNull();
    expect(shortCommand('git config --global user.password hunter')).toBeNull();
    expect(shortCommand('git clone https://ann:pw@git.example.org/a.git')).toBeNull();
    expect(shortCommand('gh auth status')).toBeNull();
  });

  it('a path into the engine’s own projects or an agent’s memory', () => {
    expect(shortCommand('ls ~/.claude/projects/repo')).toBeNull();
    expect(shortCommand('cat /srv/work/.claude/agent-memory/notes.md')).toBeNull();
    expect(shortCommand('cd /srv/work/.claude && cat agent-memory/notes.md')).toBeNull(); // the directory a `cd` entered
  });

  it('a control, bidirectional or invisible character, or whitespace other than a space', () => {
    expect(shortCommand('git log\u202e')).toBeNull();
    expect(shortCommand('git\u200blog')).toBeNull();
    expect(shortCommand('git\u00a0log')).toBeNull();
    expect(shortCommand('git log \u0007')).toBeNull();
  });
});

describe('shortCommand: a token of a known service', () => {
  // `xoxb-` and four short groups: no run of twenty letters and digits, so only the token rule sees it
  const token = ['xo', 'xb', '-1234', '-5678', '-abcd'].join('');

  it('is cut where it stands among the shown words', () => {
    expect(shortCommand(`git clone ${token}`)).toBe('git clone…');
  });

  it('a long mixed run of letters and digits is cut too, whatever service it is', () => {
    expect(shortCommand(`git show ${'a1'.repeat(12)}`)).toBe('git show…');
  });

  it('is cut when glued into a word behind a digit or an underscore', () => {
    const glued = [
      ['sk', 'ant', ''].join('-') + 'a'.repeat(24),
      ['xo', 'xb-'].join('') + 'b'.repeat(12),
      ['gh', 'p_'].join('') + 'c'.repeat(24),
    ];
    for (const token of glued) {
      expect(shortCommand(`git show 1${token}`)).toBe('git show…');
      expect(shortCommand(`git show x_${token}`)).toBe('git show…');
    }
  });
});

describe('shortCommand: PowerShell', () => {
  it('reads its own line continuation and keeps no last argument', () => {
    expect(shortCommand('git status `\n  --short', 'PowerShell')).toBe('git status…');
    expect(shortCommand('cat -n notes.txt', 'PowerShell')).toBe('cat…');
  });
});
