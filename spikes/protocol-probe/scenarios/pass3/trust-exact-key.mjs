// C10 M1, the check before relying on the trust card (C10 document, Trust, "Which binary and which predicate"): does
// an accepted ancestor satisfy the headless trust gate? An initialize-only, unattested launch of the pinned engine in
// a fresh non-repository directory carrying a project allow rule, under a scratch config home whose `.claude.json`
// accepts "/" and nothing else. Expected (the card as written): the stderr trust notice, no
// `workspace_trust_recorded` in the initialize response, and `list_permission_rules` without the sentinel.
import {launch,scratchConfigHome,tempDir,initPayload,success,check,endAsStop,stderrText,trustOf,projectListing,mkdirSync,writeFileSync,join} from './c10-common.mjs';

const RULE='Bash(echo MAWS_C10_EXACT_KEY:*)';

export default async()=>{
 const dir=tempDir('/tmp/maws-probe3-exact-');
 mkdirSync(join(dir,'.claude'));writeFileSync(join(dir,'.claude','settings.json'),JSON.stringify({permissions:{allow:[RULE]}}));
 const configHome=scratchConfigHome({'/':{hasTrustDialogAccepted:true}});
 const {p}=await launch('trust-exact-key',{cwd:dir,env:{CLAUDE_CONFIG_DIR:configHome}},async(p,{globalConfig})=>{
  p.note({event:'trust_store_before',state:trustOf(globalConfig,['/',dir])});
  const init=success(await p.init(initPayload()),'initialize');
  p.note({event:'initialize_trust',workspace_trust_recorded:init.workspace_trust_recorded??null});
  check(p,'initialize response carries no workspace_trust_recorded',!('workspace_trust_recorded' in init));
  const rules=success(await p.request('list_permission_rules',{}),'list_permission_rules');
  p.note({event:'rule_check',hasSentinel:JSON.stringify(rules).includes('MAWS_C10_EXACT_KEY')});
  check(p,'the sentinel rule is not loaded',!JSON.stringify(rules).includes('MAWS_C10_EXACT_KEY'));
  await endAsStop(p);
  check(p,'the stderr trust notice was printed',/this workspace has not been trusted/.test(stderrText(p)));
  p.note({event:'trust_store_after',state:trustOf(globalConfig,['/',dir])});
  p.note({event:'project_directory_after',...projectListing(configHome,dir)});
 });
 console.log('trust-exact-key recorded',p.file);
};
