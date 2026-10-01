// A scratch home for the shells a test starts (the PTY host's suite, every end-to-end launch), so none of them reads the
// owner's startup files or writes the owner's history. An interactive shell saves the commands typed into it when it
// exits, on a SIGHUP too (what a pty's shell gets when its terminal closes, as when the app quits), so a test shell on
// the owner's home appended its commands to ~/.zsh_history or ~/.bash_history.
//
// zsh reads its startup files from ZDOTDIR, and macOS's /etc/zshrc puts its HISTFILE there; bash and sh keep the
// HISTFILE they inherit. A test that owns a shell's whole environment moves HOME here as well, so a bash login shell
// reads this home's profile too; an app launch keeps the owner's HOME, which the app itself reads, so there a bash
// login shell still reads the owner's profile and keeps this HISTFILE unless that profile sets its own. Each login
// profile exports its own name as PROFILE_VARIABLE, so a test can tell which one a login shell read.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROFILE_VARIABLE = 'SCRATCH_SHELL_PROFILE';
const PROFILES = ['.zprofile', '.bash_profile'];

export interface ScratchShellHome {
  dir: string;
  env: { ZDOTDIR: string; HISTFILE: string };
}

// Creates `dir` if needed and (re)writes its profiles, so a relaunch over the same directory finds them as written.
export function writeScratchShellHome(dir: string): ScratchShellHome {
  mkdirSync(dir, { recursive: true });
  for (const name of PROFILES) writeFileSync(join(dir, name), `export ${PROFILE_VARIABLE}=${name}\n`);
  return { dir, env: { ZDOTDIR: dir, HISTFILE: join(dir, '.sh_history') } };
}
