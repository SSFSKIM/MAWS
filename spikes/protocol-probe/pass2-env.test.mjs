// A pass-2 launch's environment (P2-F W-T, tracker row "Legacy pass-2 probes can run with the owner's plugins"): the
// engine starts without any CLAUDE* variable it inherited, so a probe run from inside a Claude session does not load
// that session's plugins or model switches; it keeps what the probe sets itself and an explicit CLAUDE_CONFIG_DIR.
// No engine is launched: the pinned binary is a stand-in script that writes the environment it was given to a file as JSON.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';

const tmp=mkdtempSync(join(tmpdir(),'maws-pass2-env-'));
const fake=join(tmp,'engine');
writeFileSync(fake,'#!/usr/bin/env node\nconst out=process.env.PROBE_ENV_OUT;if(out)require(\'node:fs\').writeFileSync(out,JSON.stringify(process.env));\n');
chmodSync(fake,0o755);
const parent={CLAUDECODE:'1',CLAUDE_CODE_ENTRYPOINT:'cli',CLAUDE_CODE_PLUGIN_DIRS:'/owner/plugins',CLAUDE_MODEL:'opus',CLAUDE_CODE_SUBAGENT_MODEL:'opus',CLAUDE_EFFORT:'high',CLAUDE_CODE_SESSION_ID:'s',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1',CLAUDE_CONFIG_DIR:join(tmp,'home'),MAWS_PASS2_ENV_KEPT:'yes'};
Object.assign(process.env,parent,{MAWS_E2E_ENGINE_BIN:fake});

after(()=>rmSync(tmp,{recursive:true,force:true}));

test('a pass-2 launch drops every inherited CLAUDE* variable but the config home, and keeps what the probe sets', async () => {
 const {probe,root}=await import('./scenarios/pass2/common.mjs');
 const out=join(tmp,'env.txt');
 const p=probe('env',{cwd:tmp,dir:relative(root,tmp)+'/',env:{PROBE_ENV_OUT:out,CLAUDE_CODE_SUBAGENT_MODEL:'haiku'}});
 await p.stop();
 const env=JSON.parse(readFileSync(out,'utf8'));
 assert.deepEqual(Object.keys(env).filter(k=>k.startsWith('CLAUDE')).sort(),['CLAUDE_CODE_ENTRYPOINT','CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CONFIG_DIR']);
 assert.equal(env.CLAUDE_CODE_ENTRYPOINT,'sdk-ts');
 assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL,'haiku');
 assert.equal(env.CLAUDE_CONFIG_DIR,parent.CLAUDE_CONFIG_DIR);
 assert.equal(env.MAWS_PASS2_ENV_KEPT,'yes');
 const spawn=readFileSync(p.file,'utf8').trim().split('\n').map(l=>JSON.parse(l).frame).find(f=>f.event==='spawn');
 assert.ok(spawn.droppedEnv.includes('CLAUDE_CODE_PLUGIN_DIRS')&&spawn.droppedEnv.includes('CLAUDE_MODEL'));
});

test('a launch outside pass 2 keeps the inherited environment as before', async () => {
 const {Probe,root}=await import('./harness.mjs');
 const out=join(tmp,'env-other.txt');
 const p=new Probe('env-other',{cwd:tmp,bin:fake,dir:relative(root,tmp)+'/',env:{PROBE_ENV_OUT:out}});
 await p.stop();
 const env=JSON.parse(readFileSync(out,'utf8'));
 assert.equal(env.CLAUDE_MODEL,'opus');
 assert.equal(env.CLAUDE_CODE_PLUGIN_DIRS,'/owner/plugins');
 assert.equal(env.CLAUDE_CODE_ENTRYPOINT,'sdk-ts');
 assert.equal('CLAUDECODE' in env,false);
});
