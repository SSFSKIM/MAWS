// Production's deploy steps (P5 O13 M1, Decision Log 40): deploy/production-deploy.sh and deploy/production-run.sh,
// offline. Each script runs from a copy in a throwaway checkout (a git repository with a bare `origin`), with stubs
// first on PATH for every outside command a step reaches (pnpm, wrangler, cloudflared, curl, sleep), each recording its
// call; a synthetic secrets directory; and a scratch HOME. Nothing here reaches a deployment: the stubs answer for it,
// and the throwaway checkout holds no workspace a real pnpm could run.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, PRODUCTION_WORKER } from '../../deploy/config.ts';

const deploy = join(import.meta.dirname, '../../deploy');
const SCRIPTS = ['production-deploy.sh', 'production-run.sh'];
const production = JSON.parse(readFileSync(join(deploy, 'config.json'), 'utf8')) as Record<string, unknown>;
const staging = JSON.parse(readFileSync(join(deploy, 'staging.json'), 'utf8')) as Record<string, unknown>;
const zsh = spawnSync('zsh', ['-c', 'true']).status === 0;

// The two tokens as the secrets directory holds them, and the owner's Access token as cloudflared would print it:
// none may appear in anything a script prints, logs or passes as an argument.
const SETUP = 'cfsetup-SYNTHETIC-7a1c9e';
const SERVICE = 'cfservice-SYNTHETIC-42d0b3';
const ACCESS = `eyJ${'s'.repeat(20)}.SYNTHETIC`;

// The checkout step refuses a path under /tmp, /private/tmp or $TMPDIR, so its cases work outside them.
const durable = join(import.meta.dirname, '../../node_modules/.cache/production-scripts-test');
const roots: string[] = [durable];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The fake clock's start (rec/clock). */
const CLOCK = 1_000_000;

const STUBS: Record<string, string> = {
  // pnpm: the web build makes dist/ and records the label it was given; the deploy records its stdin and prints
  // STUB_DEPLOY_OUT. Anything else, and everything unless STUB_PNPM=deploy, fails.
  pnpm: `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_REC/pnpm"
if [ "$STUB_PNPM" = deploy ]; then
  case "$*" in
    *"desk-web build"*) printf '%s\\n' "$VITE_DESK_WEB_BUILD" > "$STUB_REC/pnpm.label"; mkdir -p apps/desk-web/dist && echo built > apps/desk-web/dist/index.html
      [ -z "$STUB_DURING_BUILD" ] || { sh -c "$STUB_DURING_BUILD" > "$STUB_REC/during-build" 2>&1; echo "exit $?" >> "$STUB_REC/during-build"; }
      exit 0 ;;
    *"deployment deploy"*) cat > "$STUB_REC/pnpm.stdin"; printf '%s\\n' "$STUB_DEPLOY_OUT"; exit 0 ;;
  esac
fi
if [ "$STUB_PNPM" = admin ]; then cat > "$STUB_REC/pnpm.stdin"; echo "head version 1, issued 0 days ago"; [ -z "$STUB_ADMIN_OUT" ] || printf '%s\n' "$STUB_ADMIN_OUT"; exit 0; fi
exit 1
`,
  wrangler: `#!/bin/sh\nprintf '%s\\n' "$*" >> "$STUB_REC/wrangler"\nexit 1\n`,
  cloudflared: `#!/bin/sh\nprintf '%s\\n' "$*" >> "$STUB_REC/cloudflared"\n[ -n "$STUB_ACCESS" ] || exit 1\nprintf '%s\\n' "$STUB_ACCESS"\n`,
  // curl: production's answer to a credential-free POST, carrying STUB_BUILD as its X-Desk-Build. It takes
  // STUB_CURL_SECONDS of the fake clock, or its --max-time when that is less (a timeout, exit 28); each call's clock at
  // its start and end and its --max-time go to curl.clock.
  curl: `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_REC/curl"
max=0; prev=; for a in "$@"; do [ "$prev" = --max-time ] && max=$a; prev=$a; done
start=$(cat "$STUB_REC/clock"); took=\${STUB_CURL_SECONDS:-0}
[ "$took" -gt "$max" ] && took=$max
echo $((start + took)) > "$STUB_REC/clock"
echo "$start $((start + took)) $max" >> "$STUB_REC/curl.clock"
[ \${STUB_CURL_SECONDS:-0} -le "$max" ] || exit 28
[ -n "$STUB_BUILD" ] || exit 7
printf 'HTTP/2 404\\r\\nx-desk-build: %s\\r\\n\\r\\n' "$STUB_BUILD"
`,
  // sleep and date: a clock of the run's own (rec/clock, in seconds), which a sleep advances at once.
  sleep: `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_REC/sleep"
case "$1" in ''|*[!0-9]*) ;; *) echo $(( $(cat "$STUB_REC/clock") + $1 )) > "$STUB_REC/clock" ;; esac
`,
  date: `#!/bin/sh\nif [ "$1" = +%s ]; then cat "$STUB_REC/clock"; else exec /bin/date "$@"; fi\n`,
};

