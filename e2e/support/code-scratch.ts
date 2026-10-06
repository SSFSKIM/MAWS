// C8c's scratch repository for the stub-mode product cases and the harness's Review cases (C8c execution document,
// Interfaces *Stub-mode e2e*). Built in Node under an isolated git environment (as C8a's `scratchRepository`), so hooks,
// signing or a default branch name on this machine cannot change the expected strings, which are exact because the
// tree is: `git diff HEAD --numstat` sums to +4 −0 over two files and `git status --porcelain` lists five entries,
// three untracked. The scenario is C8a's `panelScenario` (C5's nine-sessions.json with *Charter + research* pointed at
// the repository), so the session under test is that record.
import { isolatedGitEnv } from '../../test/support/git-env';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHARTER, panelScenario } from './panel-support';

// A 1×1 PNG.
const DOT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const SVG_TEXT = 'Ünïcødé — 日本語';
const LABEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="40" viewBox="0 0 240 40"><text x="4" y="26" font-size="18">${SVG_TEXT}</text></svg>\n`;

export const GENERATED_LINES = 40_000;
export const GENERATED_LINE_BYTES = 55; // with its newline
export const MARKER_LINE = 30_000;
// Line i of src/generated.ts, padded to exactly 54 characters (55 bytes with the newline).
export function generatedLine(i: number): string {
  const line = i === MARKER_LINE ? `export const MARKER_${i} = 'target'; //` : `export const v${i} = '`;
  const close = i === MARKER_LINE ? '' : "';";
  return `${line}${'x'.repeat(GENERATED_LINE_BYTES - 1 - line.length - close.length)}${close}`;
}

// src/app.ts as committed (30 lines), and the three lines inserted so the new file's lines 5, 14 and 25 are added.
const APP_LINES = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? `export function f${i + 1}(): number {` : i % 5 === 4 ? '}' : `  const v${i + 1} = ${i + 1};`));
export const APP_INSERTED = { 5: '// added at line 5', 14: '// added at line 14', 25: '// added at line 25' } as const;

// E5 start: conflicts/merge.ts, ten lines holding one conflict block with a diff3 base, committed with the first commit
// so no working-tree count moves (E5 execution document, Interfaces *Scratch additions*).
export const CONFLICT_BLOCK = { mine: "export const value = 'mine';", base: "export const value = 'base';", theirs: "export const value = 'theirs';" } as const;
export const MERGE_LINES = [
  'export const before = 1;',
  '<<<<<<< HEAD',
  CONFLICT_BLOCK.mine,
  '||||||| base',
  CONFLICT_BLOCK.base,
  '=======',
  CONFLICT_BLOCK.theirs,
  '>>>>>>> feature',
  'export const after = 2;',
  'export const last = 3;',
];
// E5 end

const README =['# Scratch readme', '', 'A list:', '', '- one', '- two', '', '```ts', 'export const answer: number = 42;', '```', ''].join('\n');
export const BIG_LOG_BYTES = 20 * 1024 * 1024;

export interface CodeScratch {
  root: string; // the temporary directory holding everything below (a realpath)
  dir: string; // the repository's realpath: the session's directory
  scenario: string; // the stub scenario file
  openLog: string; // MAWS_E2E_OPEN_LOG
  appSessionId: string; // the *Charter + research* record's id
  outsideFile: string; // the target of `link-out`, outside the repository
  siblingFile: string; // a file in a sibling directory whose name starts with the repository's
  path(relative: string): string; // a path in the repository
  git(...args: string[]): string;
  env: Record<string, string>; // the product launch's environment
  cleanup(): void;
}

export function buildCodeScratch(): CodeScratch {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-code-')));
  const dir = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  const write = (relative: string, content: string | Buffer) => {
    const path = join(dir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };

  git(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  mkdirSync(dir);
  git(dir, 'init', '--quiet', '-b', 'main');
  write('src/app.ts', `${APP_LINES.join('\n')}\n`);
  write('src/generated.ts', Array.from({ length: GENERATED_LINES }, (_, i) => `${generatedLine(i + 1)}\n`).join(''));
  write('README.md', README);
  write('notes/guide.md', '# Guide\n\nRead the readme first.\n');
  write('img/dot.png', Buffer.from(DOT_PNG, 'base64'));
  write('img/label.svg', LABEL_SVG);
  write('doc.pdf', '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  write('data.bin', Buffer.from([0x4d, 0x41, 0x00, 0x57, 0x53, 0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00]));
  write('.editorconfig', 'root = true\n'); // a dotfile, which the tree shows
  write('conflicts/merge.ts', `${MERGE_LINES.join('\n')}\n`); // E5
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'scratch');
  write('notes/guide.md', '# Guide\n\nRead the readme first, then the notes.\n');
  git(dir, 'commit', '--quiet', '-am', 'notes');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '--quiet', 'origin', 'main');
  git(dir, 'branch', '--quiet', '-u', 'origin/main');

  const app = [...APP_LINES];
  for (const [line, text] of Object.entries(APP_INSERTED)) app.splice(Number(line) - 1, 0, text); // ascending: each lands at its line
  write('src/app.ts', `${app.join('\n')}\n`);
  write('src/staged.ts', 'export const staged = true;\n');
  git(dir, 'add', 'src/staged.ts');
  write('scratch.txt', 'scratch\n');
  const logLine = 'INFO a scratch log line'.padEnd(63, '.') + '\n'; // 64 bytes, so the file is exactly 20 MiB
  write('big.log', logLine.repeat(BIG_LOG_BYTES / logLine.length));
  const outside = join(root, 'outside');
  mkdirSync(outside);
  const outsideFile = join(outside, 'secret.txt');
  writeFileSync(outsideFile, 'outside the repository\n');
  symlinkSync(outsideFile, join(dir, 'link-out'));
  const sibling = join(root, 'repo-sibling');
  mkdirSync(sibling);
  const siblingFile = join(sibling, 'x.txt');
  writeFileSync(siblingFile, 'a look-alike sibling\n');

  const scenario = panelScenario(root, dir);
  const record = (JSON.parse(readFileSync(scenario, 'utf8')) as { sessions: { appId: string; title: { text: string } }[] }).sessions.find((s) => s.title.text === CHARTER)!;
  const openLog = join(root, 'open.log');
  return {
    root,
    dir,
    scenario,
    openLog,
    appSessionId: record.appId,
    outsideFile,
    siblingFile,
    path: (relative) => join(dir, relative),
    git: (...args) => git(dir, ...args),
    env: { MAWS_SESSION_SOURCE: `stub:${scenario}`, MAWS_E2E_OPEN_LOG: openLog, MAWS_SCENARIO_CLOCK: 'manual', MAWS_HARNESS: '0' },
    cleanup: () => {
      execFileSync('chmod', ['-R', 'u+rwx', root]); // a case may leave a directory it locked
      rmSync(root, { recursive: true, force: true });
    },
  };
}
