import type { Register, EngineInterface } from 'claude-code'
let bus = ''
let pending: any[] = []
const accepted = new Set<string>()
let child: any
async function log($: EngineInterface, x: any) {
 await $.fs.write(`${bus}/events/${Date.now()}-${Math.random().toString(36).slice(2)}.json`, JSON.stringify({t:Date.now(),...x}))
}
async function command($: EngineInterface, r: any) {
 await log($,{ev:'request',r})
 try {
  let value: any
  if(r.op==='queue') {if(accepted.has(r.id))value={duplicate:r.id};else{accepted.add(r.id);pending.push(r);value={queued:r.id}}}
  if(r.op==='submit') value=await $.prompt.submit({text:r.text})
  if(r.op==='append') value=await $.session.append({message:{type:r.type||'user',content:[{type:'text',text:r.text}]}})
  if(r.op==='messages') value=await $.session.messages()
  if(r.op==='tool') value=await $.tool.call({tool:'Read',file_path:r.path})
  if(r.op==='read') value=await $.prompt.read()
  await $.fs.write(`${bus}/${r.rid}.res.json`,JSON.stringify({t:Date.now(),ok:true,value:value??null}))
 } catch(e) {await $.fs.write(`${bus}/${r.rid}.res.json`,JSON.stringify({t:Date.now(),ok:false,error:String(e)}))}
}
export const register:Register=(on)=>{
 on('session.start',async($,e,next)=>{
  bus=(await $.env.get('MEDIA_BUS'))!
  await log($,{ev:'session.start',id:await $.session.id()})
  void (async()=>{
   let buffer=''
   child=$.process.spawn({argv:['/usr/bin/python3','-I',`${$.plugin.root}/child.py`,bus]})
   for await(const piece of child) {
    if(piece.stream==='stderr') {await log($,{ev:'child.stderr',text:piece.text});continue}
    buffer+=piece.text
    let pos:number
    while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);if(line) void command($,JSON.parse(line))}
   }
  })()
  return next(e)
 })
 on('prompt.submit',async($,e,next)=>{await log($,{ev:'prompt.hook',input:e});return next(e)})
 on('turn.start',async($,e,next)=>{await log($,{ev:'turn.start',input:e});return next(e)})
 on('turn.complete',async($,e,next)=>{await log($,{ev:'turn.complete',input:e});return next(e)})
 on('session.append',async($,e,next)=>{await log($,{ev:'append',input:e});return next(e)})
 on('tool.call',async($,e,next)=>{await log($,{ev:'tool.call',input:e});const result=await next(e);await log($,{ev:'tool.result',tool:e.tool,result});return result})
 on('classic.PermissionRequest',async($,e,next)=>{
  const c=JSON.parse(await $.fs.read(`${bus}/mode.json`))
  await log($,{ev:'permission',input:e,allow:c.allow})
  if(c.allow && e.tool_name==='Read' && String((e.tool_input as any).file_path).startsWith(c.allow))return {decision:{behavior:'allow'}}
  return next(e)
 })
 on('turn.step',async function*($,e,next){
  await log($,{ev:'step.enter',input:e,pending:pending.map(x=>x.id)})
  if(e.agentId || !pending.length)return yield* next(e)
  const r=pending.shift()
  await log($,{ev:'step.claim',id:r.id,input:e})
  const input={file_path:r.path,...(r.pages?{pages:r.pages}:{})}
  const answer=`[Bridge-requested upload ${r.id}; native Read, not a model choice.]`
  if(r.negative)return {turnId:e.turnId,index:e.index,answer:'',toolUses:[{name:'Read',input}],stopReason:'tool_use',usage:null}
  if(r.note) {const value=await $.session.append({message:{type:r.note,content:[{type:'text',text:answer}]}});await log($,{ev:'step.note',value})}
  if(r.text!==false)yield {kind:'text',index:0,text:answer}
  if(r.delay) {await log($,{ev:'step.delay',id:r.id});await $.clock.sleep(r.delay)}
  yield {kind:'tool',index:r.text===false?0:1,id:`bridge_${r.id}`,name:'Read'}
  yield {kind:'input',index:r.text===false?0:1,json:JSON.stringify(input)}
  if(r.delayAfter) {await log($,{ev:'step.delay',id:r.id,stage:'after-input'});await $.clock.sleep(r.delayAfter)}
  yield {kind:'stop',stopReason:'tool_use',usage:null}
  await log($,{ev:'step.yielded',id:r.id})
  return {turnId:e.turnId,index:e.index,answer,toolUses:[{name:'Read',input}],stopReason:'tool_use',usage:null}
 })
}
