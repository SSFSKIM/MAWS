// Control-only capture of the engine's generic mod primitives used by UX1's output style. No model turn.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {Probe} from '../../harness.mjs';
import {clearEngineEnvironment} from '../pass3/mods-environment.mjs';

const bin='/Users/new/.local/share/claude/versions/2.1.309';
const root=realpathSync(mkdtempSync('/tmp/maws-mod-controls-'));
const home=join(root,'config'),cwd=join(root,'project'),plugin=join(root,'mod');
for(const dir of [home,cwd,join(plugin,'.claude-plugin'),join(plugin,'hooks')])mkdirSync(dir,{recursive:true});
writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
writeFileSync(join(plugin,'.claude-plugin/plugin.json'),JSON.stringify({name:'mod-controls-probe',version:'0.1.0'}));
writeFileSync(join(plugin,'hooks/hooks.json'),JSON.stringify({modules:['./register.tsx']}));
writeFileSync(join(plugin,'hooks/register.tsx'),`export function register(on) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const {Box,Text,Button,Markdown}=$.ui.resolve(e);
    const press=()=>{};
    return <Box flexDirection="column">
      <Text color="claude" bold>message</Text>
      <Markdown text={'Before\\n\\n1. First\\n2. Second\\n\\n\`⚠ Critical ───\`\\nDetails.'}/>
      <Box key="record-row" hover={{backgroundColor:'blue'}}>
        <Text dimColor>Record · </Text>
        <Button key="record" label="working record" plain dimColor hover={{inverse:false,dimColor:false}} onPress={press}>› working record</Button>
      </Box>
      <Box key="fold-row"><Button key="fold" label="fold to report" plain dimColor hover={{inverse:false,dimColor:false}} onPress={press}>‹ fold to report</Button></Box>
      <Box key="mode-row"><Text dimColor>to-human view · </Text><Button key="mode" label="full transcript" plain dimColor hover={{inverse:false,dimColor:false}} onPress={press}>full transcript ›</Button></Box>
    </Box>;
  });
}
`);
const version=execFileSync(bin,['--version'],{encoding:'utf8'}).trim();
clearEngineEnvironment();
const probe=new Probe('p4-ux1c-mod-controls',{cwd,bin,dir:'fixtures/p4/',noModel:true,settingSources:'user',env:{CLAUDE_CONFIG_DIR:home,DISABLE_AUTOUPDATER:'1',ANTHROPIC_BASE_URL:'http://127.0.0.1:9',ANTHROPIC_AUTH_TOKEN:'control-only-no-credential',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'},flags:['--plugin-dir',plugin,'--no-session-persistence','--include-hook-events']});
const viewport={columns:100,rows:40};
const client_id='maws-mod-controls';
const success=(value)=>{assert.equal(value.subtype,'success',JSON.stringify(value));return value.response;};
try{
  probe.note({event:'provenance',engineVersion:version,controlOnly:true,inferenceEndpoint:'closed localhost port',config:'isolated temporary config and scratch plugin',finding:'l2-transcript-03',modSource:'minimal generic primitives; doperpowers PR #363 d17d9b7 control shape'});
  success(await probe.init({workspaceTrust:{accepted:true,directory:cwd}}));
  success(await probe.request('ui_attach',{surface:'desktop',client_id,viewport,answers:[]}));
  const answer=success(await probe.request('ui_render',{surface:'desktop',client_id,viewport,component:'AbovePrompt',instance_id:'mod-controls',props:{isLoading:false,hasSurvey:false}}));
  assert.equal(answer.hooked,true,'mod did not draw');
  probe.note({event:'mod_controls_tree',tree:answer.tree});
  const buttons=[];
  const walk=node=>{if(node&&typeof node==='object'){if(node.type==='Button')buttons.push(node);for(const child of node.children??[])walk(child);}};
  walk(answer.tree);
  assert.equal(buttons.length,3);
  for(const button of buttons){
    assert.ok(button.children?.length);
    assert.deepEqual(button.hover,{inverse:false,dimColor:false});
    success(await probe.request('ui_press',{client_id,plugin:button.press.plugin,handle:button.press.handle,key:button.props.key}));
  }
  assert.equal(probe.frames.filter(row=>row.frame.type==='result').length,0);
  probe.note({event:'model_call_check',outgoingPrompts:0,modelResults:0});
  success(await probe.request('ui_detach',{client_id}));
}finally{
  await probe.stop();
  rmSync(root,{recursive:true,force:true});
}
console.log(JSON.stringify({fixture:probe.file,engineVersion:version,controlOnly:true}));
