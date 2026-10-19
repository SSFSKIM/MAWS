// Whether a final gate run was the whole declared invocation, passed (gate-offload Decision Log 50; the tracker's
// reporter row, which P3-F closed by converging the three children's checks here): a final bundle is written only for
// the package script's own command, unnarrowed, every case run and expected. The CLI applies several narrowings outside
// the config a reporter sees (`--grep`, `--grep-invert`, a file or `file:line` argument, `--last-failed`,
// `--only-changed`, a test list, a project, a shard, a stop after failures), so the runner's command line is compared,
// token for token, with the script's `playwright test` arguments; the config's own selection must be unnarrowed; a
// group that declares its files' case counts must run exactly those, and a group that does not must forbid `test.only`;
// every file the script names must run, and no other. Free of Playwright, so test/support/final-invocation.test.ts runs it.
import { basename, resolve } from 'node:path';

type Grep = RegExp | readonly RegExp[];

// What the run was: its status, its runner's command line, the config's selection and every case with its outcome.
export interface InvocationSummary {
  status: string; // Playwright's `FullResult.status`
  argv: readonly string[]; // `FullConfig.argv`: the runner's `process.argv`
  config: { grep: Grep; grepInvert: Grep | null; shard: { current: number; total: number } | null; forbidOnly: boolean };
  tests: readonly { file: string; title: string; outcome: string }[]; // every case of the root suite, by its spec file's name
}

// What the run should have been: the package script's text, and the case count of each file when the group declares them.
export interface DeclaredInvocation {
  script: string;
  files?: readonly { file: string; tests: number }[];
}

// A package script's `playwright test` arguments, as the gate runs it: an optional build step and NAME=value assignments
// before `playwright test`, and nothing the shell would change after it (the form .github/scripts/e2e-default-specs.mjs
// reads); null for any other script.
export function playwrightArgs(script: string): string[] | null {
  const at = script.lastIndexOf('playwright test');
  if (at < 0) return null;
  const rest = script.slice(at + 'playwright test'.length);
  if (/["'`$;&|<>\\()]/.test(rest)) return null;
  return rest.split(/\s+/).filter(Boolean);
}

// The one alias the declared scripts' options have (`-c` for `--config`); any other short option is a word of its own.
const ALIASES: Record<string, string> = { '-c': '--config' };

// `--name=value` as `--name value`, an alias as its long name, and every word that is not an option resolved against
// the checkout, so the same command typed either way reads the same.
function normalized(args: readonly string[], root: string): string[] {
  return args.flatMap((arg) => {
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const words = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg];
    return words.map((word) => (word.startsWith('-') ? (ALIASES[word] ?? word) : resolve(root, word)));
  });
}

// How the runner's command line differs from the script's, as words naming what was added (an option with the value
// typed after it) or left out; empty when the two are the same command.
export function commandLineProblems(argv: readonly string[], scriptArgs: readonly string[], root: string): string[] {
  const at = argv.indexOf('test', 2);
  if (at < 0) return ['the invocation is not `playwright test`'];
  const typed = argv.slice(at + 1);
  const ran = normalized(typed, root);
  const want = normalized(scriptArgs, root);
  if (JSON.stringify(ran) === JSON.stringify(want)) return [];
  const known = (arg: string, among: string[]) => normalized([arg], root).every((word) => among.includes(word));
  const words: string[] = [];
  const isOption = (arg: string | undefined) => arg !== undefined && arg.startsWith('-') && !arg.includes('=');
  for (let i = 0; i < typed.length; i++) {
    const arg = typed[i]!;
    if (known(arg, want)) continue;
    const value = typed[i + 1];
    if (isOption(arg) && value !== undefined && !value.startsWith('-') && !known(value, want)) words.push(`the command line adds ${arg} ${typed[++i]}`);
    else if (!arg.startsWith('-') && isOption(typed[i - 1]) && known(typed[i - 1]!, want)) words.push(`the command line adds ${typed[i - 1]} ${arg}`); // a known option given another value
    else words.push(`the command line adds ${arg}`);
  }
  for (const arg of scriptArgs) if (!known(arg, ran)) words.push(`the command line leaves out the script's ${arg}`);
  return words.length > 0 ? words : [`the command line ${typed.join(' ')} is not the script's ${scriptArgs.join(' ')} in its order`];
}

const greps = (grep: Grep | null): readonly RegExp[] => (grep === null ? [] : Array.isArray(grep) ? grep : [grep as RegExp]);

// Why the run was not the whole declared invocation passed; empty when it was.
export function invocationProblems(run: InvocationSummary, declared: DeclaredInvocation, root: string): string[] {
  const args = playwrightArgs(declared.script);
  if (args === null) return [`the package script is not a plain \`playwright test\` command: ${declared.script}`];
  const problems: string[] = [];
  if (run.status !== 'passed') problems.push(`the run did not pass (${run.status})`);
  for (const word of commandLineProblems(run.argv, args, root)) problems.push(`the invocation was narrowed: ${word}`);
  const grep = greps(run.config.grep);
  if (!(grep.length === 1 && grep[0]!.source === '.*' && grep[0]!.flags === '')) problems.push(`the config's grep narrows the run (${grep.map(String).join(' ')})`);
  if (greps(run.config.grepInvert).length > 0) problems.push(`the config's grepInvert narrows the run (${greps(run.config.grepInvert).map(String).join(' ')})`);
  if (run.config.shard) problems.push(`the run is shard ${run.config.shard.current}/${run.config.shard.total}`);
  const counts = new Map<string, number>();
  for (const t of run.tests) counts.set(t.file, (counts.get(t.file) ?? 0) + 1);
  const named = args.filter((arg) => /\.spec\.ts$/.test(arg)).map((arg) => basename(arg));
  for (const file of named) if (!counts.has(file)) problems.push(`a spec the script names did not run: ${file}`);
  if (declared.files) {
    for (const { file, tests } of declared.files) if ((counts.get(file) ?? 0) !== tests) problems.push(`${file}: ${counts.get(file) ?? 0} cases of the declared ${tests}`);
    for (const file of counts.keys()) if (!declared.files.some((d) => d.file === file)) problems.push(`a file outside the declared list ran: ${file}`);
  } else {
    if (!run.config.forbidOnly) problems.push('test.only admitted (no --forbid-only and no declared case counts)');
    if (named.length > 0) for (const file of counts.keys()) if (!named.includes(file)) problems.push(`a spec outside the script's ran: ${file}`);
  }
  if (run.tests.length === 0) problems.push('no case ran');
  for (const t of run.tests) {
    if (t.outcome === 'skipped') problems.push(`a skipped case: ${t.file} › ${t.title}`);
    else if (t.outcome !== 'expected') problems.push(`a case not expected (${t.outcome}): ${t.file} › ${t.title}`);
  }
  return problems;
}
