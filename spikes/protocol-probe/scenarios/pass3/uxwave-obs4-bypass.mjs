// The owner's observation set 4, item 2 (2026-11-27): every session launched so that Bypass permissions can be chosen
// later without starting in it. Does `--allow-dangerously-skip-permissions` on MAWS's launch line leave the session in
// the mode it was launched in (asking as that mode asks), and let `set_permission_mode bypassPermissions` succeed later,
// where today the engine refuses it? Answered against the scripted Messages API stand-in (../../stub-api.mjs, nothing
// spent) under a scratch CLAUDE_CONFIG_DIR (p1-common.mjs).
//   uxwave-obs4-bypass-unflagged   MAWS's launch line as it was, default mode: `set_permission_mode bypassPermissions`
//                                  (the refusal the owner met)
//   uxwave-obs4-bypass-default     with the flag, default mode: a Bash call still raises can_use_tool; then
//                                  `set_permission_mode bypassPermissions`, and the next Bash call runs without asking
//   uxwave-obs4-bypass-accept      with the flag, launched in acceptEdits: the mode initialize and system/init report
//   uxwave-obs4-bypass-plan        with the flag, launched in plan: the same
import {check,success,initFrame,endAsStop,launch,scratchRun,removeRun,initPayload,randomUUID,existsSync,join} from './p1-common.mjs';
import {startStubApi,textTurn,toolTurn} from '../../stub-api.mjs';

const FLAG='--allow-dangerously-skip-permissions';
const PROVENANCE={charter:'docs/charter.md',child:'the UX wave, the owner\'s observation set 4',api:'stub-api.mjs (nothing spent)'};
const bash=(id,file)=>toolTurn(id,'Bash',{command:`touch ${file}`,description:'Create a probe file'});

async function probe(name,{question,flags=[],mode='default',script=[textTurn('ready')],body}){
 const run=scratchRun(name.replace(/^uxwave-/,''));
 const stub=await startStubApi({script,record:b=>({model:b.model})});
 try{
  await launch(name,run,{dir:'fixtures/uxwave/',relay:false,spendCap:'0.01',sessionId:randomUUID(),mode,flags,vars:{ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token'},provenance:{...PROVENANCE,question}},async p=>{
   const asked=[];
   p.on('can_use_tool',r=>{asked.push(r.tool_name);p.note({event:'can_use_tool_seen',tool:r.tool_name,input:r.input});return {behavior:'deny',message:'The probe denies it.'};});
   const init=success(await p.init(initPayload(run.cwd)),'initialize');
   p.note({event:'initialized',launchMode:mode,flags,currentPermissionMode:init.current_permission_mode??null});
   await body(p,{run,asked});
   const sysInit=initFrame(p);
   p.note({event:'system_init',present:sysInit!==undefined,permissionMode:sysInit?.permissionMode??null});
   await endAsStop(p);
  });
 }finally{await stub.close();removeRun(run);}
}

const setBypass=async p=>{
 const answer=await p.request('set_permission_mode',{mode:'bypassPermissions'},15000).catch(e=>({error:String(e.message)}));
 p.note({event:'control_answer',subtype:'set_permission_mode',mode:'bypassPermissions',answer});
 return answer;
};
const turn=async p=>{await p.turn('Say ready.');};

const SCENARIOS={
 'uxwave-obs4-bypass-unflagged':{question:'the launch line without the flag, default mode: set_permission_mode bypassPermissions',body:async p=>{await setBypass(p);await turn(p);}},
 'uxwave-obs4-bypass-default':{
  question:'with the flag, default mode: a Bash call still asks; after set_permission_mode bypassPermissions the next runs unasked',
  flags:[FLAG],
  script:[bash('toolu_probe_a','probe-a.txt'),textTurn('denied'),bash('toolu_probe_b','probe-b.txt'),textTurn('done')],
  body:async(p,{run,asked})=>{
   await p.turn('Create probe-a.txt.');
   p.note({event:'first_turn',asked:asked.slice(),created:existsSync(join(run.cwd,'probe-a.txt'))});
   check(p,'the flag alone does not bypass: the first Bash call asked',asked.includes('Bash'),asked);
   const before=asked.length;
   await setBypass(p);
   await p.turn('Create probe-b.txt.');
   p.note({event:'second_turn',asked:asked.slice(before),created:existsSync(join(run.cwd,'probe-b.txt'))});
  },
 },
 'uxwave-obs4-bypass-accept':{question:'with the flag, launched in acceptEdits: the reported mode',flags:[FLAG],mode:'acceptEdits',body:turn},
 'uxwave-obs4-bypass-plan':{question:'with the flag, launched in plan: the reported mode',flags:[FLAG],mode:'plan',body:turn},
};

export default async()=>{
 const only=(process.env.OBS4_ONLY??'').split(',').filter(Boolean);
 for(const [name,scenario] of Object.entries(SCENARIOS))if(only.length===0||only.includes(name))await probe(name,scenario);
};
