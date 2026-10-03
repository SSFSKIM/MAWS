import {transcriptRun,COMPONENTS,PROPS,render,success,check} from './mods-surface-transcript-common.mjs';
export default ()=>transcriptRun('mods-surface-transcript-unhooked',async p=>{
 for(const component of COMPONENTS){
  const result=success(await render(p,{component,instance_id:'unhooked:'+component,props:PROPS[component]},'no module installed'),'unhooked draw');
  check(p,component+' is unhooked',result.hooked===false&&result.rewritten===false&&result.tree?.type==='engine'&&result.tree.ref===0,result);
 }
},{mod:false});
