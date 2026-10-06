// E0a question 4 (spec §9 E0a; SPEC 21 §12.4 "Preview section", §12.13): whether the handshake or any control carries
// an AskUserQuestion preview-format declaration, and what a client can set. In the engine the format has one setter,
// called once at startup from CLAUDE_CODE_QUESTION_PREVIEW_FORMAT (`markdown` or `html`), else `markdown` for the
// terminal client types and nothing for an `sdk-*` entrypoint such as MAWS's (S287 chunk-q1842b1c.js:868048-868052,
// cli.pretty.js:868048; the TS SDK maps `askUserQuestion.previewFormat` to that variable, cli.pretty.js:592010). Two
// arms, the same prompt (one option's preview is plain text, the other's an HTML fragment): p1-question-preview-unset
// (MAWS's launch as it is) and p1-question-preview-html (the variable set to html, under which the engine validates
// every preview before the permission request, SPEC 21 §12.4). Each fixture scans the initialize answer and
// system/init for the word "preview" and records the question as the host receives it.
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,initFrame,answer,toolResults,toolUses,resultSummary} from './p1-common.mjs';

const PROMPT='Call the AskUserQuestion tool exactly once with one question "Which layout?" (header "Layout", multiSelect false) and two options. Option 1: label "A", description "Plain", and a preview field whose value is exactly: Layout A in plain text. Option 2: label "B", description "Markup", and a preview field whose value is exactly: <pre style="margin:0">Layout B</pre>. If the tool returns an error, do not call it again: reply with exactly the error text. Otherwise reply with exactly the chosen label.';
const ARMS=[
 {name:'p1-question-preview-unset',vars:{},arm:'unset (MAWS\'s launch: CLAUDE_CODE_ENTRYPOINT=sdk-ts, no CLAUDE_CODE_QUESTION_PREVIEW_FORMAT)'},
 {name:'p1-question-preview-html',vars:{CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html'},arm:'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT=html'},
];
// Every key or string value of a frame that contains "preview", with its path, so a hit is attributable.
function previewMentions(o,path='',out=[]){
 if(Array.isArray(o))o.forEach((v,i)=>previewMentions(v,`${path}[${i}]`,out));
 else if(o&&typeof o==='object')for(const [k,v] of Object.entries(o)){if(/preview/i.test(k))out.push({path:`${path}.${k}`,key:true});previewMentions(v,`${path}.${k}`,out);}
 else if(typeof o==='string'&&/preview/i.test(o)){const i=o.toLowerCase().indexOf('preview');out.push({path,excerpt:o.slice(Math.max(0,i-60),i+80)});}
 return out;
}

export default async()=>{
 for(const {name,vars,arm} of ARMS){
  const run=scratchRun('qp');
  try{
   await launch(name,run,{vars,provenance:{question:'Q4: an AskUserQuestion preview-format declaration in the handshake or a control; the one client knob',arm}},async p=>{
    const seen=[];
    p.on('can_use_tool',r=>{
     if(r.tool_name!=='AskUserQuestion')return {behavior:'deny',message:'Only the question tool is in scope.'};
     const q=r.input?.questions?.[0];
     seen.push({question:q?.question,previews:(q?.options??[]).map(o=>({label:o.label,preview:o.preview??null}))});
     p.note({event:'question_seen',tool_use_id:r.tool_use_id,input:r.input,previews:seen.at(-1).previews});
     return {behavior:'allow',updatedInput:{...r.input,answers:{[q.question]:'A'}}};
    });
    const init=success(await p.init(initPayload(run.cwd)),'initialize');
    p.note({event:'handshake_preview_scan',where:'initialize answer',keys:Object.keys(init).sort(),mentions:previewMentions(init,'initialize')});
    const r=await p.turn(PROMPT);
    const sysInit=initFrame(p);
    p.note({event:'handshake_preview_scan',where:'system/init',keys:Object.keys(sysInit??{}).sort(),mentions:previewMentions(sysInit??{},'init')});
    const uses=toolUses(p).filter(t=>t.name==='AskUserQuestion');
    p.note({event:'question_turn',arm,questionsSeenByHost:seen,toolUses:uses,toolResults:toolResults(p),answer:answer(p),result:resultSummary(r)});
    check(p,'the model called AskUserQuestion with a preview on an option',uses.some(u=>(u.input?.questions?.[0]?.options??[]).some(o=>o.preview!==undefined)),uses);
    check(p,'the turn ended without an error',r.subtype==='success'&&!r.is_error,resultSummary(r));
    await endAsStop(p);
   });
  }finally{removeRun(run);}
 }
};
