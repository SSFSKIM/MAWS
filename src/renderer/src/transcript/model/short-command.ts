// UX wave U2 (O-49; the U2a document, M3, Interfaces §D): the short form of a shell call's command, for the row of a call
// that gave no description. A port of Claude Desktop's rule with its refusals, not a rule of MAWS's own: app 5.1231.2,
// `web/app/v1/c52b02f3f-C1Vcib4H.js`, its function `Ti` at :1675-1714 as its Bash and PowerShell label calls it (`fu`,
// :12354-12361; the label at :9084-9124). Each helper below names the one it ports, by file and line; the file's own
// helpers are at :1278-1674, and the six it imports from shared chunks are ported too: `p`, `u`, `Ge`, `w` and the path
// helpers of `hi` here, and `f` and `c`, the secret scanner Desktop shares with its other views, in secret-scan.ts.
//
// What it does: the first line of the command, a leading `cd … &&` dropped, at most four words, cut at the first word it
// will not show, `…` when cut or when more follows, and for a read-only file command the file's name kept after the `…`.
// It gives nothing (null) when it refuses the line or its first word: a command it does not know, a substitution, a
// credential, a path into the engine's projects or an agent's memory, a control or invisible character.

import { once, secretSpans, withSecretsHidden } from './secret-scan';

// ---------------------------------------------------------------------------------------------------------------------
// The file's constants (c52b02f3f-C1Vcib4H.js)

