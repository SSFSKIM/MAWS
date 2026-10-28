// Keeping a path out of Time Machine through NSURLIsExcludedFromBackupKey, the sticky exclusion: an attribute on the
// item itself (com.apple.metadata:com_apple_backup_excludeItem) that follows it through a move or rename and, set on a
// directory, keeps out everything inside it. Node has no Foundation, so the key is set by a JavaScript for Automation
// script through osascript's Objective-C bridge: it sends no Apple Event, so it needs no admin rights and raises no
// prompt for an item the user owns. `tmutil addexclusion` sets the same attribute but waits on backupd, 11 s per call on
// this Mac (2026-10-27), where the script takes a tenth of a second. A no-op off macOS.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const OSASCRIPT = '/usr/bin/osascript';
const TIMEOUT_MS = 5_000;
// The path arrives as argv[0], never inside the script's text. It is made absolute and follows `--`, so osascript can
// never read it as an option: a relative path beginning `-e` would otherwise be one more script, whose own `run` answers.
const SCRIPT = [
  'ObjC.import("Foundation");',
  'function run(argv) {',
  '  const error = $();',
  '  const url = $.NSURL.fileURLWithPath(argv[0]);',
  '  if (!url.setResourceValueForKeyError($.NSNumber.numberWithBool(true), $.NSURLIsExcludedFromBackupKey, error)) throw new Error(ObjC.unwrap(error.localizedDescription));',
  '}',
].join('\n');

export type BackupExclusionDeps = {
  platform?: NodeJS.Platform;
  /** execFile; rejects when the program fails or outlives `timeoutMs`. */
  run?: (file: string, args: string[], timeoutMs: number) => Promise<void>;
};

/** True once the exclusion is set; false where there is no Time Machine to exclude from. Rejects when it could not be set. */
export async function excludeFromBackup(path: string, deps: BackupExclusionDeps = {}): Promise<boolean> {
  if ((deps.platform ?? process.platform) !== 'darwin') return false;
  await (deps.run ?? runProgram)(OSASCRIPT, ['-l', 'JavaScript', '-e', SCRIPT, '--', resolve(path)], TIMEOUT_MS);
  return true;
}

function runProgram(file: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, _stdout, stderr) =>
      error ? reject(new Error((stderr.trim() || error.message).replace(/\s+/g, ' '))) : resolve(),
    ),
  );
}
