// W4 B4 (docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md; charter §5.3's question bullet as amended
// 2026-10-01): the question stepper's Skip leaves a question out of the one reply. Two launches, each a two-question
// AskUserQuestion answered the way C3's broker writes a question answer (`src/engine-host/broker.ts` toWire:
// `{ behavior: 'allow', updatedInput: { ...input, answers } }`): `w4-question-partial` answers only the first question
// (the second skipped), `w4-question-none` answers none (an empty map, every question skipped). The notes record what
// the engine makes of each: the tool result the model sees, whether it is an error, and how the turn ends.
import {scratch} from '../../harness.mjs';
import {launch,scratchConfigHome,initPayload,success,check,endAsStop,answer,RELAY_ENV} from './c10-common.mjs';
import {realpathSync} from 'node:fs';

const PROVENANCE={charter:'docs/charter.md',child:'C7',wave:'W4',document:'docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md',item:'B4',milestone:'W4 probes'};
const PROMPT='Call the AskUserQuestion tool exactly once, with both questions in the one call: "Which color do you prefer?" (header "Color", options Red and Blue, single choice) and "Which fruits do you like?" (header "Fruits", options Apple and Pear, multiSelect true). Do not ask again. Then reply with exactly one line per question in the form "<header>: <answer>", writing NOT ANSWERED for a question you got no answer to.';

async function record(name,answersFor){
 const repo=realpathSync(scratch('/tmp/maws-probe3-w4-'));
 const configHome=scratchConfigHome();
 const replies=[];
 const {p}=await launch(name,{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','0.10'],provenance:PROVENANCE},async p=>{
  p.on('can_use_tool',r=>{
   if(r.tool_name!=='AskUserQuestion')return {behavior:'deny',message:'Only the question tool is in scope.'};
   const questions=(r.input?.questions??[]).map(q=>q.question);
   const answers=answersFor(questions);
   replies.push({questions,answers});
   p.note({event:'question_answered',questions,answers});
   return {behavior:'allow',updatedInput:{...r.input,answers}};
  });
  success(await p.init(initPayload()),'initialize');
  const result=await p.turn(PROMPT);
  const toolResults=p.frames.filter(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)).flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_result').map(b=>({seq:r.seq,is_error:b.is_error??false,content:b.content,structured:r.frame.tool_use_result??null})));
  p.note({event:'turn',replies,answer:answer(p),toolResults,result:{subtype:result.subtype,is_error:result.is_error,terminal_reason:result.terminal_reason??null,permission_denials:result.permission_denials}});
  check(p,'the question tool asked once with two questions',replies.length===1&&replies[0].questions.length===2,replies);
  check(p,'the tool result came back as no error',toolResults.length>0&&toolResults.every(t=>!t.is_error),toolResults);
  check(p,'the turn ended without an error',result.subtype==='success'&&result.is_error===false,{subtype:result.subtype,is_error:result.is_error});
  await endAsStop(p);
 });
 console.log(name,'recorded',p.file);
}

export default async()=>{
 await record('w4-question-partial',questions=>({[questions[0]]:'Red'}));
 await record('w4-question-none',()=>({}));
};
