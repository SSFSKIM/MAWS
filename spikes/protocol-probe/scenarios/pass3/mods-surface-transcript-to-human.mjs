import {transcriptRun,render,ask,success,check,CLIENT,PROPS} from './mods-surface-transcript-common.mjs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const text='Private working notes.\n<to-human>First **span**.</to-human>\n<essential>Second span.</essential>\n<need-input>Which path?\n<choice recommended>One</choice>\n<choice>Two</choice>\n</need-input>\nMore working notes.';
function nodes(tree,type){return tree&&typeof tree==='object'?[...(tree.type===type?[tree]:[]),...(tree.children??[]).flatMap(c=>nodes(c,type))]:[];}
export default ()=>transcriptRun('mods-surface-transcript-to-human',async (p,run)=>{
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
 check(p,'owner draws every span as Markdown with no engine slots',refs.length===0&&JSON.stringify(nodes(draw.tree,'Markdown').map(n=>n.props.text))===JSON.stringify(['First **span**.','Second span.','Which path?']),draw);
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
 // Mirror the owner's multiple-question screenshot in both parser forms, without sending any prompt.
 const screenshotText='<to-human>Here are two questions.</to-human>\n<need-input>Which path?\n<choice recommended>One</choice>\n<choice>Two</choice>\n</need-input>\n<need-input>When should it run?\n<choice recommended>Now</choice>\n<choice>Later</choice>\n</need-input>\nPrivate screenshot working record.';
 const headers=JSON.parse(execFileSync('/bin/bash',[join(run.owner.root,'hooks/to-human-stream.sh')],{input:JSON.stringify({message_id:'owner-screenshot',index:0,final:true,delta:screenshotText}),env:{PATH:process.env.PATH,HOME:run.home,TMPDIR:run.root},encoding:'utf8'})).hookSpecificOutput.displayContent;
 p.note({event:'display_hook_output',uuid:'owner-screenshot',original:screenshotText,output:headers});
 for(const [form,text] of [['raw',screenshotText],['headers',headers]]){
  const screenshotSite={component:'AssistantMessage',instance_id:'owner-screenshot:'+form,props:{text,isFirstOfReply:true}};
  const folded=success(await render(p,screenshotSite,'owner screenshot '+form+' folded'),'render');
  check(p,'screenshot '+form+' has three Markdown bodies and no engine nodes',nodes(folded.tree,'engine').length===0&&JSON.stringify(nodes(folded.tree,'Markdown').map(n=>n.props.text))===JSON.stringify(['Here are two questions.','Which path?','When should it run?']),folded);
  const screenshotButtons=nodes(folded.tree,'Button');
  check(p,'screenshot '+form+' has four choices and one working record toggle',screenshotButtons.filter(b=>/^[12]:/.test(b.props.label)).length===4&&screenshotButtons.filter(b=>b.props.label==='working record').length===1,folded);
  const toggle=screenshotButtons.find(b=>b.props.label==='working record');
  const before=p.seq;
  success(await ask(p,'ui_press',{...toggle.press,key:toggle.props.key,surface:'desktop',client_id:CLIENT},'unfold screenshot '+form),'unfold');
  await p.wait(isInvalidate,{after:before,timeout:3000});
  const unfolded=success(await render(p,screenshotSite,'owner screenshot '+form+' unfolded'),'render');
  check(p,'screenshot '+form+' unfolds through exactly one engine node',nodes(unfolded.tree,'engine').length===1&&JSON.stringify(unfolded.props)===JSON.stringify(screenshotSite.props),unfolded);
 }
},{owner:true});