const MAX_CHARS = 8192; // :1278 `Mr`
const LEADING_CD = /^(?:cd +(?:'[^']*'|"[^"$`\\]*"|[\w./~:+,%-]+) *(?:&&|;) *)+(?=\S)/; // :1279 `Nr`
const CD_COMMANDS = new Set(['cd', 'pushd', 'sl', 'set-location', 'push-location']); // :1280 `Pr`
const MAX_CD_PATH = 512; // :1281 `Fr`
const SHORT_NAME_PATH = /[^\s/:~]~\d+(?:\.[^\s/:]*)?\/+[^\s/]/; // :1282 `Ir`
const KNOWN_COMMANDS = new Set( // :1283 `Lr`
  [
    'bun bunx node npm npx pnpm pnpx yarn deno tsc tsx vitest jest eslint oxlint prettier oxfmt turbo vite next',
    'playwright python python3 pip pip3 uv uvx poetry pytest ruff mypy black go cargo rustc rustup make cmake',
    'bazel gradle mvn swift xcodebuild dotnet git gh docker docker-compose kubectl helm ls cat head tail wc find',
    'fd rg grep sed awk jq tree du stat file diff sort uniq cut tr date sleep which mkdir rm mv cp touch chmod',
    'ln pwd cd get-childitem get-content select-string set-location push-location test-path new-item',
    'remove-item copy-item move-item dir',
  ].join(' ').split(' '),
);
const PREFIX_COMMANDS = new Set(['time', 'nice']); // :1295 `Rr`
const SHOWN_WORD = /^(?!-)[A-Za-z0-9._/~:+,@%-]+$/; // :1296 `zr`
const MAX_WORDS = 4; // :1297 `Br`
const LONG_FLAGS = new Set( // :1298 `Vr`
  ['count', 'extended-regexp', 'files-with-matches', 'fixed-strings', 'hidden', 'ignore-case', 'invert-match', 'line-number', 'no-filename',
    'no-heading', 'no-ignore', 'only-matching', 'recursive', 'smart-case', 'with-filename', 'word-regexp'].map((flag) => `--${flag}`),
);

interface FlagRules { plain: RegExp; numbered?: RegExp; script?: RegExp; readScript?: RegExp; long?: ReadonlySet<string> }
function searchFlags(plain: string, numbered: string): FlagRules { // :1318 `Hr`
  return {
    plain: RegExp(`^(?:-(?=.)[${plain}]*(?:[${numbered}]\\d+)?|--color=\\w+)$`),
    numbered: RegExp(`^(?:-[${plain}]*[${numbered}]|--(?:after-context|before-context|max-count))$`),
    script: RegExp(`^(?:-[${plain}]*e|--regexp)$`),
    long: LONG_FLAGS,
  };
}
const LINE_FLAGS: FlagRules = { // :1326 `Ur`
  plain: /^(?:-(?:[qvfF]+|\d+|[nc][+-]?\d+)|--(?:lines|bytes)=[+-]?\d+)$/,
  numbered: /^(?:-[nc]|--(?:lines|bytes))$/,
};
// The read-only file commands whose file is kept after the `…`, with the flags each may carry
const FILE_COMMANDS = new Map<string, FlagRules>([ // :1330 `Wr`
  ['cat', { plain: /^-[AbeEnstTuv]+$/ }],
  ['head', LINE_FLAGS],
  ['tail', LINE_FLAGS],
  ['grep', searchFlags('EFGHILPRTUVZabchilnoqrsuvwxyz', 'ABCm')],
  ['rg', searchFlags('0FHILNSUabcilnopqsuvwxz', 'ABCMjm')],
  ['sed', { plain: /^-[nEruzs]+$/, script: /^(?:-[nEruzs]*e|--expression)$/, readScript: /^(?:\d+(?:,(?:\d+|\$))?p|s\/[^/\\]*\/[^/\\]*\/[gp]*)$/ }],
]);
const ESCAPED_QUOTE = /\\["']|["']\\|(?:^|[\s;|&])\$["']/; // :1350 `Gr`
const PLAIN_ARG = /^[A-Za-z0-9._/:=+,-]+$/; // :1351 `Kr`
const SINGLE_QUOTED = /^'[ -&(-~]*'$/; // :1352 `qr`
const DOUBLE_QUOTED = /^"[ #%&(-[\]-_a-~]*"$/; // :1353 `Jr`
const QUIET_REDIRECT = /^2>(?:\/dev\/null|&1)$/; // :1354 `Yr`
const FILE_NAME = /^(?=.{1,64}$)[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,9}$/; // :1355 `Xr`
const NOT_A_KEY = /tokeni[sz][ea]|key(?:board|word|frame|binding|map|stroke|press)|key(?:down|up)(?![a-z])|hotkey|monkey|compass|bypass/gi; // :1356 `Zr`
const HOST = '(?:[\\w-]+(?:\\.[\\w-]+)*\\.[a-z]{2,}|\\d{1,3}(?:\\.\\d{1,3}){3}|localhost)\\.?'; // :1358 `Qr`
const HOST_WORD = new RegExp( // :1359 `$r`
  [`^${HOST}(?::[^/]*)?/`, `^${HOST}:\\d+$`, '^[\\w-]+(?:\\.[\\w-]+)+\\.:', '^[\\w-]+(?:\\.[\\w-]+)*\\.?:\\d+\\/', '^//'].join('|'),
  'i',
);
const PERCENT_ESCAPE = /%[0-9A-F]{2}/i; // :1369 `ei`
const SECRET_WORD = /^(?:tokens?|passwords?|passwd|secrets?|apikeys?|credentials?)$/i; // :1371 `ni`
const KEY_FILE_EXTENSION = /^(?:pem|ppk|p12|pfx|jks)$/i; // :1372 `ri`
const KEY_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.(?:env|netrc|pgpass|npmrc|pypirc|htpasswd))(?:[._-].*)?$/i; // :1373 `ii`
const credentialRules = once(() => { // :1375 `ai` (its `values`, used here only through `anywhere`)
  const values = [
    /:\/\/[^\s/?#@]+@/,
    /(?<![\w-])(?:-[a-z]*u|--(?:proxy-)?user)(?:=| *)["']?(?!\d+:\d+(?:[\s"']|$))(?=[\w.])[^\s"':]{1,256}:(?!\/\/)/i,
    /\bsshpass\b|\bbearer(?: +|\s*[:=]\s*)\S/i,
    /\b(?:mysql|mariadb)\w*\b.{0,512}\s-p\S/,
    /(?<![\w-])(?:npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,}|sntry[su]_[A-Za-z0-9+/=]{20}|glpat-[\w-]{20}|pypi-AgE[\w-]{50})/,
    /(?<![\w-])-{1,2}[\w-]{0,64}(?:passw(?:or)?d|token|secret|credential)/i,
    /\bsudo +(?:-[A-Za-z]{1,16} +){0,16}-[A-Za-z]{0,16}S/,
    /(?<![\w-])-pass(?:in|out)(?![\w-])|(?<![\w$-])(?:pass|env):/i,
    /\bConvertTo-SecureString\b|\bidentified +by\b/i,
  ];
  return {
    anywhere: [...values, /\b(?:authorization|bearer)\b/i, /(?:^|[ :])(?:login|auth)(?=[ :]|$)/im],
    namedValue: /(?<![\w$-])(\$?[\w-]+)(["']? *[:=] *| +)(?=\S)/g,
    credentialName: /token|secret|passw(?:or)?d|passphrase|pass$|pwd|key|auth(?!ors?(?:\b|_))|credential|cookie|session/i,
  };
});
const BASH_CONTINUATION = /(?:^|[^\\])(?:\\\\)*\\$/; // :1674 `wi`
const POWERSHELL_CONTINUATION = /(?:^|[^`])(?:``)*`$/; // :12354 `du`

// ---------------------------------------------------------------------------------------------------------------------
// What the file imports, ported

// Characters a line may not hold at all: controls, bidirectional and right-to-left scripts, invisible and format
// characters (shared-192-w2LFB3Va.js:22521 `aH`, imported as `p`)
// eslint-disable-next-line no-control-regex -- the control characters are what is refused
const REFUSED_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]|\p{Default_Ignorable_Code_Point}|\p{Cf}/u;

// The characters Desktop shows as blank (shared-0-Do3lTMSe.js:25523-25524, `B8` and `V8`)
const BLANK_LOOKING = '\\u{2800}\\u{fffc}\\u{1d159}\\u{13441}\\u{13442}\\u{16910}\\u{16fe4}';

// A text with its unpaired surrogates and its control, format and separator characters removed, but for the two joiners
// (shared-67-DjQzSlRg.js:18430 `wj`, imported as `Ge`; with `dT` :11420, `lT` :11393, `cT` :11379, `bj` and `xj` :18426-18427)
// eslint-disable-next-line no-misleading-character-class -- Desktop's class as written: the joiners are each a code point of their own here
const CONTROL_OR_FORMAT = once(() => new RegExp(`(?![\\u200c\\u200d])[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\u2060-\\u2069\\u115f\\u1160\\u3164\\uffa0${BLANK_LOOKING}\\u{e0000}-\\u{e007f}]`, 'gu'));
function withoutLoneSurrogates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += text.slice(i, i + 2);
      i += 1;
    } else if (code < 0xd800 || code > 0xdfff) out += text.charAt(i);
  }
  return out;
}
const withoutControls = (text: string): string => withoutLoneSurrogates(text).replace(CONTROL_OR_FORMAT(), '');

