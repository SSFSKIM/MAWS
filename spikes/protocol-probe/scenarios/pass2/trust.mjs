// Item 8: workspaceTrust attestation, set_cwd needs_trust, and whether project settings load with and without attestation.
import {run,initPayload,scratch2} from './common.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
const RULE='Bash(echo MAWS_TRUST_PROBE:*)';
const seeded=()=>{const d=scratch2();mkdirSync(d+'/.claude');writeFileSync(d+'/.claude/settings.json',JSON.stringify({permissions:{allow:[RULE]}}));return d;};
const trustState=dirs=>{const j=JSON.parse(readFileSync(homedir()+'/.claude.json','utf8'));return Object.fromEntries(dirs.map(d=>[d,j.projects?.[d]?.hasTrustDialogAccepted??null]));};
const rules=async(p,label)=>{const r=await p.request('list_permission_rules',{});p.note({event:'rule_check',label,hasProbeRule:JSON.stringify(r.response||{}).includes('MAWS_TRUST_PROBE')});};
export default async()=>{
 const a=seeded(),b=seeded(),c=seeded();
 await run('trust-no-attestation',async p=>{p.note({event:'trust_store_before',state:trustState([a,b])});await p.request('initialize',initPayload());await rules(p,'launch-dir-no-attestation');
  const r1=await p.request('set_cwd',{path:b});await rules(p,'after-set_cwd-without-trust');
  if(r1.response?.status==='needs_trust'){await p.request('set_cwd',{path:b,trust_accepted:true,trusted_directory:r1.response.directory});await rules(p,'after-set_cwd-with-trust');}
  p.note({event:'trust_store_after',state:trustState([a,b])});
 },{cwd:a,settingSources:'project,local',model:'sonnet'});
 await run('trust-attested',async p=>{p.note({event:'trust_store_before',state:trustState([c])});const r=await p.request('initialize',initPayload({workspaceTrust:{accepted:true,directory:c}}));p.note({event:'workspace_trust_recorded',value:r.response?.workspace_trust_recorded});await rules(p,'launch-dir-attested');p.note({event:'trust_store_after',state:trustState([c])});
 },{cwd:c,settingSources:'project,local',model:'sonnet'});
};
