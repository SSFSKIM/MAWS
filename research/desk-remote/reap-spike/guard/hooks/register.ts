import type { Register, EngineInterface } from 'claude-code'
let bus = ''
let busy = false
const seen = new Set<string>()
async function log($: EngineInterface, x: any) {
 await $.fs.write(`${bus}/events/${Date.now()}-${Math.random().toString(36).slice(2)}.json`, JSON.stringify({t:Date.now(),...x}))
}
export const register:Register=(on)=>{
 on('turn.step',async function*($,e,next){
  const c=JSON.parse(await $.fs.read(`${bus}/mode.json`))
  await log($,{ev:'step.enter',input:e,mode:c})
  if(c.step_delay) await $.clock.sleep(c.step_delay)
  if(c.step_block){
   await log($,{ev:'step.refuse',input:e})
   yield {kind:'text',index:0,text:'Reap fence refused this turn.'}
   yield {kind:'stop',stopReason:'end_turn',usage:null}
   return {turnId:e.turnId,index:e.index,answer:'Reap fence refused this turn.',toolUses:[],stopReason:'end_turn',usage:null}
  }
  await log($,{ev:'step.proceed',input:e})
  return yield* next(e)
 })
 on('session.start',async($,e,next)=>{bus=(await $.env.get('REAP_BUS'))!;return next(e)})
 on('prompt.submit',async($,e,next)=>{
  const c=JSON.parse(await $.fs.read(`${bus}/mode.json`))
  await log($,{ev:'prompt.enter',input:e,mode:c})
  if(c.delay) await $.clock.sleep(c.delay)
  if(c.drop && !e.text.startsWith('ALLOW:')) {await log($,{ev:'prompt.drop',input:e});return {drop:'reap-fence-refused'}}
  const result=await next(e)
  await log($,{ev:'prompt.result',input:e,result})
  return result
 })
}
