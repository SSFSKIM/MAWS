import type { Register } from 'claude-code';
let seq=0;
export const register: Register = (on) => {
 on('session.compact',async($,e,next)=>{
  const bus=await $.env.get('TRUNC_BUS');
  await $.fs.write(`${bus}/events/${Date.now()}-guard-${seq++}.json`,JSON.stringify({event:'guard.compact',data:e,t:Date.now()}));
  if(e.instructions?.startsWith('CUT:guard:')) {
   const delay=Number(e.instructions.split(':')[3] || 0);
   if(delay) await $.clock.sleep(delay);
   return {messages:e.messages.slice(0,Number(e.instructions.split(':')[2]))};
  }
  return next(e);
 });
};
