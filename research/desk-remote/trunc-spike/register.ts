import type { Register } from 'claude-code';
let started = false;
let bus = '';
let seq = 0;
async function log($: any, event: string, data: any) {
  if(!bus) bus=await $.env.get('TRUNC_BUS') || '';
  await $.fs.write(`${bus}/events/${Date.now()}-${seq++}.json`, JSON.stringify({event,data,t:Date.now()}));
}
async function run($: any, m: any) {
  const before = await $.session.messages();
  try {
    let result;
    if(m.op === 'compact') result = await $.session.compact({instructions:m.instructions});
    if(m.op === 'command') result = await $.command.run({command:m.command,args:m.args || ''});
    if(m.op === 'snapshot') result = {id:await $.session.id(),messages:before};
    if(m.op === 'tool') result = await $.tool.call(m.input);
    if(m.op === 'submit') result = await $.prompt.submit({text:m.text});
    await $.fs.write(m.file+'.res', JSON.stringify({ok:true,result,before,after:await $.session.messages()}));
  } catch(e) { await $.fs.write(m.file+'.res',JSON.stringify({ok:false,error:String(e),before,after:await $.session.messages()})); }
}
export const register: Register = (on) => {
  on('session.start', async ($,e,next) => {
    const r=await next(e); bus=await $.env.get('TRUNC_BUS') || '';
    await log($,'session.start',e);
    if(!started){
      started=true;
      void (async()=>{
        const child=$.process.spawn({argv:['/usr/bin/python3','-I',`${$.plugin.root}/child.py`,bus]});
        let pending='';
        for await(const piece of child){
          if(piece.stream==='stderr')continue;
          pending+=piece.text;let ix;
          while((ix=pending.indexOf('\n'))>=0){const line=pending.slice(0,ix);pending=pending.slice(ix+1); if(line)void run($,JSON.parse(line));}
        }
      })();
    }
    return r;
  });
  on('session.compact',async($,e,next)=>{
    await log($,'self.compact',e);
    if(e.instructions?.startsWith('CUT:self:')) return {messages:e.messages.slice(0,Number(e.instructions.split(':')[2]))};
    return next(e);
  });
  on('classic.*',async($,e,next)=>{ await log($,'classic',e);return next(e); });
  on('turn.start',async($,e,next)=>{await log($,'turn.start',e);return next(e)});
  on('turn.complete',async($,e,next)=>{await log($,'turn.complete',e);return next(e)});
};
