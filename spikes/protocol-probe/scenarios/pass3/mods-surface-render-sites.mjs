// R2 (mods-surface-common.mjs): every site R2 draws, asked in the order the app asks them. After the attach and the
// roster read: the AbovePrompt band, SessionMode and PromptHint at rest; the Spinner while the no-tools turn runs; then
// the pane the mod opens when the turn completes (its ui_panes push) and the Pane site for it. The replay MAWS's e2e
// plays into the app (the band, the chip, the hint and a pane).
import {surfaceRun,render,SITES,turn,push,check,PANE} from './mods-surface-common.mjs';

export default ()=>surfaceRun('mods-surface-render-sites','R2: the render sites (AbovePrompt, SessionMode, PromptHint, Spinner, Pane) as a desktop surface asks them',{},async p=>{
 const band=await render(p,SITES.band(false),'band at rest');
 check(p,'the band is hooked',band.subtype==='success'&&band.response?.hooked===true,band);
 const mode=await render(p,SITES.mode(),'session mode');
 check(p,'the mode slot is hooked',mode.response?.hooked===true,mode);
 const hint=await render(p,SITES.hint(false),'prompt hint at rest');
 check(p,'the hint is hooked',hint.response?.hooked===true,hint);
 const at=p.seq;
 await turn(p,{during:async()=>{
  const spinner=await render(p,SITES.spinner(),'spinner while working');
  check(p,'the spinner is hooked',spinner.response?.hooked===true,spinner);
 }});
 const roster=await push(p,'ui_panes',at);
 check(p,'the pane opened at turn.complete is pushed',(roster.panes??[]).some(x=>x.id===PANE),roster);
 const pane=await render(p,SITES.pane(false),'pane');
 check(p,'the pane is hooked',pane.response?.hooked===true,pane);
});
