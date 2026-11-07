// Whether a process group is still there, for a test that watches one end (e2e/widgets.spec.ts's E8 Stop case).
// `kill(-pgid, 0)` sends nothing: ESRCH once no process of the group remains. EPERM while the group remains but holds no
// process this one may signal; on macOS that includes a group whose processes are dead but not yet reaped (XNU's killpg
// passes over zombies and answers EPERM when it found nothing to signal), so a group just sent SIGKILL reads EPERM until
// its leader's parent reaps it, and only then ESRCH. The plugin runner's own probe reads it the same way
// (src/engine-host/plugins/runner.ts, hasMembers).
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}