type Run = { status: number | null; out: string };
type World = {
  root: string;
  /** The throwaway checkout, its scripts copied in, committed and pushed to its bare origin's master. */
  dir: string;
  secrets: string;
  out: string;
  rec: string;
  env: Record<string, string>;
  run(script: string, args: string[], extra?: Record<string, string>): Run;
  git(...args: string[]): string;
  /** What each stub recorded: one line per call. */
  calls(stub: string): string[];
  head(): string;
  /** The fake clock now, and each curl call's [start, end, --max-time] on it. */
  clock(): number;
  curlTimes(): number[][];
};

function world(config: Record<string, unknown> = production, under = tmpdir()): World {
  mkdirSync(under, { recursive: true });
  const root = realpathSync(mkdtempSync(join(under, 'prod-')));
  roots.push(root);
  const [bin, home, secrets, rec] = ['bin', 'home', 'secrets', 'rec'].map((name) => join(root, name));
  for (const d of [bin, home, secrets, rec]) mkdirSync(d);
  for (const [name, body] of Object.entries(STUBS)) writeFileSync(join(bin, name), body, { mode: 0o755 });
  writeFileSync(join(rec, 'clock'), `${CLOCK}\n`);
  writeFileSync(join(secrets, 'CF_ACCESS_SETUP_TOKEN'), `${SETUP}\n`);
  writeFileSync(join(secrets, 'CF_DESK_HUB_SERVICE_TOKENS'), `${SERVICE}\n`);
  const out = join(root, 'state');
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    LANG: 'C',
    DESK_PRODUCTION_SECRETS: secrets,
    DESK_PRODUCTION_DIR: out,
    STUB_REC: rec,
  };
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const origin = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'master', origin);
  const dir = join(root, 'maws');
  mkdirSync(join(dir, 'apps/desk-hub/deploy'), { recursive: true });
  for (const name of SCRIPTS) copyFileSync(join(deploy, name), join(dir, 'apps/desk-hub/deploy', name));
  writeFileSync(join(dir, 'apps/desk-hub/deploy/config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(dir, '.gitignore'), 'apps/desk-web/dist/\n');
  git(dir, 'init', '-q', '-b', 'master');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', 'origin', 'master');
  return {
    root,
    dir,
    secrets,
    out,
    rec,
    env,
    run(script, args, extra = {}) {
      const r = spawnSync('zsh', [join(dir, 'apps/desk-hub/deploy', script), ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000 });
      return { status: r.status, out: r.stdout + r.stderr };
    },
    git: (...args) => git(dir, ...args),
    calls: (stub) => (existsSync(join(rec, stub)) ? readFileSync(join(rec, stub), 'utf8').split('\n').filter(Boolean) : []),
    head: () => git(dir, 'rev-parse', '--short=8', 'HEAD'),
    clock: () => Number(readFileSync(join(rec, 'clock'), 'utf8')),
    curlTimes: () => (existsSync(join(rec, 'curl.clock')) ? readFileSync(join(rec, 'curl.clock'), 'utf8').trim().split('\n').map((l) => l.split(' ').map(Number)) : []),
  };
}

/** Which credentials anything a run left holds: its output, its logs and the stubs' records. */
function holdsCredential(w: World, run: Run): string[] {
  const files = [w.out, w.rec].filter(existsSync).flatMap((d) => readdirSync(d, { recursive: true, encoding: 'utf8' }).map((f) => join(d, f)));
  // pnpm.stdin is the one place the tokens belong: what the deploy command was handed.
  const texts = [run.out, ...files.filter((f) => statSync(f).isFile() && !f.endsWith('pnpm.stdin')).map((f) => readFileSync(f, 'utf8'))];
  return [SETUP, SERVICE, ACCESS].filter((secret) => texts.some((t) => t.includes(secret)));
}

/** Nothing ran: no stub was called and the scripts' state directory was never made. */
function nothingRan(w: World): void {
  for (const stub of ['pnpm', 'wrangler', 'cloudflared', 'curl']) expect(w.calls(stub), stub).toEqual([]);
  expect(existsSync(w.out), 'DESK_PRODUCTION_DIR').toBe(false);
}

describe.skipIf(!zsh)('a configuration that is not exactly production’s', () => {
  const previewHost = `preview-${PRODUCTION_HOST}`;
  const configs: Array<[string, Record<string, unknown>, RegExp]> = [
    ['staging.json', staging, /staging/],
    ['a preview alias of production’s Worker', { ...production, worker: previewHost.split('.')[0], host: previewHost }, /preview alias/],
    ['production’s Worker named with a preview alias’s host', { ...production, host: previewHost }, /preview alias/],
    ['production’s names under another org', { ...production, org: { id: 'elsewhere', name: 'Elsewhere' } }, /not production/],
  ];

  it.each(configs)('stops both scripts before any token is read or anything runs: %s', (_name, config, reason) => {
    const w = world(config);
    const head = w.head();
    for (const [script, args] of [
      ['production-deploy.sh', ['--checkout', w.dir, '--confirm', head]],
      ['production-deploy.sh', ['--checkout', w.dir, '--confirm', head, '--dry-run']],
      ['production-run.sh', ['build']],
      ['production-run.sh', ['access-sync']],
      ['production-run.sh', ['admin', 'genesis', '--recovery', 'paper']],
      ['production-run.sh', ['checkout', join(w.root, 'elsewhere')]],
    ] as const) {
      const run = w.run(script, [...args], { STUB_ACCESS: ACCESS, STUB_BUILD: `hub@${head}` });
      expect(run.status, `${script} ${args.join(' ')}: ${run.out}`).not.toBe(0);
      expect(run.out).toMatch(reason);
      expect(run.out).toMatch(/nothing was (run|deployed)/i);
      // The step's own announcement comes only after the guard.
      expect(run.out).not.toMatch(/changes production/);
    }
    nothingRan(w);
  });

  it.each(configs)('stops a deploy of another checkout that holds one: %s', (_name, config, reason) => {
    // production-deploy.sh reads the configuration of the checkout it deploys, which is the one the deploy would use.
    const from = world();
    const target = world(config);
    const run = from.run('production-deploy.sh', ['--checkout', target.dir, '--confirm', target.head(), '--dry-run']);
    expect(run.status, run.out).not.toBe(0);
    expect(run.out).toMatch(reason);
    nothingRan(from);
  });
});

describe.skipIf(!zsh)('production-deploy.sh deploys only the commit the owner names', () => {
  it('refuses without --confirm', () => {
    const w = world();
    const run = w.run('production-deploy.sh', ['--checkout', w.dir]);
    expect(run.status).toBe(2);
    expect(run.out).toMatch(/--confirm <sha8> is required/);
    nothingRan(w);
  });

  it('refuses a --confirm that is not the checkout’s HEAD, or not a hash', () => {
    const w = world();
    const head = w.head();
    const other = head.replace(/./, (c) => (c === '0' ? '1' : '0'));
    for (const confirm of [other, 'HEAD', head.slice(0, 7), `${head} `]) {
      const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', confirm]);
      expect(run.status, `${confirm}: ${run.out}`).not.toBe(0);
      expect(run.out).toMatch(/is not .*HEAD|needs the commit/);
    }
    nothingRan(w);
  });

  it('refuses a checkout with uncommitted changes to tracked files', () => {
    const w = world();
    writeFileSync(join(w.dir, 'apps/desk-hub/deploy/config.json'), `${JSON.stringify(production)}\n `);
    const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', w.head(), '--dry-run']);
    expect(run.status).toBe(3);
    expect(run.out).toMatch(/uncommitted changes/);
    nothingRan(w);
  });

  it('refuses a HEAD off origin/master unless --allow-head, which still needs the HEAD named', () => {
    const w = world();
    writeFileSync(join(w.dir, 'hotfix.txt'), 'fix\n');
    w.git('add', 'hotfix.txt');
    w.git('commit', '-q', '-m', 'hotfix');
    const head = w.head();
    const refused = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head, '--dry-run']);
    expect(refused.status).toBe(3);
    expect(refused.out).toMatch(new RegExp(`HEAD ${head} is not origin/master`));
    expect(refused.out).toMatch(/--allow-head/);
    // A master that moved past the checkout is "not origin/master" too, found by the fetch.
    const allowed = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head, '--allow-head', '--dry-run']);
    expect(allowed.status, allowed.out).toBe(0);
    expect(allowed.out).toMatch(new RegExp(`at ${head}, not origin/master \\(--allow-head\\)`));
    // The web build is labelled for what it is: not master's.
    expect(allowed.out).toMatch(new RegExp(`--web head\\.${head}`));
    nothingRan(w);
  });

  it('refuses a checkout behind a master that moved, which only the fetch shows', () => {
    const w = world();
    const head = w.head();
    // Another clone pushes to origin's master; the checkout's own origin/master is stale until the fetch.
    const other = join(w.root, 'other');
    w.git('clone', '-q', join(w.root, 'origin.git'), other);
    writeFileSync(join(other, 'next.txt'), 'next\n');
    for (const args of [['add', 'next.txt'], ['commit', '-q', '-m', 'next'], ['push', '-q', 'origin', 'master']]) {
      expect(spawnSync('git', ['-C', other, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { env: w.env }).status).toBe(0);
    }
    const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head, '--dry-run']);
    expect(run.status).toBe(3);
    expect(run.out).toMatch(new RegExp(`HEAD ${head} is not origin/master`));
  });

  it('--dry-run on a clean checkout at master prints what it would run, no token in it, and runs none of it', () => {
    const w = world();
    const head = w.head();
    const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head, '--dry-run'], { STUB_BUILD: `hub@${head}` });
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain(`config: ${PRODUCTION_WORKER} (production); checkout ${w.dir} clean at origin/master ${head}`);
    expect(run.out).toMatch(new RegExp(`would run: VITE_DESK_WEB_BUILD=master\\.${head} pnpm --filter desk-web build`));
    expect(run.out).toMatch(new RegExp(`would run: deployment deploy --config deploy/config\\.json --assets ${w.dir}/apps/desk-web/dist --web master\\.${head}`));
    expect(holdsCredential(w, run)).toEqual([]);
    nothingRan(w);
  });

  it('refuses before anything runs when the two tokens are not readable', () => {
    const w = world();
    rmSync(join(w.secrets, 'CF_DESK_HUB_SERVICE_TOKENS'));
    const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', w.head()]);
    expect(run.status).toBe(2);
    expect(run.out).toMatch(/not readable .*DESK_PRODUCTION_SECRETS/);
    nothingRan(w);
  });

  describe('the deploy itself, against stubs', () => {
    const deployOut = (head: string, worker = PRODUCTION_WORKER) =>
      [
        `wrangler target ${worker} (config worker ${PRODUCTION_WORKER}, account 60c1): deploy`,
        `wrangler target ${PRODUCTION_WORKER} (config worker ${PRODUCTION_WORKER}, account 60c1): secret list`,
        'reading CF_ACCESS_SETUP_TOKEN from stdin',
        'a secret was put',
        'Authorization: Bearer abc',
        `cookie eyJhbGciOi.payload`,
        `deployed hub@${head}`,
      ].join('\n');

    it('builds with the label, hands the tokens over stdin alone, filters the output, and waits for the build', () => {
      const w = world();
      const head = w.head();
      const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head], { STUB_PNPM: 'deploy', STUB_DEPLOY_OUT: deployOut(head), STUB_BUILD: `hub@${head} web@master.${head}` });
      expect(run.status, run.out).toBe(0);
      expect(readFileSync(join(w.rec, 'pnpm.label'), 'utf8').trim()).toBe(`master.${head}`);
      expect(w.calls('pnpm')).toEqual(['--filter desk-web build', `--filter desk-hub deployment deploy --config deploy/config.json --assets ${w.dir}/apps/desk-web/dist --web master.${head}`]);
      expect(readFileSync(join(w.rec, 'pnpm.stdin'), 'utf8')).toBe(`CF_ACCESS_SETUP_TOKEN=${SETUP}\nCF_DESK_HUB_SERVICE_TOKENS=${SERVICE}\n`);
      expect(w.calls('wrangler')).toEqual([]);
      // The filter: wrangler's target lines kept, any line holding token, secret, bearer or eyJ dropped.
      const [log] = readdirSync(w.out).filter((f) => f.startsWith('production-deploy-'));
      const logged = readFileSync(join(w.out, log), 'utf8');
      expect(logged).toMatch(/^wrangler target desk-hub \(config worker desk-hub, account 60c1\): deploy$/m);
      expect(logged).toContain(`deployed hub@${head}`);
      for (const dropped of [/stdin/, /a secret was put/, /Bearer/, /eyJ/]) {
        expect(logged).not.toMatch(dropped);
        expect(run.out).not.toMatch(dropped);
      }
      expect(logged).toMatch(/wrangler calls: 2, naming another Worker: 0/);
      expect(run.out).toMatch(new RegExp(`production before: x-desk-build: hub@${head}`));
      expect(run.out).toMatch(new RegExp(`production carries hub@${head}`));
      expect(holdsCredential(w, run)).toEqual([]);
      // Production was read only credential-free: every curl call a POST of /machine/enroll with no header given.
      for (const call of w.calls('curl')) expect(call).toMatch(new RegExp(`^-q -sI --max-time \\d+ -X POST https://${PRODUCTION_HOST}/machine/enroll$`));
      // The lock is released with the run.
      expect(existsSync(join(w.dir, '.git/desk-production.lock'))).toBe(false);
    });

    it('fails when a wrangler call named another Worker, and never waits for the build', () => {
      const w = world();
      const head = w.head();
      const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head], { STUB_PNPM: 'deploy', STUB_DEPLOY_OUT: deployOut(head, 'desk-hub-staging'), STUB_BUILD: `hub@${head}` });
      expect(run.status).toBe(1);
      expect(run.out).toMatch(/wrangler calls: 2, naming another Worker: 1/);
      expect(w.calls('sleep')).toEqual([]);
    });

    // The web build may wait in a queue (DESK_HEAVY_WRAPPER); nothing may change what is deployed meanwhile.
    it('keeps a checkout update out for the whole deploy: production-run.sh checkout of the same path is refused', () => {
      const w = world(production, durable);
      const head = w.head();
      const during = `zsh ${w.dir}/apps/desk-hub/deploy/production-run.sh checkout ${w.dir}`;
      const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head], { STUB_PNPM: 'deploy', STUB_DEPLOY_OUT: deployOut(head), STUB_BUILD: `hub@${head}`, STUB_DURING_BUILD: during });
      const refused = readFileSync(join(w.rec, 'during-build'), 'utf8');
      expect(refused).toMatch(/is held by another production run \(production-deploy\.sh, pid \d+/);
      expect(refused).toMatch(/exit 6$/m);
      expect(run.status, run.out).toBe(0);
      expect(w.head()).toBe(head);
      expect(existsSync(join(w.dir, '.git/desk-production.lock'))).toBe(false);
    });

    it('refuses a deploy while another run holds the checkout, and leaves that run’s lock alone', () => {
      const w = world();
      mkdirSync(join(w.dir, '.git/desk-production.lock'));
      writeFileSync(join(w.dir, '.git/desk-production.lock/holder'), 'production-run.sh checkout, pid 1\n');
      const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', w.head()], { STUB_PNPM: 'deploy' });
      expect(run.status).toBe(6);
      expect(run.out).toMatch(/is held by another production run \(production-run\.sh checkout, pid 1\)/);
      expect(existsSync(join(w.dir, '.git/desk-production.lock/holder'))).toBe(true);
      nothingRan(w);
    });

    it('checks the confirmed commit, a clean tree and the config again after the build, before any token is handed over', () => {
      // Each, done behind the lock's back during the build: HEAD moved, a tracked file edited, the config edited (a
      // tracked file too, so the same check finds it).
      const moved = (w: World) => {
        writeFileSync(join(w.dir, 'next.txt'), 'next\n');
        w.git('add', 'next.txt');
        w.git('commit', '-q', '-m', 'next');
        return `git -C ${w.dir} checkout -q --detach HEAD^`;
      };
      const cases: Array<[string, (w: World) => string, RegExp]> = [
        ['HEAD switched', moved, /moved during the build \(HEAD [0-9a-f]{8}, confirmed [0-9a-f]{8}/],
        ['a tracked file edited', (w) => `echo edited >> ${w.dir}/.gitignore`, /moved during the build/],
        ['the config made staging’s', (w) => `cp ${join(deploy, 'staging.json')} ${w.dir}/apps/desk-hub/deploy/config.json`, /moved during the build/],
      ];
      for (const [name, during, reason] of cases) {
        const w = world();
        const switchTo = during(w);
        if (name === 'HEAD switched') w.git('push', '-q', 'origin', 'HEAD:master');
        const head = w.head();
        const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head], { STUB_PNPM: 'deploy', STUB_DEPLOY_OUT: deployOut(head), STUB_BUILD: `hub@${head}`, STUB_DURING_BUILD: switchTo });
        expect(readFileSync(join(w.rec, 'during-build'), 'utf8'), name).toMatch(/^exit 0$/m);
        expect(run.status, `${name}: ${run.out}`).toBe(3);
        expect(run.out, name).toMatch(reason);
        expect(run.out, name).toMatch(/Nothing was deployed/);
        // The deploy command never ran, and the tokens were never read into a pipe.
        expect(w.calls('pnpm'), name).toEqual(['--filter desk-web build']);
        expect(existsSync(join(w.rec, 'pnpm.stdin')), name).toBe(false);
      }
    });

    it('fails when production never carries the commit within 2 minutes of elapsed time, slow reads included', () => {
      for (const seconds of ['0', '25', '30', '45']) {
        const w = world();
        const head = w.head();
        const run = w.run('production-deploy.sh', ['--checkout', w.dir, '--confirm', head], { STUB_PNPM: 'deploy', STUB_DEPLOY_OUT: deployOut(head), STUB_BUILD: `hub@${head}+dirty web@master.${head}`, STUB_CURL_SECONDS: seconds });
        expect(run.status, seconds).toBe(1);
        expect(run.out).toMatch(new RegExp(`production never carried hub@${head} within 2 minutes`));
        // The first read is "production before"; the wait starts at the second and ends 120 s after it, at the latest.
        const [, ...polls] = w.curlTimes();
        expect(polls.length, seconds).toBeGreaterThan(0);
        const deadline = polls[0][0] + 120;
        for (const [start, end, max] of polls) {
          expect(max, `${seconds}: a read at ${start}`).toBe(Math.min(30, deadline - start));
          expect(end).toBeLessThanOrEqual(deadline);
        }
        expect(w.clock() - polls[0][0], seconds).toBe(120);
      }
    });
  });
});

