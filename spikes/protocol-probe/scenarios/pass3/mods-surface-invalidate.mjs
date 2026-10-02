// R2 (mods-surface-common.mjs): `$.ui.invalidate('ui.render')` from a press handler: the push, and the app re-asking
// every instance it has mounted (the band, the mode slot, the hint), the band's answer changed and the others not.
import {surfaceRun,render,SITES,ask,element,push,turn,check,CLIENT} from './mods-surface-common.mjs';

export default ()=>surfaceRun('mods-surface-invalidate','R2: the ui_invalidate push a plugin causes, and the re-ask of the mounted instances',{},async p=>{
 const band=await render(p,SITES.band(false),'band at rest');
 await render(p,SITES.mode(),'session mode');
 await render(p,SITES.hint(false),'prompt hint');
 const at=p.seq;
 const el=element(band.response.tree,'press');
 await ask(p,'ui_press',{plugin:el.press.plugin,handle:el.press.handle,key:'press',surface:'desktop',client_id:CLIENT},'press');
 const invalidate=await push(p,'ui_invalidate',at);
 p.note({event:'invalidate_push',frame:invalidate});
 const again=await render(p,SITES.band(false),'band re-asked');
 check(p,'the band redrew with the press counted',JSON.stringify(again.response?.tree).includes('presses=1'),again);
 await render(p,SITES.mode(),'session mode re-asked');
 await render(p,SITES.hint(false),'prompt hint re-asked');
 await turn(p);
});