// A text as Desktop draws one it does not trust: marks that stack or overlay, runs of invisible characters and runs of
// blank-looking ones written out as code points (shared-192-w2LFB3Va.js:22567 `SH`, imported as `u`; with `lH` :22533,
// `uH` and `dH` :22537-22538, `fH` :22539, `pH` :22540, `mH` :22541, `hH` :22547, `gH` :22551, `_H` :22552, `vH` :22555,
// `yH` :22562, `OH` :22608)
const codePoints = (text: string): string => Array.from(text, (char) => `[U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`).join('');
const STACKED_MARKS = /([0-9#*]\ufe0f\u20e3(?![\p{Mn}\p{Me}]))|[\p{Bidi_Control}\u{E0000}-\u{E01EF}\u0334-\u0338\u20d0-\u20ff\p{Me}]|(?=[\p{Default_Ignorable_Code_Point}\p{Cf}])[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]|[\p{Default_Ignorable_Code_Point}\p{Cf}]{3,}|[\p{Mn}\p{Me}]{4,}/gu;
const INVISIBLE = /(?!\ufe0f\u20e3)[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const MAX_INVISIBLE = 16;
const BLANK = `(?:[^\\P{Zs} ]|[${BLANK_LOOKING}])`;
// eslint-disable-next-line no-misleading-character-class -- Desktop's class as written: marks and invisibles are each a code point of their own here
const BLANK_RUN = once(() => RegExp(`${BLANK}(?:[\\t \\p{Default_Ignorable_Code_Point}\\p{Cf}\\p{Mn}\\p{Me}]*${BLANK}){2,}[\\p{Mn}\\p{Me}]*`, 'gu'));
const VISIBLE = /[^\s\u2800\ufffc\u{1D159}\u{13441}\u{13442}\u{16910}\p{Default_Ignorable_Code_Point}\p{Cf}\p{Mn}\p{Me}]/u;
const LINE = /[^\n\r\u0085\u2028\u2029]+/g;
function asDrawn(text: string): string {
  const marked = text.replace(STACKED_MARKS, (match, keycap: string | undefined) => keycap ?? codePoints(match));
  const invisible = (marked.match(INVISIBLE)?.length ?? 0) > MAX_INVISIBLE ? marked.replace(INVISIBLE, codePoints) : marked;
  return invisible.replace(LINE, (line) => (VISIBLE.test(line) ? line.replace(BLANK_RUN(), (run) => Array.from(run, (char) => (char === ' ' || char === '\t' ? char : codePoints(char))).join('')) : line));
}

// The shown form, whitespace folded and at most 500 characters (shared-39-DHE4OJ5E.js:9996 `ZT` with `$T` :10007,
// imported as `w`; its own two sanitisers are `rb`, in secret-scan.ts, and `wj`, above)
const MAX_SHOWN = 500;
function shown(text: string): string {
  const folded = withoutControls(withSecretsHidden(text.replace(/[\u2028\u2029]/g, '\n')).replace(/\s+/g, ' ')).trim();
  if (folded.length <= MAX_SHOWN) return folded;
  const cut = (folded.charCodeAt(MAX_SHOWN - 1) & 0xfc00) === 0xd800 ? MAX_SHOWN - 1 : MAX_SHOWN;
  return `${folded.slice(0, cut)}…`;
}

// A path's last part, across both separators (shared-98-DEv7MzNi.js:13567 `nj`, imported as `Oe`)
function lastPart(path: string): string {
  const trimmed = path.replace(/[\\/]$/, '');
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

// The memory directories an agent or the engine keeps (shared-6-wiyzoaNH.js:8492 `YO`, :8499 `XO`, :8519 `QO`, :8526
// `tk`, imported as `$e`), and the paths a command names, each tested (:8595 `sk`, :8596 `ck`, imported as `Qe`)
const MEMORY_PATHS = [
  /\/mnt\/\.auto-memory(\/|$)/,
  /^\/mnt\/memory(\/|$)/,
  /^\/tmp\/claude\/memory(\/|$)/,
  /\/\.claude\/agent-memory(?:-local)?(\/|$)/,
  /\/local-agent-mode-sessions\/[^/]+\/[^/]+\/(memory|spaces\/[^/]+\/memory|agent\/memory)(\/|$)/,
];
const PROJECT_MEMORY = /\/\.claude\/projects\/[^/]+\/(memory|tiny_memory)(\/|$)/;
const isMemoryPath = (path: string): boolean => MEMORY_PATHS.some((pattern) => pattern.test(path)) || PROJECT_MEMORY.test(path);
const NAMED_PATH = /(?:[A-Za-z]:[/\\]|\/)[^\s'"]+/g;
const namesPath = (text: string, test: (path: string) => boolean): boolean =>
  (text.match(NAMED_PATH) ?? []).some((path) => test(path.replace(/[,;|&>]+$/, '')));
// shared-162-Bfx1pPYM.js: forward slashes (:23747 `qR`, imported as `me`), a segment's trailing dots and spaces trimmed
// (:24031 `Nz`, `se`), a `.` or `..` segment (:23776-23777 `iz`, `az`, `ee`)
const forwardSlashes = (path: string) => path.replace(/\\/g, '/');
const trimSegment = (segment: string): string => segment.replace(/[. ]+$/, '');
const DOT_SEGMENT = /(?:^|\/)\.\.?(?:\/|$)/;

// ---------------------------------------------------------------------------------------------------------------------
// The file's helpers (c52b02f3f-C1Vcib4H.js)

function atSignAllowed(word: string): boolean { // :1395 `oi`
  if (!word.includes('@')) return true;
  if (word.includes(':')) return false;
  const scoped = word.replace(/(?:^|\/)@[\w-]+\//g, '/');
  return !scoped.includes('@') || /^[^@]+@(?:\d[\w.+~-]*|[A-Za-z][\w-]*)$/.test(scoped);
}
// A run of twenty letters and digits that holds both (:1405 `si`)
const longMixedRun = (text: string): boolean => (text.match(/[A-Za-z0-9]{20,}/g) ?? []).some((run) => /[A-Za-z]/.test(run) && /\d/.test(run));
const afterLastSlash = (path: string) => path.slice(path.lastIndexOf('/') + 1); // :1408 `ci`
function namesSecret(word: string): boolean { // :1411 `li`
  const parts = afterLastSlash(word.replace(/(?<!\/\.*)(?:\/\.*)+$/, '')).split(/[-._]/);
  return parts.some((part, i) => SECRET_WORD.test(part) || (/^api$/i.test(part) && /^keys?$/i.test(parts[i + 1] ?? '')));
}
function credentialFileName(name: string): boolean { // :1415 `ui`
  const { credentialName } = credentialRules();
  return KEY_FILE.test(name) || longMixedRun(name.replace(/[-._]/g, '')) || name.replace(NOT_A_KEY, '').split(/[-._]/).some((part) =>
    credentialName.test(part) || part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).some((piece) => KEY_FILE_EXTENSION.test(piece)));
}
function trimEnd(text: string): string { // :1431 `di`
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\r')) end -= 1;
  return text.slice(0, end);
}
function readings(text: string): string[] { // :1438 `fi`: the line as written, folded, normalised, and without quotes
  const folded = text.replace(/[^\S\r\n]+/g, ' ');
  const normal = folded.normalize('NFKC');
  const unquoted = (t: string) => t.replace(/["'`\\\p{Default_Ignorable_Code_Point}]/gu, '');
  return [...new Set([folded, unquoted(folded), normal, unquoted(normal)])];
}
function holdsCredential(text: string): boolean { // :1458 `mi`
  const { anywhere, namedValue, credentialName } = credentialRules();
  const all = readings(text);
  const second = all[1];
  if (second !== undefined && secretSpans(second).length > 0) return true;
  for (const reading of all) {
    if (anywhere.some((rule) => rule.test(reading))) return true;
    for (const [, name, separator] of reading.matchAll(namedValue)) {
      const valued = name.startsWith('$') ? separator.includes('=') : separator.trim() !== '' || /^-|_|^passw(?:or)?d$/i.test(name) || /[a-z][A-Z]/.test(name);
      if (credentialName.test(name) && valued) return true;
    }
  }
  return false;
}
function hiddenPath(path: string): boolean { // :1480 `hi`
  const lower = forwardSlashes(path).toLowerCase().split('/').map((segment) => (segment === '.' || segment === '..' ? segment : trimSegment(segment))).join('/');
  if (SHORT_NAME_PATH.test(lower) || isMemoryPath(lower)) return true;
  if (lower.startsWith('/') && !lower.includes('//') && !DOT_SEGMENT.test(lower)) return false;
  const parts: string[] = [];
  for (const segment of lower.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return isMemoryPath(`/${parts.join('/')}`);
}
function touchesHiddenPath(text: string): boolean { // :1502 `gi`
  const lower = text.replace(/\p{Default_Ignorable_Code_Point}/gu, '').toLowerCase();
  for (const reading of new Set([lower.replace(/\\/g, '/'), lower.replace(/["'`\\]/g, '')])) {
    if (/\.claude[. ]*(?:\/\.?)*\/(?:projects[. ]*\/[^/\s]|agent-memory)/.test(reading) || SHORT_NAME_PATH.test(reading) || namesPath(reading, hiddenPath)) return true;
    const tokens = reading.split(/[\s;&|()<>]/).filter((token) => token !== '');
    let dir: string | undefined;
    for (let i = 0; i < tokens.length; i += 1) {
      if (CD_COMMANDS.has(tokens[i].toLowerCase())) {
        while (i + 1 < tokens.length && /^-./.test(tokens[i + 1])) i += 1;
        const target = tokens[i + 1];
        if (target === undefined) break;
        i += 1;
        dir = dir === undefined || /^(?:[/~$]|[A-Za-z]:\/)/.test(target) ? target : `${dir}/${target}`;
        if (dir.length > MAX_CD_PATH || hiddenPath(dir)) return true;
      } else if (dir !== undefined && hiddenPath(`${dir}/${tokens[i]}`)) return true;
    }
  }
  return false;
}
// The line's commands, each its words, split at `;`, `|`, `&` and their pairs; undefined for a substitution, a subshell
// or a group (:1535 `_i`)
function commandsOf(line: string): string[][] | undefined {
  if (/\$\(|`|[<>]\(/.test(line)) return undefined;
  const commands: string[][] = [[]];
  let word = '';
  let quote: string | undefined;
  const flush = () => {
    if (word !== '') {
      commands[commands.length - 1].push(word);
      word = '';
    }
  };
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (quote !== undefined) {
      word += char;
      if (char === quote) quote = undefined;
      else if (char === '\\' && quote === '"' && next !== undefined) {
        word += next;
        i += 1;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      word += char;
    } else if (char === '\\' && (next === "'" || next === '"')) {
      word += char + next;
      i += 1;
    } else if (char === ' ') flush();
    else if (char === '(' && (word === '' || word === '@')) return undefined;
    else if (char === ';' || char === '|' || (char === '&' && line[i - 1] !== '>' && line[i - 1] !== '<' && next !== '>')) {
      flush();
      commands.push([]);
      if ((char === '&' && next === '&') || (char === '|' && (next === '|' || next === '&'))) i += 1;
    } else word += char;
  }
  flush();
  return commands;
}
function knownCommands(line: string): boolean { // :1586 `vi`
  const commands = commandsOf(line);
  return commands !== undefined && commands.every((words) => {
    const command = words.find((word) => !/^[A-Za-z_]\w*=/.test(word) && !PREFIX_COMMANDS.has(word.toLowerCase()));
    return command === undefined || KNOWN_COMMANDS.has(lastPart(command).toLowerCase().replace(/\.exe$/, ''));
  });
}
function showable(word: string): boolean { // :1603 `yi`
  return SHOWN_WORD.test(word) && !word.includes('://') && !HOST_WORD.test(word) && !PERCENT_ESCAPE.test(word) && atSignAllowed(word) && !longMixedRun(word) && !namesSecret(word);
}
function unquotedArg(arg: string): string | undefined { // :1608 `bi`
  if (PLAIN_ARG.test(arg)) return arg;
  if (SINGLE_QUOTED.test(arg) || DOUBLE_QUOTED.test(arg)) return arg.slice(1, -1);
  return undefined;
}
function readOnlyArgs(words: readonly string[], rules: FlagRules): boolean { // :1617 `xi`: between the command and its file
  const args = words.slice(1, -1).map(unquotedArg);
  const operands: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || arg === '') return false;
    if (!arg.startsWith('-')) operands.push(arg);
    else if (rules.numbered?.test(arg)) {
      i += 1;
      if (!/^[+-]?\d+$/.test(args[i] ?? '')) return false;
    } else if (rules.script?.test(arg)) {
      i += 1;
      const script = args[i];
      if (script === undefined) return false;
      operands.push(script);
    } else if (!rules.plain.test(arg) && !rules.long?.has(arg)) return false;
  }
  return rules.script ? operands.length === 1 && (rules.readScript?.test(operands[0]) ?? true) : operands.length === 0;
}
const redirects = (word: string): boolean => !QUIET_REDIRECT.test(word) && /[<>]/.test(word.replace(/'[^']*'|"[^"]*"/g, '')); // :1649 `Si`
function keptFile(line: string): string | undefined { // :1652 `Ci`: the file a read-only file command names, by its name
  const commands = commandsOf(line);
  if (commands === undefined || ESCAPED_QUOTE.test(line) || commands.flat().some(redirects)) return undefined;
  const first = commands[0];
  const quiet = QUIET_REDIRECT.test(first.at(-1) ?? '');
  const words = quiet ? first.slice(0, -1) : first;
  const file = words.at(-1);
  const rules = FILE_COMMANDS.get(words[0]);
  if (file === undefined || words.length < 2 || rules === undefined || !readOnlyArgs(words, rules) || !showable(file)) return undefined;
  const name = afterLastSlash(file);
  if (!FILE_NAME.test(name) || !showable(name) || credentialFileName(name)) return undefined;
  return !quiet && commands.length === 1 ? name : `${name}…`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The rule (:1675 `Ti`, as `fu` calls it at :12355)

export function shortCommand(command: string, tool: 'Bash' | 'PowerShell' = 'Bash'): string | null {
  const continuation = tool === 'PowerShell' ? POWERSHELL_CONTINUATION : BASH_CONTINUATION;
  const limit = (command.charCodeAt(MAX_CHARS - 1) & 0xfc00) === 0xd800 ? MAX_CHARS - 1 : MAX_CHARS;
  const cutShort = command.length > limit;
  const text = withSecretsHidden(command.slice(0, limit));
  const start = text.search(/[^ \t\r\n]/);
  if (start === -1 || touchesHiddenPath(text) || holdsCredential(text)) return null;
  const lineEnd = text.indexOf('\n', start);
  let line = trimEnd(text.slice(start, lineEnd === -1 ? undefined : lineEnd).replace(/\t/g, ' '));
  const more = cutShort || (lineEnd !== -1 && /[^ \t\r\n]/.test(text.slice(lineEnd)));
  if (more && continuation.test(line) && line.at(-2) === ' ') line = trimEnd(line.slice(0, -1));
  if (line === '' || /[^\S ]/.test(line) || withoutControls(line) !== line || REFUSED_CHARACTER.test(line) || asDrawn(line) !== line || !knownCommands(line)) return null;
  const body = line.replace(LEADING_CD, '');
  const words = body.split(/ +/);
  if (lineEnd === -1 && cutShort) words.pop();
  const kept: string[] = [];
  for (const word of words) {
    if (kept.length === MAX_WORDS || !showable(word)) break;
    kept.push(word);
  }
  if (kept.length === 0) return null;
  const head = kept.join(' ');
  const cut = kept.length < words.length;
  const file = tool === 'Bash' && cut && !more && FILE_COMMANDS.has(head) ? keptFile(body) : undefined;
  return shown(file === undefined ? (more || cut ? `${head}…` : head) : `${head} … ${file}`);
}
