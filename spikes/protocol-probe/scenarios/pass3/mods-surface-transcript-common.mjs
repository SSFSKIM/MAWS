// R3 / child C2, docs/charter.md; approved wave plan §2 K2. Control-only draws on the unmodified installed engine.
// Each launch has a new scratch config, no owner configuration, and an unreachable API endpoint (never the relay).
import {scratchRun,launch,removeRun,initPayload,success,check,endAsStop} from './mods-common.mjs';
import {CLIENT,VIEWPORT,ANSWERS,render,ask} from './mods-surface-common.mjs';
import {mkdirSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export {CLIENT,VIEWPORT,render,ask,check,success};
export const COMPONENTS=['UserMessage','AssistantMessage','CommandOutput','ToolUse','ToolResult','ToolGroup','AskUserQuestion'];
export const OUTCOMES=['engine-slot-rewrite','replacement','rewrite-alone','inkless','invalid-rewrite','passthrough'];
const call={tool_use_id:'tool-r3',tool:'Bash',input:{command:'printf R3'},isRunning:false,isErrored:false,isInterrupted:false,output:{stdout:'R3',stderr:'',interrupted:false}};
export const PROPS={
 UserMessage:{text:'R3 user',origin:{kind:'sdk'},isExpanded:true},
 AssistantMessage:{text:'R3 assistant',isFirstOfReply:true},
 CommandOutput:{command:'help',args:'',text:'R3 command',isErrored:false},
 ToolUse:call,
 ToolResult:{tool_use_id:call.tool_use_id,tool:call.tool,output:call.output,isErrored:false},
 ToolGroup:{calls:[call],isActive:false,isExpanded:false},
 AskUserQuestion:{tool:'AskUserQuestion',questions:[{question:'Which path?',header:'Path',options:[{label:'One',description:'First path'},{label:'Two',description:'Second path'}],multiSelect:false}]},
};
const MODULE=`export const register = on => {
 for (const component of ${JSON.stringify(COMPONENTS)}) on('ui.render', { component }, async ($, e, next) => {
  const mode = e.requestId.split(':').at(-1)
  const {Box, Text} = $.ui.resolve(e)
  if(mode === 'passthrough') return next(e)
  if(mode === 'replacement') return <Text>R3 replacement {component}</Text>
  if(mode === 'inkless') return <Box />
  let props = {...e.props}
  if(component === 'ToolGroup') props.isExpanded = true
  else if(component === 'AskUserQuestion') props.questions = props.questions.map(q => ({...q, question:'R3 rewritten question'}))
  else if(component === 'ToolUse') props.input = {command:'printf rewritten'}
  else if(component === 'ToolResult') props.output = {...props.output, stdout:'R3 rewritten output'}
  else props.text = 'R3 rewritten text'
  if(mode === 'invalid-rewrite') {
   if(component === 'ToolGroup') props.isExpanded = 'invalid'
   else if(component === 'AskUserQuestion') props.questions = 'invalid'
   else if(component === 'ToolUse' || component === 'ToolResult') props.tool = 7
   else props.text = 7
  }
  const native = await next({...e, props})
  return mode === 'engine-slot-rewrite' ? <Box><Text>R3 slot</Text>{native}</Box> : native
 })
}
`;
function install(run,module,owner){
 const dir=join(run.home,'skills','mods-transcript-probe');
 mkdirSync(join(dir,'.claude-plugin'),{recursive:true});mkdirSync(join(dir,'hooks'),{recursive:true});
 writeFileSync(join(dir,'.claude-plugin/plugin.json'),JSON.stringify({name:'mods-transcript-probe',version:'0.3.0'}));
 writeFileSync(join(dir,'hooks/hooks.json'),JSON.stringify({modules:['./register.tsx']}));
 if(owner){copyFileSync(owner,join(dir,'hooks/to-human.tsx'));writeFileSync(join(dir,'hooks/register.tsx'),"import {registerToHuman} from './to-human'; export function register(on) { registerToHuman(on) }\n");}else writeFileSync(join(dir,'hooks/register.tsx'),module);
 return dir;
}
export async function transcriptRun(name,body,{owner,mod=true}={}){
 const run=scratchRun(name,{mod:false});if(mod)install(run,MODULE,owner);
 try{return await launch(name,run,{vars:{ANTHROPIC_BASE_URL:'http://127.0.0.1:9',ANTHROPIC_AUTH_TOKEN:'r3-control-only-not-a-credential',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},provenance:{spike:'R3',pin:'aee32faf1a86d6e6705e357da562b54af4b3211d',question:'Seven transcript sites and per-draw engine refs',controlOnly:true,...(owner?{ownerSource:owner,ownerSha256:createHash('sha256').update(readFileSync(owner)).digest('hex')}:{})}},async p=>{
  const init=success(await p.init(initPayload(run.cwd)),'initialize');
  check(p,'ui_surface_v1 available',init.capabilities?.includes('ui_surface_v1'),init.capabilities);
  success(await ask(p,'ui_attach',{surface:'desktop',client_id:CLIENT,viewport:VIEWPORT,answers:ANSWERS},'attach'),'attach');
  await body(p,run);
  check(p,'no user or model frames',!p.frames.some(r=>['user','assistant','stream_event','result'].includes(r.frame.type)));
  await ask(p,'ui_detach',{client_id:CLIENT},'detach');await endAsStop(p);
 });}finally{removeRun(run);}
}
export async function siteRun(component){
 const name='mods-surface-transcript-'+component.replace(/[A-Z]/g,(c,i)=>(i?'-':'')+c.toLowerCase());
 return transcriptRun(name,async p=>{
  for(const outcome of OUTCOMES){
   const result=success(await render(p,{component,instance_id:'r3:'+component+':'+outcome,props:PROPS[component]},outcome),'render');
   check(p,component+' '+outcome+' returns tree',Object.hasOwn(result,'tree')&&result.hooked===true,result);
   if(outcome==='invalid-rewrite'||outcome==='passthrough')check(p,'original props survive '+outcome,JSON.stringify(result.props)===JSON.stringify(PROPS[component]),result);
   if(outcome==='rewrite-alone'||outcome==='engine-slot-rewrite')check(p,'valid rewrite changes props',result.rewritten===true&&JSON.stringify(result.props)!==JSON.stringify(PROPS[component]),result);
   if(outcome==='inkless')check(p,'inkless dialog keeps native; other sites have no children',component==='AskUserQuestion'?result.tree.type==='engine'&&result.tree.ref===0:result.tree.type==='Box'&&!result.tree.children,result);
  }
 });
}
