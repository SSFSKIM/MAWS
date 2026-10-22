exec(compile(open('/private/tmp/holder-tui/scripts/probe.py').read().split("if __name__")[0], 'probe.py','exec'))
e=Env();short=next(iter(e.state()));out={}
t=time.time();e.text(BIN+' attach '+short);out['attach_explicit_ready']=bool(e.wait(lambda:'❯' in e.pane()));out['attach_explicit_seconds']=time.time()-t;e.snap('explicit-attach');out['state_after_attach']=e.state()
e.keys('C-z');e.wait(lambda:'bash-3.2$' in e.pane());e.snap('ctrl-z');out['state_after_ctrl_z']=e.state()
t=time.time();e.window('plain',BIN+' --model haiku',120,35);out['plain_ready']=bool(e.wait(lambda:'❯' in e.pane('plain')));out['plain_seconds']=time.time()-t;e.snap('plain',name='plain')
t=time.time();e.window('agents',BIN+' agents',120,35);out['agents_ready']=bool(e.wait(lambda: 'holder-idle' in e.pane('agents')));out['agents_seconds']=time.time()-t;e.snap('agents',name='agents');e.keys('Enter',name='agents');out['agents_enter_ready']=bool(e.wait(lambda:'❯' in e.pane('agents')));out['agents_to_prompt_seconds']=time.time()-t;e.snap('agents-enter',name='agents');e.keys('C-z',name='agents')
e.text(BIN+' attach '+short);e.wait(lambda:'❯' in e.pane());e.text('/exit');out['exit_shell']=bool(e.wait(lambda:'bash-3.2$' in e.pane()));out['state_after_exit']=e.state();e.snap('slash-exit');e.save('phase1',out);print(json.dumps(out,indent=2))
