// R2 (mods-surface-common.mjs): `$.ui.copy({ text, surface })` naming the desktop surface: the engine's ui_copy request
// to the client that named it under `answers`, the probe's answer as MAWS's clipboard gives it, and what the plugin's
// call resolved to.
import {surfaceRun,render,SITES,ask,element,turn,check,logs,CLIENT} from './mods-surface-common.mjs';

export default ()=>surfaceRun('mods-surface-copy','R2: ui_copy answered by the surface',{ui_copy:{copied:true}},async p=>{
 const band=await render(p,SITES.band(false),'band at rest');
 const at=p.seq;
 const el=element(band.response.tree,'copy');
 await ask(p,'ui_press',{plugin:el.press.plugin,handle:el.press.handle,key:'copy',surface:'desktop',client_id:CLIENT},'press copy');
 await p.wait(f=>f.type==='system'&&f.subtype==='ui_log'&&String(f.text).startsWith('MODS_PROBE_COPIED'),{after:at,timeout:30000});
 const lines=logs(p,at);
 p.note({event:'copy_results',lines});
 check(p,'the copy resolved copied',lines.some(l=>l.includes('"isCopied":true')),lines);
 await turn(p);
});
