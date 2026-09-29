// Debt wave 3 (docs/tech-debt-tracker.md, the C3 row "The question card has no Skip"; C3 execution document
// docs/doperpowers/plans/2026-09-28-c3-engine-host.md): the engine's question tool (AskUserQuestion) asks through
// `can_use_tool`, and the answer here is the plain deny C3's broker writes for a permission (`DENY_MESSAGE`,
// `decisionClassification: 'user_reject'`), which is what the terminal's Escape on a question does. The notes record
// what the engine makes of it: the tool result, whether the turn goes on, and how the result ends.
import {scratch} from '../../harness.mjs';
import {launch,scratchConfigHome,initPayload,success,check,endAsStop,answer,RELAY_ENV} from './c10-common.mjs';
import {realpathSync} from 'node:fs';

const PROVENANCE={child:'C3',document:'docs/doperpowers/plans/2026-09-28-c3-engine-host.md',milestone:'debt wave 3',row:'The question card has no Skip'};
const DENY={behavior:'deny',message:'Denied by the user in MAWS.',decisionClassification:'user_reject'}; // src/engine-host/broker.ts permissionWire

export default async()=>{
 const repo=realpathSync(scratch('/tmp/maws-probe3-question-'));
 const configHome=scratchConfigHome();
 const asked=[];
 const {p}=await launch('question-deny',{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','0.10'],provenance:PROVENANCE},async p=>{
  p.on('can_use_tool',r=>{
   asked.push(r.tool_name);
   p.note({event:'permission_asked',tool:r.tool_name});
   return r.tool_name==='AskUserQuestion'?DENY:{behavior:'deny',message:'Only the question tool is in scope.'};
  });
  success(await p.init(initPayload()),'initialize');
  const result=await p.turn('Call the AskUserQuestion tool exactly once with one question: "Red or Blue?" with the options Red and Blue. If you get an answer, reply with only the chosen colour. If the question was declined or you got no answer, do not ask again: reply with only the word SKIPPED.');
  const results=p.frames.filter(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)).flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_result').map(b=>({seq:r.seq,is_error:b.is_error??false,content:b.content,meta:r.frame.tool_result_meta??null})));
  p.note({event:'turn',asked,answer:answer(p),toolResults:results,result:{subtype:result.subtype,is_error:result.is_error,terminal_reason:result.terminal_reason??null,permission_denials:result.permission_denials}});
  check(p,'the question tool asked through can_use_tool',asked.includes('AskUserQuestion'),asked);
  check(p,'the turn ended without an error',result.subtype==='success'&&result.is_error===false,{subtype:result.subtype,is_error:result.is_error});
  await endAsStop(p);
 });
 console.log('question-deny recorded',p.file);
};
