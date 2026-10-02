// R2 (mods-surface-common.mjs): the composer requests the engine sends a client whose attach named them: a press runs
// `$.prompt.read`, `$.prompt.fill` and `$.prompt.suggest`; the probe answers each as MAWS's composer will (a draft, a
// fill taken, a suggestion shown) and the mod logs what each resolved to. Also one ui_prompt_edit, the person's edit
// reported as Desktop reports it.
import {surfaceRun,render,SITES,ask,element,turn,check,logs,CLIENT} from './mods-surface-common.mjs';

const ANSWERS={ui_prompt_read:{text:'MAWS draft',cursor:10},ui_prompt_fill:{filled:true},ui_prompt_suggest:{shown:true}};

export default ()=>surfaceRun('mods-surface-prompt-access','R2: ui_prompt_read, ui_prompt_fill and ui_prompt_suggest answered by the surface; ui_prompt_edit',ANSWERS,async p=>{
 const band=await render(p,SITES.band(false),'band at rest');
 await ask(p,'ui_prompt_edit',{text:'MAWS draft',cursor:10,by:'person',surface:'desktop',client_id:CLIENT},'the person typed');
 const at=p.seq;
 const el=element(band.response.tree,'prompt');
 await ask(p,'ui_press',{plugin:el.press.plugin,handle:el.press.handle,key:'prompt',surface:'desktop',client_id:CLIENT},'press prompt');
 await p.wait(f=>f.type==='system'&&f.subtype==='ui_log'&&String(f.text).startsWith('MODS_PROBE_SUGGEST'),{after:at,timeout:30000});
 const lines=logs(p,at);
 p.note({event:'prompt_results',lines});
 check(p,'the read, fill and suggest resolved',lines.some(l=>l.startsWith('MODS_PROBE_READ'))&&lines.some(l=>l.startsWith('MODS_PROBE_FILL'))&&lines.some(l=>l.startsWith('MODS_PROBE_SUGGEST')),lines);
 await turn(p);
});
