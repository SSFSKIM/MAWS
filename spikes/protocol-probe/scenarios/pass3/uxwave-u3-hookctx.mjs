// UX wave U3, probe 3's form (c) on the live wire (U3-transcript-rows.md, "Probes and checks" 3c): does a hook's added
// context, the carrier sminos uses for an answer to a question asked without waiting (a `hook_additional_context`
// attachment in the file), reach the wire of a session MAWS runs? sminos's own asynchronous question registers only in
// an interactive session (uxwave-u3-sminos.mjs, terminal arm), so this asks the engine directly: a project
// settings PostToolUse hook on Bash answers with `additionalContext`, and a UserPromptSubmit hook does the same for the
// next prompt (sminos's other route, "rides the human's next prompt"). Launched as MAWS launches (uxwave-common.mjs,
// whose setting sources include `project`, and `--include-hook-events`).
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,idle,turn,cost} from './uxwave-common.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const TAG=process.env.UXW_TAG||'u3-hookctx';
export default async()=>{
 const work=process.env.PROBE_WORK;mkdirSync(join(work,'.claude'),{recursive:true});
 const out=(event,text)=>`printf '%s' '${JSON.stringify({hookSpecificOutput:{hookEventName:event,additionalContext:text}})}'`;
 writeFileSync(join(work,'.claude/settings.json'),JSON.stringify({hooks:{
  PostToolUse:[{matcher:'Bash',hooks:[{type:'command',command:out('PostToolUse','UXW hook context after a tool: the answer is Mango.')}]}],
  UserPromptSubmit:[{hooks:[{type:'command',command:out('UserPromptSubmit','UXW hook context on a prompt: the colour is teal.')}]}]}},null,1));
 await mawsLaunch(TAG,{model:process.env.UXW_MODEL||'haiku',spendCap:'0.50',provenance:{probe:'U3 probe 3 (c), hook context on the live wire',projectSettings:'.claude/settings.json: PostToolUse(Bash) and UserPromptSubmit command hooks answering additionalContext'}},async(p,{transcript})=>{
  let lastLine=0;
  const record=(name,from)=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;const wire=wireArrivals(p,from);p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,wire,file,hookFrames:p.frames.filter(r=>r.seq>from&&r.frame.type==='system'&&/^hook_/.test(r.frame.subtype)).map(r=>({seq:r.seq,frame:r.frame}))});console.log(name,file.length);};
  let from=p.seq;await turn(p,'Run exactly `echo UXW-HOOK` with the Bash tool. Then reply with any context you were given after the tool ran, in one sentence.');await idle(p,60000,3000);record('post-tool-use',from);
  from=p.seq;await turn(p,'Without using any tool, reply with any context you were given with this prompt, in one sentence.');await idle(p,60000,3000);record('user-prompt-submit',from);
  keepTranscript(transcript,TAG);console.log(TAG,'cost',cost(p));
 });
};
