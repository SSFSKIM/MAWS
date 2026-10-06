// E10 M0 Q3 (docs/doperpowers/plans/2026-10-06-e10-supervisor.md, M0): the packaged app's binary as Node.
// Against a packaged MAWS.app (read-only; nothing in it is written), under ELECTRON_RUN_AS_NODE=1:
//   1. find the engine-host chunk inside app.asar (the bundled file carrying the entry's MAWS_USER_DATA refusal);
//   2. run that chunk by its asar path with no MAWS_USER_DATA, as the supervisor spawn would, and record that it loads
//      and stops at its own MAWS_USER_DATA check; a second, instrumented run records every module the chunk required
//      and where each resolved (zod from app.asar/node_modules);
//   3. a one-line script `require`s zod from app.asar/node_modules;
//   4. a detached child spawned with argv0 'maws-supervisor': what `ps -o command=` and `ps -c` show (both follow
//      argv0 on macOS), what `top -l 1 -stats pid,command` shows (top reads the kernel's process name, as Activity
//      Monitor does), and whether `lsappinfo list` has an entry for its pid (any MAWS line there is checked against
//      the pid); the same ps and top readings for a child of the repository's dev Electron binary;
//   5. `electron-fuses read --app` on the bundle (the RunAsNode fuse).
//   node spikes/supervisor-probe/q3-electron-as-node.mjs /path/to/MAWS.app
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appPath = process.argv[2];
if (!appPath) throw new Error('usage: q3-electron-as-node.mjs <path to MAWS.app>');
const bin = join(appPath, 'Contents/MacOS/MAWS');
const asar = join(appPath, 'Contents/Resources/app.asar');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const nodeEnv = () => {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.MAWS_USER_DATA;
  return env;
};
const asNode = (args) => spawnSync(bin, args, { env: nodeEnv(), encoding: 'utf8', timeout: 30_000 });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { question: 'Q3', app: appPath, asarMtimeBefore: statSync(asar).mtime.toISOString() };

// 1. the engine-host chunk
const find = asNode(['-e', `const fs=require('fs'),p=require('path');const d=${JSON.stringify(join(asar, 'out/main'))};const all=fs.readdirSync(d).filter(n=>n.endsWith('.js'));console.log(JSON.stringify({version:process.version,execPath:process.execPath,files:all,hits:all.filter(n=>fs.readFileSync(p.join(d,n),'utf8').includes('the engine host needs MAWS_USER_DATA'))}))`]);
const found = JSON.parse(find.stdout);
result.find = { status: find.status, ...found };
if (found.hits.length !== 1) throw new Error('expected one engine-host chunk, found ' + JSON.stringify(found.hits));
const chunk = join(asar, 'out/main', found.hits[0]);

// 2. the chunk run as the supervisor would run it, without MAWS_USER_DATA
const plain = asNode([chunk]);
result.chunkRun = { chunk, status: plain.status, signal: plain.signal, stderrHead: plain.stderr.split('\n').filter(Boolean).slice(0, 6), stdout: plain.stdout.trim() };
const traced = asNode(['-e', `const M=require('module'),fs=require('fs');const target=fs.realpathSync(${JSON.stringify(chunk)});const seen=[];let all=0;const load=M._load;M._load=function(r,parent,isMain){const out=load.apply(this,arguments);all++;if(parent&&parent.filename===target)try{seen.push({request:r,resolved:r.startsWith('node:')||M.isBuiltin(r)?'builtin':M._resolveFilename(r,parent,isMain)});}catch{}return out;};try{require(${JSON.stringify(chunk)});console.log(JSON.stringify({loaded:true,requiresTotal:all,chunkRequires:seen}));}catch(e){console.log(JSON.stringify({loaded:false,error:e.message,requiresTotal:all,chunkRequires:seen}));}`]);
result.chunkTraced = { status: traced.status, ...JSON.parse(traced.stdout.trim().split('\n').at(-1)) };

// 3. zod from inside the asar, one line
const zod = asNode(['-e', `const r=require.resolve('zod',{paths:[${JSON.stringify(asar)}]});const z=require(r);console.log(JSON.stringify({resolved:r,object:typeof z.object,toJSONSchema:typeof z.toJSONSchema}))`]);
result.zodOneLine = { status: zod.status, ...JSON.parse(zod.stdout.trim()) };

// 4. argv0, ps, top and lsappinfo for a detached child of the packaged binary (and ps and top for the dev binary)
// `ps -o command=` and, on macOS, `ps -c -o command=` both follow argv[0]; `top` reads the kernel's process name
// (libproc proc_name, the executable's name), which is also what Activity Monitor's Process Name shows
const names = (pid) => ({
  psCommand: execFileSync('ps', ['-o', 'pid=,ppid=,pgid=,stat=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  psComm: execFileSync('ps', ['-c', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  top: execFileSync('top', ['-l', '1', '-pid', String(pid), '-stats', 'pid,command'], { encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter((l) => l.startsWith(String(pid) + ' ')),
});
const devElectron = join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const devChild = spawn(devElectron, ['-e', 'setTimeout(()=>{},8000)'], { detached: true, stdio: 'ignore', env: nodeEnv(), argv0: 'maws-supervisor' });
devChild.unref();
const child = spawn(bin, ['-e', 'setTimeout(()=>{},8000)'], { detached: true, stdio: 'ignore', env: nodeEnv(), argv0: 'maws-supervisor' });
child.unref();
await delay(2_000);
const { psCommand, psComm, top } = names(child.pid);
result.devElectronChild = { binary: devElectron, pid: devChild.pid, ...names(devChild.pid) };
try { process.kill(devChild.pid, 'SIGKILL'); } catch {}
const listing = execFileSync('lsappinfo', ['list'], { encoding: 'utf8' });
const entries = listing.split(/\n(?=\s*\d+\) )/);
const mawsEntries = entries.filter((e) => /maws/i.test(e)).map((e) => ({ name: (e.match(/"([^"]+)"/) ?? [])[1] ?? null, pid: Number((e.match(/pid = (\d+)/) ?? [])[1] ?? NaN) }));
result.lsappinfo = { childPid: child.pid, psCommand, psComm, top, entryForChildPid: entries.some((e) => new RegExp(`pid = ${child.pid}\\b`).test(e)), mawsEntries, totalEntries: entries.length };
try { process.kill(child.pid, 'SIGKILL'); } catch {}
await delay(200);
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
result.lsappinfo.childKilled = gone(child.pid);
result.devElectronChild.killed = gone(devChild.pid);

// 5. the fuses
result.fuses = execFileSync(join(repo, 'node_modules/.bin/electron-fuses'), ['read', '--app', appPath], { encoding: 'utf8' }).split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
result.asarMtimeAfter = statSync(asar).mtime.toISOString();
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/q3.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
