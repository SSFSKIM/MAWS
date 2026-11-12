// UX wave probe Z3, step 0: which model names the gateway accepts for each alias the owner's sessions use. One "Reply
// OK" turn per name, MAWS's launch; the fixture keeps the init frame's model, the answer's model and the result.
import {mawsLaunch,answer} from './uxwave-common.mjs';
const NAMES=(process.env.PZ_MODELS||'opus,fable,sonnet,haiku,claude-opus-5-5,claude-fable-5-2,claude-sonnet-5-5,claude-haiku-5-5').split(',');
export default async()=>{for(const m of NAMES){await mawsLaunch('uxwave-models-'+m.replace(/[^a-z0-9-]/g,'_'),{model:m,thinking:false},async p=>{
 const r=await p.turn('Reply with only the word OK');const init=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init')?.frame;
 const models=[...new Set(p.frames.filter(x=>x.frame.type==='assistant').map(x=>x.frame.message?.model))];
 p.note({event:'model_check',asked:m,initModel:init?.model,answerModels:models,result:{subtype:r.subtype,is_error:r.is_error,text:String(r.result).slice(0,200)},modelUsage:Object.keys(r.modelUsage||{})});
 console.log(JSON.stringify({asked:m,initModel:init?.model,answerModels:models,is_error:r.is_error,text:String(r.result).slice(0,80),modelUsage:Object.keys(r.modelUsage||{})}));
});}};
