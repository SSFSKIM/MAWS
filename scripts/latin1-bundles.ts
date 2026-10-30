// Main-process, host and preload bundles as Latin-1 text. Node keeps every loaded file's source in the heap for V8's
// lazy compilation, and one character above U+00FF anywhere in a file (a log line's ’, a comment's —) makes V8 hold the
// whole file at two bytes a character: the engine host's 4.5 M characters are 9 MB as UTF-16, 4.5 MB as Latin-1.
//
// esbuild re-prints a file holding such a character with `charset: 'ascii'`, which escapes it wherever an escape means
// the same thing: strings, untagged templates, identifiers. It leaves three places verbatim, and acorn's parse of the
// re-print finds each: comments, written out as `\uXXXX` text (inert there); regular expression literals, where
// `\uXXXX` matches the same code unit (`\` before the character, an identity escape, folds into it); and tagged
// templates (`String.raw` among them), whose raw text an escape would change, so one there fails the build, as does
// any character found anywhere else. The output plugin re-prints each chunk and fails the build if any emitted `.js`
// file, a `?modulePath` host's included, still holds a character above U+00FF.
import { parse, type Options, type Token } from 'acorn';
import { transform } from 'esbuild';
import type { Rollup } from 'vite';

const ABOVE_LATIN1 = /[\u0100-\uffff]/;
const ABOVE_LATIN1_ALL = /[\u0100-\uffff]/g;

const escape = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;

// Line and column (1-based) of an offset, for an error that names the place
function where(code: string, at: number): string {
  const before = code.slice(0, at);
  const line = before.split('\n').length;
  return `${line}:${at - before.lastIndexOf('\n')}`;
}

// The ranges of a program's comments and regular expression literals, sorted by start
function inertRanges(code: string): { comments: [number, number][]; regexps: [number, number][] } {
  const comments: [number, number][] = [];
  const regexps: [number, number][] = [];
  const options: Options = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    onComment: (_block: boolean, _text: string, start: number, end: number) => comments.push([start, end]),
    onToken: (token: Token) => {
      if (token.type.label === 'regexp') regexps.push([token.start, token.end]);
    },
  };
  try {
    parse(code, { ...options, sourceType: 'script' });
  } catch {
    comments.length = 0;
    regexps.length = 0;
    parse(code, { ...options, sourceType: 'module' });
  }
  return { comments, regexps };
}

function within(ranges: [number, number][], at: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid];
    if (at < start) hi = mid - 1;
    else if (at >= end) lo = mid + 1;
    else return true;
  }
  return false;
}

// `code` with no character above U+00FF and the same meaning; throws, naming the place, where that cannot be shown.
// A file already within Latin-1 comes back as it is.
export async function toLatin1(code: string, name = 'bundle'): Promise<string> {
  if (!ABOVE_LATIN1.test(code)) return code;
  const { code: printed } = await transform(code, { loader: 'js', charset: 'ascii', legalComments: 'inline' });
  if (!ABOVE_LATIN1.test(printed)) return printed;
  const { comments, regexps } = inertRanges(printed);
  let out = '';
  let from = 0;
  for (const match of printed.matchAll(ABOVE_LATIN1_ALL)) {
    const at = match.index;
    const c = match[0];
    if (within(comments, at)) {
      out += printed.slice(from, at) + escape(c);
    } else if (within(regexps, at)) {
      let slashes = 0;
      while (printed[at - 1 - slashes] === '\\') slashes++;
      // An odd run of backslashes ends in an identity escape (`\—`, Annex B), which `\u2014` replaces whole
      out += printed.slice(from, slashes % 2 === 1 ? at - 1 : at) + escape(c);
    } else {
      const shown = JSON.stringify(printed.slice(Math.max(0, at - 40), at + 40));
      throw new Error(`${name}:${where(printed, at)}: U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} outside a comment or regular expression (a tagged template's raw text?) cannot be escaped without changing the program: ${shown}`);
    }
    from = at + 1;
  }
  return out + printed.slice(from);
}

const sourceText = (file: Rollup.OutputChunk | Rollup.OutputAsset): string =>
  file.type === 'chunk' ? file.code : typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);

// The output plugin: each chunk re-printed as it renders, and every emitted `.js` file checked as the bundle is written
export function latin1Bundles(): Rollup.OutputPlugin {
  return {
    name: 'maws:latin1-bundles',
    renderStart(options) {
      // The re-print carries no source map through; none is built today (electron-vite's main and preload default)
      if (options.sourcemap) this.error('latin1-bundles re-prints chunks without chaining source maps; chain them before turning `sourcemap` on');
    },
    async renderChunk(code, chunk) {
      try {
        return await toLatin1(code, chunk.fileName);
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (!file.fileName.endsWith('.js')) continue;
        const text = sourceText(file);
        const at = text.search(ABOVE_LATIN1);
        if (at !== -1) this.error(`${file.fileName}:${where(text, at)}: a character above U+00FF survived the Latin-1 re-print (V8 would hold the whole file at two bytes a character)`);
      }
    },
  };
}