describe.skipIf(!zsh)('production-run.sh', () => {
  it('build and wait read production’s X-Desk-Build, credential-free; wait gives up after 2 minutes', () => {
    const w = world();
    const head = w.head();
    const build = w.run('production-run.sh', ['build'], { STUB_BUILD: `hub@${head} web@master.${head}` });
    expect(build.status, build.out).toBe(0);
    expect(build.out).toContain(`production: x-desk-build: hub@${head} web@master.${head}`);
    expect(w.run('production-run.sh', ['wait', head], { STUB_BUILD: `hub@${head}` }).status).toBe(0);
    const late = w.run('production-run.sh', ['wait', head], { STUB_BUILD: 'hub@0badc0de' });
    expect(late.status).toBe(1);
    expect(late.out).toMatch(new RegExp(`production never carried hub@${head}`));
    expect(w.run('production-run.sh', ['wait', 'master'], {}).status).toBe(2);
    // A read that takes all its time counts against the 2 minutes: reads at 0, 40 and 80 s, each 30 s, a pause of 10 s
    // after each, and nothing after 120 s (twelve 30-second reads 10 s apart would have taken 470 s).
    const start = w.clock();
    const slow = w.run('production-run.sh', ['wait', head], { STUB_BUILD: 'hub@0badc0de', STUB_CURL_SECONDS: '30' });
    expect(slow.status).toBe(1);
    expect(w.clock() - start).toBe(120);
    expect(w.curlTimes().filter(([at]) => at >= start).map(([at, end, max]) => [at - start, end - start, max])).toEqual([[0, 30, 30], [40, 70, 30], [80, 110, 30]]);
    for (const call of w.calls('curl')) expect(call).toMatch(new RegExp(`^-q -sI --max-time \\d+ -X POST https://${PRODUCTION_HOST}/machine/enroll$`));
    expect(w.calls('pnpm')).toEqual([]);
    expect(w.calls('cloudflared')).toEqual([]);
  });

  it('build fails with a reason when production gives no X-Desk-Build', () => {
    const w = world();
    // The curl stub exits 7 (cannot connect) with no STUB_BUILD; then an answer without a hub build.
    for (const extra of [{}, { STUB_BUILD: 'web@master.0badc0de' }] as Array<Record<string, string>>) {
      const run = w.run('production-run.sh', ['build'], extra);
      expect(run.status, run.out).toBe(3);
      expect(run.out).toMatch(/no valid X-Desk-Build from https:\/\/desk-hub\.opencognita-platform\.workers\.dev \(read: '.*'\): stop/);
      expect(run.out).not.toMatch(/^production: /m);
    }
  });

  describe('the steps that change production say so first, and stop at the first credential they lack', () => {
    it('access-sync: no machine credentials, then no setup token', () => {
      const w = world();
      const noMachine = w.run('production-run.sh', ['access-sync']);
      expect(noMachine.status).toBe(2);
      expect(noMachine.out.split('\n')[0]).toMatch(/^access-sync changes production: /);
      expect(noMachine.out).toMatch(/no machine credentials at .*machine\.json/);
      const device = join(w.out, 'device');
      mkdirSync(device, { recursive: true });
      writeFileSync(join(device, 'machine.json'), JSON.stringify({ DESK_MACHINE_CLIENT_ID: 'id.synthetic', DESK_MACHINE_CLIENT_SECRET: 'secret.synthetic' }));
      rmSync(join(w.secrets, 'CF_ACCESS_SETUP_TOKEN'));
      const noToken = w.run('production-run.sh', ['access-sync']);
      expect(noToken.status).toBe(2);
      expect(noToken.out.split('\n')[0]).toMatch(/^access-sync changes production: /);
      expect(noToken.out).toMatch(/CF_ACCESS_SETUP_TOKEN is not readable/);
      expect(w.calls('pnpm')).toEqual([]);
    });

    it('access-sync takes no option: its deployment and checkpoint are the script’s', () => {
      const w = world();
      const run = w.run('production-run.sh', ['access-sync', '--config', 'deploy/staging.json']);
      expect(run.status).toBe(2);
      expect(run.out).toMatch(/takes no option/);
      expect(w.calls('pnpm')).toEqual([]);
    });

    it.each(['genesis', 'pair', 'remove-device', 'refresh'])('admin %s: no admin keys, then no Access token', (sub) => {
      const w = world();
      const noKeys = w.run('production-run.sh', ['admin', sub]);
      expect(noKeys.status).toBe(2);
      expect(noKeys.out.split('\n')[0]).toMatch(new RegExp(`^admin ${sub} changes production: `));
      expect(noKeys.out).toMatch(/no admin device keys at .*keys\.json.*admin init/);
      mkdirSync(join(w.out, 'device'), { recursive: true });
      writeFileSync(join(w.out, 'device/keys.json'), '{}');
      const noToken = w.run('production-run.sh', ['admin', sub]);
      expect(noToken.status).toBe(2);
      expect(noToken.out.split('\n')[0]).toMatch(new RegExp(`^admin ${sub} changes production: `));
      expect(noToken.out).toMatch(/no production Access token: .*cloudflared access login https:\/\/desk-hub\./);
      expect(w.calls('pnpm')).toEqual([]);
    });

    it('admin devices and adopt change nothing at the hub, and say nothing of a change', () => {
      const w = world();
      for (const sub of ['devices', 'adopt']) {
        const run = w.run('production-run.sh', ['admin', sub]);
        expect(run.out).not.toMatch(/changes production/);
      }
    });
  });

  it('admin hands M2’s command the production config, the device’s keys and the owner’s token on stdin alone', () => {
    const w = world();
    mkdirSync(join(w.out, 'device'), { recursive: true });
    writeFileSync(join(w.out, 'device/keys.json'), '{}');
    const run = w.run('production-run.sh', ['admin', 'devices'], { STUB_PNPM: 'admin', STUB_ACCESS: ACCESS });
    expect(run.status, run.out).toBe(0);
    expect(w.calls('cloudflared')).toEqual([`access token -app=https://${PRODUCTION_HOST}`]);
    expect(w.calls('pnpm')).toEqual([`-s -C ${w.dir} --filter desk-hub deployment admin devices --keys ${w.out}/device/keys.json --config deploy/config.json`]);
    expect(readFileSync(join(w.rec, 'pnpm.stdin'), 'utf8')).toBe(`DESK_ACCESS_TOKEN=${ACCESS}\n`);
    expect(run.out).toContain('head version 1, issued 0 days ago');
    expect(holdsCredential(w, run)).toEqual([]);
  });

  it('admin logs a run, filtered, but genesis’s output reaches the terminal whole and is kept nowhere', () => {
    const w = world();
    mkdirSync(join(w.out, 'device'), { recursive: true });
    writeFileSync(join(w.out, 'device/keys.json'), '{}');
    // A line the filter drops (say, the paper recovery key in a JSON form, which base64url-encodes to eyJ…).
    const line = 'recovery key (write it down): eyJrdHkiOiJFQyJ9.paper';
    const devices = w.run('production-run.sh', ['admin', 'devices'], { STUB_PNPM: 'admin', STUB_ACCESS: ACCESS, STUB_ADMIN_OUT: line });
    expect(devices.out).not.toContain(line);
    const [log] = readdirSync(w.out).filter((f) => f.startsWith('admin-devices-'));
    expect(readFileSync(join(w.out, log), 'utf8')).toContain('head version 1');
    const genesis = w.run('production-run.sh', ['admin', 'genesis', '--recovery', 'paper'], { STUB_PNPM: 'admin', STUB_ACCESS: ACCESS, STUB_ADMIN_OUT: line });
    expect(genesis.status, genesis.out).toBe(0);
    expect(genesis.out).toContain(line);
    expect(w.calls('pnpm').at(-1)).toBe(`-s -C ${w.dir} --filter desk-hub deployment admin genesis --recovery paper --keys ${w.out}/device/keys.json --config deploy/config.json`);
    expect(readdirSync(w.out).filter((f) => f.startsWith('admin-genesis'))).toEqual([]);
    expect(holdsCredential(w, genesis)).toEqual([]);
  });

  // pair prints the entry's fingerprint, then asks on /dev/tty: the line must reach the owner while the command waits.
  it.skipIf(!zsh)('passes each line of a command’s output on as it comes, while the command still runs', async () => {
    const filter = readFileSync(join(deploy, 'production-run.sh'), 'utf8').split('\n').find((l) => l.startsWith('filter()'))!;
    const child = spawn('zsh', ['-c', `${filter}; filter`]);
    const first = new Promise<string>((resolve) => child.stdout.once('data', (d: Buffer) => resolve(d.toString())));
    child.stdin.write('pending: d1 web-cards webcrypto rpId desk-hub fingerprint abcde-fghij\n');
    // The input stays open: a block-buffered filter would answer nothing until it closed.
    expect(await Promise.race([first, new Promise((resolve) => setTimeout(() => resolve('nothing within 5 s'), 5_000))])).toMatch(/fingerprint abcde-fghij/);
    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
  });

  it('admin init needs no token and makes the device directory 0700', () => {
    const w = world();
    const run = w.run('production-run.sh', ['admin', 'init'], { STUB_PNPM: 'admin' });
    expect(run.status, run.out).toBe(0);
    expect(w.calls('cloudflared')).toEqual([]);
    expect(w.calls('pnpm')).toEqual([`-s -C ${w.dir} --filter desk-hub deployment admin init --keys ${w.out}/device/keys.json --config deploy/config.json`]);
    expect(spawnSync('stat', process.platform === 'darwin' ? ['-f', '%Lp', join(w.out, 'device')] : ['-c', '%a', join(w.out, 'device')], { encoding: 'utf8' }).stdout.trim()).toBe('700');
  });

  it('admin refuses an option that would pick its deployment, its keys or its confirmation', () => {
    const w = world();
    for (const args of [['--config', 'deploy/staging.json'], ['--config=deploy/staging.json'], ['--keys', 'k.json'], ['--hub', 'http://127.0.0.1:8747'], ['--user', 'a@b'], ['--yes']]) {
      const run = w.run('production-run.sh', ['admin', 'pair', '--class', 'web-cards', ...args], { STUB_ACCESS: ACCESS });
      expect(run.status, args.join(' ')).toBe(2);
      expect(run.out).toMatch(/admin takes no --config, --keys, --hub, --user or --yes/);
    }
    expect(w.calls('pnpm')).toEqual([]);
    expect(w.calls('cloudflared')).toEqual([]);
  });

  describe('checkout', () => {
    it('refuses a path under /tmp, /private/tmp or $TMPDIR, which a sweep empties', () => {
      const w = world();
      for (const path of ['/tmp/maws-desk-deploy', '/private/tmp/maws-desk-deploy', join(w.root, 'tmpdir/maws')]) {
        const run = w.run('production-run.sh', ['checkout', path], { TMPDIR: join(w.root, 'tmpdir') });
        expect(run.status, path).toBe(2);
        expect(run.out).toMatch(/a sweep would take it/);
      }
      expect(w.calls('pnpm')).toEqual([]);
    });

    it('refuses to run git in a worktree with uncommitted changes: the one it adds from, or the checkout it updates', () => {
      const w = world(production, durable);
      writeFileSync(join(w.dir, 'apps/desk-hub/deploy/config.json'), `${JSON.stringify(production)}\n `);
      const target = join(w.root, 'deploy-checkout');
      const fromDirty = w.run('production-run.sh', ['checkout', target]);
      expect(fromDirty.status).toBe(3);
      expect(fromDirty.out).toMatch(new RegExp(`${w.dir} has uncommitted changes`));
      expect(existsSync(target)).toBe(false);
      w.git('checkout', '--', '.');

      // The checkout is added, then dirtied: updating it is refused, and its edit stays.
      const added = w.run('production-run.sh', ['checkout', target]);
      expect(added.out).toMatch(/checkout .*deploy-checkout at origin\/master/);
      expect(w.git('-C', target, 'rev-parse', 'HEAD')).toBe(w.git('rev-parse', 'origin/master'));
      writeFileSync(join(target, 'apps/desk-hub/deploy/config.json'), 'edited\n');
      const toDirty = w.run('production-run.sh', ['checkout', target]);
      expect(toDirty.status).toBe(3);
      expect(toDirty.out).toMatch(/deploy-checkout has uncommitted changes/);
      expect(readFileSync(join(target, 'apps/desk-hub/deploy/config.json'), 'utf8')).toBe('edited\n');
    });

    it('adds a detached worktree of origin/master and installs the two apps, under the heavy wrapper when set', () => {
      const w = world(production, durable);
      const target = join(w.root, 'deploy-checkout');
      // The wrapper here is the sleep stub, which records what it was handed and runs none of it.
      const run = w.run('production-run.sh', ['checkout', target], { DESK_HEAVY_WRAPPER: `${join(w.root, 'bin/sleep')} --` });
      expect(run.status, run.out).toBe(0);
      expect(w.git('-C', target, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
      expect(w.calls('sleep')).toEqual(['-- pnpm install --frozen-lockfile --filter desk-hub... --filter desk-web...']);
      expect(w.calls('pnpm')).toEqual([]);
      const head = w.head();
      expect(run.out).toContain(`zsh ${target}/apps/desk-hub/deploy/production-deploy.sh --checkout ${target} --confirm ${head}`);
      // Without the wrapper the install is pnpm's own, and a failed one stops the step.
      const failed = w.run('production-run.sh', ['checkout', target]);
      expect(failed.status).toBe(5);
      expect(failed.out).toMatch(/the install failed/);
      expect(w.calls('pnpm')).toEqual(['install --frozen-lockfile --filter desk-hub... --filter desk-web...']);
    });
  });

  it('names its steps when given none it knows', () => {
    const w = world();
    const run = w.run('production-run.sh', ['deploy']);
    expect(run.status).toBe(2);
    expect(run.out).toMatch(/checkout \[<path>\] \| build \| wait <sha8> \| access-sync \| admin <args…>/);
  });
});

describe('the README', () => {
  it('names every environment variable the production scripts read', () => {
    const readme = readFileSync(join(deploy, 'README.md'), 'utf8');
    expect(readme).toContain('\n## Production runs');
    const section = readme.slice(readme.indexOf('\n## Production runs'));
    for (const name of SCRIPTS) {
      const text = readFileSync(join(deploy, name), 'utf8');
      const assigned = new Set([...text.matchAll(/(?:^|[\s;(])(?:readonly |export |local )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
      const read = new Set([...text.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]).filter((v) => !assigned.has(v) && !['HOME', 'PATH'].includes(v)));
      expect(read.size, name).toBeGreaterThan(0);
      for (const variable of read) expect(section, `${name} reads ${variable}`).toContain(variable);
    }
  });
});
