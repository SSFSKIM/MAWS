import type { Register, EngineInterface } from 'claude-code'
let bus = ''
let busy = false
const seen = new Set<string>()
async function log($: EngineInterface, x: any) {
 await $.fs.write(`${bus}/events/${Date.now()}-${Math.random().toString(36).slice(2)}.json`, JSON.stringify({t:Date.now(),...x}))
}
async function poll($: EngineInterface) {
 if (busy) return
 busy=true
 try {
  for (const f of await $.fs.list(bus)) {
   if (!f.name.endsWith('.req.json') || seen.has(f.name)) continue
   seen.add(f.name)
   const r=JSON.parse(await $.fs.read(`${bus}/${f.name}`))
   void (async()=>{
    await log($,{ev:'request',file:f.name,req:r})
    try {
     let value:any
     if(r.op==='submit') value=await $.prompt.submit({text:r.text})
     if(r.op==='run') value=await $.command.run({command:r.command,args:r.args})
     if(r.op==='tool') value=await $.tool.call(r.input)
     if(r.op==='tools') value=await $.tool.list()
     if(r.op==='read') value=await $.prompt.read()
     if(r.op==='messages') value=await $.session.messages()
     await $.fs.write(`${bus}/${f.name}.res`,JSON.stringify({t:Date.now(),ok:true,value:value??null}))
    }catch(e){await $.fs.write(`${bus}/${f.name}.res`,JSON.stringify({t:Date.now(),ok:false,error:String(e)}))}
   })()
  }
 }finally{busy=false}
}
export const register:Register=(on)=>{
 on('session.start',async($,e,next)=>{bus=(await $.env.get('REAP_BUS'))!;await log($,{ev:'session.start',id:await $.session.id()});$.clock.every(100,()=>{void poll($)});return next(e)})
 on('turn.start',async($,e,next)=>{await log($,{ev:'turn.start',input:e});const c=JSON.parse(await $.fs.read(`${bus}/mode.json`));if(c.turn_delay) await $.clock.sleep(c.turn_delay);if(c.abort_turn){const value=await $.turn.abort({turnId:e.turnId});await log($,{ev:'turn.aborted',value})}return next(e)})
 on('turn.complete',async($,e,next)=>{await log($,{ev:'turn.complete',input:e});return next(e)})
 on('session.end',async($,e,next)=>{await log($,{ev:'session.end',input:e});return next(e)})
 on('tool.call',async($,e,next)=>{await log($,{ev:'tool.call',input:e});return next(e)})
}
