// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §A "The splitter"): a local
// command's Arguments line split as a POSIX shell splits words, every row of §A's table, and nothing expanded.
import { describe, expect, it } from 'vitest';
import { splitArgs } from './argv-split';

const words = (line: string) => {
  const split = splitArgs(line);
  if (!split.ok) throw new Error(`refused ${JSON.stringify(line)}: ${split.problem}`);
  return split.args;
};

describe('splitArgs', () => {
  it('separates words at spaces and tabs outside quotes, any number being one separator, none at the ends making a word', () => {
    expect(words('--root /srv -v')).toEqual(['--root', '/srv', '-v']);
    expect(words('  a \t\t b   ')).toEqual(['a', 'b']);
    expect(words('a\tb')).toEqual(['a', 'b']);
  });

  it('takes a single-quoted part exactly, with no escape inside', () => {
    expect(words(`'a  b'`)).toEqual(['a  b']);
    expect(words(`'a\\b' '\\'`)).toEqual(['a\\b', '\\']);
    expect(words(`'say "hi"'`)).toEqual(['say "hi"']);
  });

  it('takes a double-quoted part with a backslash escaping only a quote, a backslash, a dollar or a backquote', () => {
    expect(words('"a  b"')).toEqual(['a  b']);
    expect(words('"say \\"hi\\""')).toEqual(['say "hi"']);
    expect(words('"a\\\\b"')).toEqual(['a\\b']);
    expect(words('"\\$HOME" "\\`x\\`"')).toEqual(['$HOME', '`x`']);
    expect(words('"a\\nb" "\\x"')).toEqual(['a\\nb', '\\x']); // any other character keeps its backslash
    expect(words(`"it's"`)).toEqual(["it's"]);
  });

  it('takes a backslash outside quotes as the next character itself, a space included', () => {
    expect(words('my\\ files x')).toEqual(['my files', 'x']);
    expect(words('\\"a\\\' \\\\')).toEqual(['"a\'', '\\']);
    expect(words('\\$NAME')).toEqual(['$NAME']);
  });

  it('joins quoted and unquoted parts with no space between into one word', () => {
    expect(words('a"b c"d')).toEqual(['ab cd']);
    expect(words(`--root="/tmp/my files" -x'y z'`)).toEqual(['--root=/tmp/my files', '-xy z']);
  });

  it('reads a lone pair of quotes as one empty word', () => {
    expect(words(`'' ""`)).toEqual(['', '']);
    expect(words(`a '' b`)).toEqual(['a', '', 'b']);
  });

  it('expands nothing: a variable, a glob, a tilde and a backquote are themselves', () => {
    expect(words('$NAME ${NAME} ${NAME:-x} * ~ ~/x `date` $(date)')).toEqual(['$NAME', '${NAME}', '${NAME:-x}', '*', '~', '~/x', '`date`', '$(date)']);
    expect(words('"${HOME}/*"')).toEqual(['${HOME}/*']);
  });

  it('refuses a line that ends inside a quote or on a lone backslash, naming the problem', () => {
    expect(splitArgs(`a 'b`)).toEqual({ ok: false, problem: 'open-single-quote' });
    expect(splitArgs('a "b')).toEqual({ ok: false, problem: 'open-double-quote' });
    expect(splitArgs('"a\\"')).toEqual({ ok: false, problem: 'open-double-quote' }); // the escaped quote leaves it open
    expect(splitArgs('a \\')).toEqual({ ok: false, problem: 'trailing-backslash' });
    expect(splitArgs('a\\\\')).toEqual({ ok: true, args: ['a\\'] }); // an escaped backslash is not lone
  });

  it('answers no words for an empty line or one of spaces only', () => {
    expect(splitArgs('')).toEqual({ ok: true, args: [] });
    expect(splitArgs('  \t ')).toEqual({ ok: true, args: [] });
  });

  it('splits the acceptance line into three boxes (G4)', () => {
    expect(words('--root "/tmp/my files" -v')).toEqual(['--root', '/tmp/my files', '-v']);
  });
});
