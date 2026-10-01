// W3 C5 (docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md; charter D-18 as amended 2026-10-01): the host's
// fallback after a refused auto. A pinned launch with `--permission-mode auto --model haiku` under a scratch config home,
// unrouted, no model turn: initialize answers another mode (the silent refusal of pass2/auto-haiku.jsonl seq 4), then
// `set_permission_mode { mode: 'acceptEdits' }` (what the engine host sends for the default `permissions.autoFallback`),
// then `get_settings` (the effort the model selector reads; Haiku applies none, reads.jsonl seq 60).
import {run as harnessRun} from '../../harness.mjs';
import {BIN,SCRUB} from '../pass2/common.mjs';
import {assertScratch,scratchConfigHome,tempDir,initPayload,success,check,endAsStop,randomUUID} from './c10-common.mjs';

export default async()=>{
 const cwd=tempDir('/tmp/maws-probe3-w3-');
 const configHome=scratchConfigHome();
 const env={CLAUDE_CONFIG_DIR:configHome};
 const {globalConfig}=assertScratch({...process.env,...env});
 for(const k of SCRUB)delete process.env[k];
 const sessionId=randomUUID();
 let failure;
 const p=await harnessRun('w3-auto-fallback',async p=>{
  p.note({event:'provenance',charter:'docs/charter.md',wave:'W3',document:'docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md',item:'C5',scrubbedEnv:SCRUB,configHome,globalConfig,pinnedSessionId:sessionId});
  try{
   const init=success(await p.init(initPayload()),'initialize');
   const haiku=(init.models??[]).find(m=>m.value==='haiku')??null;
   p.note({event:'init_summary',current_permission_mode:init.current_permission_mode,haikuRow:haiku});
   check(p,'auto is refused at launch without a code',init.current_permission_mode!=='auto');
   const set=await p.request('set_permission_mode',{mode:'acceptEdits'});
   p.note({event:'fallback_result',subtype:set.subtype,response:set.response??null,error:set.error??null,error_code:set.error_code??null});
   check(p,'set_permission_mode acceptEdits succeeds after the refusal',set.subtype==='success');
   const settings=success(await p.request('get_settings',{}),'get_settings');
   p.note({event:'applied',applied:settings.applied??null});
   await endAsStop(p);
  }catch(e){failure=e;throw e;}
 },{cwd,env,bin:BIN,dir:'fixtures/pass3/',model:'haiku',unrouted:true,settingSources:'user,project,local',strictMcp:false,mode:'auto',flags:['--session-id',sessionId]});
 const exit=await p.closed;
 if(failure)throw failure;
 if(exit.code!==0)throw new Error('w3-auto-fallback exited with '+JSON.stringify(exit));
};
