// UX wave probes (docs/doperpowers/specs/2026-11-12-ux-wave/, U4 P1 and U1's classifier probe): the launch MAWS makes,
// reproduced on the harness. ENGINE_FLAGS of src/engine-host/launch.ts (the harness passes the first nine itself, then
// these three and setting sources user,project,local), no --strict-mcp-config, the disallow/allow pair launch.ts adds
// where the `maws` server is offered, and the --settings object protectedSettings() builds ({dialogExpiry:'never'}; no
// effort, the gateway route sets no env key). After initialize: the surface attach of src/engine-host/surface.ts when
// the engine offers ui_surface_v1, ui_panes, and set_max_thinking_tokens {null, 'summarized'} (session.ts handshake).
// Differences from the product, recorded in each findings file: the `maws` SDK MCP server is not declared or served
// (probeInitialize drops it), so mcp__maws__ask is allowed but absent; no session host; no app queue.
import {run,delay} from '../../harness.mjs';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export {run,delay,randomUUID};
export const MAWS_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__ask','--settings',JSON.stringify({dialogExpiry:'never'})];
export const SURFACE={surface:'desktop',client_id:'maws-main',viewport:{columns:100,rows:30,isFullscreen:true},answers:['ui_copy','ui_prompt_read','ui_prompt_fill','ui_prompt_suggest']};
export const WORK=process.env.PROBE_WORK, ROOT=process.env.PROBE_ROOT;
// The feature cache: seeded (vm-run.sh's scratch HOME) unless UXW_NOFEAT=1, which points CLAUDE_CONFIG_DIR at a fresh
// config home whose .claude.json is the scratch one without cachedGrowthBookFeatures(At). Pass -e PROBE_FEATURE_CACHE=
// with it, so the harness seeds nothing.
export function configEnv(userSettings={}){
 if(process.env.UXW_NOFEAT!=='1'){writeFileSync(process.env.HOME+'/.claude/settings.json',JSON.stringify(userSettings));return {env:{},feat:'seeded'};}
 if(process.env.PROBE_FEATURE_CACHE)throw new Error('UXW_NOFEAT=1 needs -e PROBE_FEATURE_CACHE=');
 const dir=ROOT+'/nofeat-config';mkdirSync(dir,{recursive:true});
 const {cachedGrowthBookFeatures:_f,cachedGrowthBookFeaturesAt:_a,...rest}=JSON.parse(readFileSync(process.env.HOME+'/.claude.json','utf8'));
 writeFileSync(dir+'/.claude.json',JSON.stringify(rest));writeFileSync(dir+'/settings.json',JSON.stringify(userSettings));
 return {env:{CLAUDE_CONFIG_DIR:dir},feat:'empty',dir};
}
export function cacheAfter(cfg){if(cfg.feat!=='empty')return null;const d=JSON.parse(readFileSync(cfg.dir+'/.claude.json','utf8'));return {cachedGrowthBookFeatures:d.cachedGrowthBookFeatures?Object.keys(d.cachedGrowthBookFeatures).length:null,velvet_panda:d.cachedGrowthBookFeatures?.tengu_velvet_panda,bubbly_meteor:d.cachedGrowthBookFeatures?.tengu_bubbly_meteor};}
export async function handshake(p){
 const init=await p.init();const r=init.response??{};
 p.note({event:'uxw_handshake',current_permission_mode:r.current_permission_mode,capabilities:r.capabilities??null});
 if(Array.isArray(r.capabilities)&&r.capabilities.includes('ui_surface_v1')){
  try{await p.request('ui_attach',SURFACE);await p.request('ui_panes',{client_id:SURFACE.client_id});}catch(e){p.note({event:'uxw_surface_error',error:e.message});}
 }
 p.request('set_max_thinking_tokens',{max_thinking_tokens:null,thinking_display:'summarized'}).catch(e=>p.note({event:'uxw_thinking_error',error:e.message}));
 return r;
}
export const steer=(p,text,priority='next')=>{const uuid=randomUUID();p.send({type:'user',uuid,message:{role:'user',content:text},parent_tool_use_id:null,origin:{kind:'human'},priority});return uuid;};
export const lifecycle=(uuid,state)=>f=>f.type==='command_lifecycle'&&f.command_uuid===uuid&&(!state||f.state===state);
export function alive(pidFile){if(!existsSync(pidFile))return null;const pid=+readFileSync(pidFile,'utf8');try{process.kill(pid,0);return {pid,alive:true};}catch{return {pid,alive:false};}}
export async function until(test,ms,step=250){for(const t=Date.now()+ms;Date.now()<t;await delay(step))if(test())return true;return false;}
export function writeWaiter(cwd){writeFileSync(cwd+'/wait.cjs',"const fs=require('fs');const [tag,secs]=process.argv.slice(2);fs.writeFileSync('wait-'+tag+'.pid',String(process.pid));console.log('started '+tag);setTimeout(()=>{fs.writeFileSync('wait-'+tag+'.done',new Date().toISOString());console.log('finished '+tag);},(+secs)*1000);\n");}
