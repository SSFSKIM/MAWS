import {transcriptRun,render,ask,success,check,CLIENT,PROPS} from './mods-surface-transcript-common.mjs';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
const cache='/Users/new/.claude/plugins/cache/doperpowers/doperpowers';
const versions=readdirSync(cache).filter(v=>/^\d+\.\d+\.\d+$/.test(v)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const owner=join(cache,versions.at(-1),'hooks/mods/to-human.tsx');
const text='Private working notes.\n<to-human>First **span**.</to-human>\n<essential>Second span.</essential>\n<need-input>Which path?\n<choice recommended>One</choice>\n<choice>Two</choice>\n</need-input>\nMore working notes.';
function nodes(tree,type){return tree&&typeof tree==='object'?[...(tree.type===type?[tree]:[]),...(tree.children??[]).flatMap(c=>nodes(c,type))]:[];}
export default ()=>transcriptRun('mods-surface-transcript-to-human',async p=>{
 let draft='';
 p.on('ui_prompt_read',request=>{p.note({event:'ui_request_answered',request,answer:{text:draft,cursor:draft.length}});return {text:draft,cursor:draft.length};});
 p.on('ui_prompt_fill',request=>{draft=request.text;p.note({event:'ui_request_answered',request,answer:{filled:true}});return {filled:true};});
 const site={component:'AssistantMessage',instance_id:'owner-multi',props:{text,isFirstOfReply:true}};
 const record={component:'AssistantMessage',instance_id:'owner-record',props:{text:'Private follow-up record.',isFirstOfReply:false}};
 const tool={component:'ToolUse',instance_id:'owner-tool',props:{...PROPS.ToolUse,tool_use_id:'owner-tool'}};
 const group={component:'ToolGroup',instance_id:'group:owner-tool',props:{...PROPS.ToolGroup,calls:[tool.props]}};
 const isInvalidate=f=>f.type==='system'&&f.subtype==='ui_invalidate'&&f.event==='ui.render';
 const beforeFirstDraw=p.seq;
 const draw=success(await render(p,site,'multiple marked spans and working record'),'owner render');
 const refs=nodes(draw.tree,'engine');
 p.note({event:'owner_engine_refs',refs,props:draw.props,rewritten:draw.rewritten});
 check(p,'owner draws three engine slots',refs.length===3,draw);
 // Drain the first-mark notification before any press, so it cannot masquerade as a toggle notification.
 await p.wait(isInvalidate,{after:beforeFirstDraw,timeout:5000});
 const initialInvalidate=p.frames.find(r=>r.seq>beforeFirstDraw&&isInvalidate(r.frame)).seq;
 for(const [site,label] of [[record,'folded follow-up working record'],[tool,'folded tool working record'],[group,'folded flat tool group working record']]){
  const folded=success(await render(p,site,label),label);
  check(p,label+' is inkless',folded.tree.type==='Box'&&!folded.tree.children&&folded.rewritten===false,folded);
 }
 const question=success(await render(p,{component:'AskUserQuestion',instance_id:'owner-question',props:PROPS.AskUserQuestion},'native question while working record is folded'),'question render');
 check(p,'owner question remains native while folded',question.tree.type==='engine'&&question.tree.ref===0&&question.hooked===false,question);
 const buttons=nodes(draw.tree,'Button');
 const choice=buttons.find(b=>b.props.label.startsWith('1:'));
 check(p,'owner need-input choice exists',!!choice,buttons);
 success(await ask(p,'ui_press',{...choice.press,key:choice.props.key,surface:'desktop',client_id:CLIENT},'need-input choice fills draft'),'choice');
 check(p,'choice fills prompt without sending',draft==='Answering "Which path?": One',draft);
 const toggle=buttons.find(b=>b.props.label==='working record');
 check(p,'owner working-record toggle exists',!!toggle,buttons);
 const beforeToggle=p.seq;
 success(await ask(p,'ui_press',{...toggle.press,key:toggle.props.key,surface:'desktop',client_id:CLIENT},'unfold working record'),'record toggle');
 await p.wait(isInvalidate,{after:beforeToggle,timeout:3000});
 const postToggleInvalidate=p.frames.find(r=>r.seq>beforeToggle&&isInvalidate(r.frame)).seq;
 check(p,'post-toggle invalidate follows the initial notification',postToggleInvalidate>beforeToggle&&initialInvalidate<beforeToggle,{initialInvalidate,beforeToggle,postToggleInvalidate});
 for(const [redraw,label] of [[site,'unfolded working record'],[record,'unfolded follow-up working record'],[tool,'unfolded tool working record'],[group,'unfolded flat tool group working record']]){
  const unfolded=success(await render(p,redraw,label),label);
  check(p,label+' preserves native props',nodes(unfolded.tree,'engine').length===1&&JSON.stringify(unfolded.props)===JSON.stringify(redraw.props),unfolded);
 }
 await render(p,{component:'ToolUse',instance_id:'owner-question-receipt',props:{...PROPS.ToolUse,tool_use_id:'owner-question-receipt',tool:'AskUserQuestion',input:{questions:PROPS.AskUserQuestion.questions},output:{questions:PROPS.AskUserQuestion.questions,answers:{'Which path?':'One'}}}},'answered AskUserQuestion receipt remains native');
 p.note({event:'receipt_scope',note:'AskUserQuestion card/receipt is a pure render draw. Need-input answered receipt requires prompt.submit or restored transcript; filling the composer alone does not mark it answered.'});
},{owner});
