// Shared by C8b's three pass-3 probes (docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md, Spike specifications):
// the provenance note, the scratch config home every probe runs under (never the owner's ~/.claude), and the parent's
// turn bookkeeping (a turn opens at a system init, the parent's or the engine's own, and closes at its result).
import {mkdtempSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {delay} from '../pass2/common.mjs';

export const C8B={charter:'docs/charter.md',child:'C8b',spec:'docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md',parentPin:'a1596d017618b1ab792f3f7e01d08b7de3d01ee8'};
export function scratchConfig(){const dir=mkdtempSync('/tmp/maws-c8b-config-');writeFileSync(dir+'/settings.json','{}\n');return dir;}
export const sys=(f,subtype)=>f.type==='system'&&f.subtype===subtype;
export const inits=p=>p.frames.filter(r=>sys(r.frame,'init')).length;
export const results=p=>p.frames.filter(r=>r.frame.type==='result').length;
export const turnOpen=p=>inits(p)>results(p);
// Waits until every opened turn has its result and none opens for `quiet` ms.
export async function idle(p,timeout=120000,quiet=3000){const end=Date.now()+timeout;while(Date.now()<end){if(!turnOpen(p)){await delay(quiet);if(!turnOpen(p))return true;}else await p.wait(f=>f.type==='result',{after:p.seq,timeout:Math.max(1000,end-Date.now())}).catch(()=>{});}p.note({event:'idle_timeout'});return false;}
export const spend=p=>p.note({event:'spend',total_cost_usd:Math.max(0,...p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.total_cost_usd??0))});
export function walk(dir,out=[]){if(!existsSync(dir))return out;for(const e of readdirSync(dir,{withFileTypes:true})){const f=dir+'/'+e.name;if(e.isDirectory())walk(f,out);else out.push(f);}return out;}
