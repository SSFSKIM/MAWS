// C10 M1, the tracker row assigned at the executor pre-flight (C10 document, Decision Log 2026-09-29 (2); C5's
// acceptance item 10): a read-only `can_use_tool` round trip against the real broker. Under the default permission
// mode a read inside the working directory is allowed without asking, so the scenario reads a file outside it; the
// request (`Read`, or `Glob` if the model chooses it) is answered allow and the turn completes with the file's word.
import {scratch} from '../../harness.mjs';
import {launch,scratchConfigHome,tempDir,initPayload,success,check,endAsStop,answer,writeFileSync,join,RELAY_ENV} from './c10-common.mjs';
import {realpathSync} from 'node:fs';

const READ_ONLY=new Set(['Read','Glob']);

export default async()=>{
 const repo=realpathSync(scratch('/tmp/maws-probe3-readonly-'));
 const outside=tempDir('/tmp/maws-probe3-outside-');
 const target=join(outside,'outside.txt');
 writeFileSync(target,'PAPAYA\n');
 const configHome=scratchConfigHome();
 const asked=[];
 const {p}=await launch('read-only-permission',{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','0.05']},async p=>{
  p.on('can_use_tool',r=>{
   asked.push(r.tool_name);
   p.note({event:'permission_asked',tool:r.tool_name,decision_reason_type:r.decision_reason_type??null,decision_reason:r.decision_reason??null,input:r.input});
   return READ_ONLY.has(r.tool_name)?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the Read tool is allowed in this probe.'};
  });
  success(await p.init(initPayload()),'initialize');
  const result=await p.turn(`Use the Read tool to read the file ${target} and reply with only the single word it contains.`);
  p.note({event:'turn',asked,answer:answer(p),result:{subtype:result.subtype,is_error:result.is_error}});
  check(p,'a read-only tool asked for permission',asked.some(t=>READ_ONLY.has(t)),asked);
  check(p,'the turn read the file',/PAPAYA/.test(answer(p)??''),answer(p));
  await endAsStop(p);
 });
 console.log('read-only-permission recorded',p.file);
};
