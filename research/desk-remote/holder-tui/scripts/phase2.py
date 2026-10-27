exec(compile(open('/private/tmp/holder-tui/scripts/probe.py').read().split("if __name__")[0], 'probe.py','exec'))
e=Env();out={}
out['validate']=e.cli('plugin validate '+PLUGIN)
# The existing idle job remains for gesture comparisons; only this job loads the probe mod.
args='--bg --model haiku --permission-mode plan -n holder-flags --add-dir '+e.root+'/extra --plugin-dir '+PLUGIN
out['launch']=e.cli(args);out['states']=e.state();short=[k for k,v in e.state().items() if v.get('name')=='holder-flags'][0];out['short']=short
e.text(BIN+' attach '+short);e.wait(lambda:'holder-flags' in e.pane());out['mod_ready']=bool(e.wait(lambda:glob.glob(e.bus+'/events/*.json')))
e.snap('flags-attached');out['model']=e.call('model');out['env']=e.call('env');out['check_extra']=e.call('check',tool='Read',input={'file_path':e.root+'/extra/example.txt'});out['check_other']=e.call('check',tool='Read',input={'file_path':'/private/tmp/elsewhere.txt'})
# Second attacher with smaller dimensions.
e.window('second',BIN+' attach '+short,70,20);e.wait(lambda:'❯' in e.pane('second'));e.snap('two-first');e.snap('two-second',name='second')
e.text('A',enter=False);e.text('1',name='second',enter=False);e.text('B',enter=False);e.text('2',name='second',enter=False);time.sleep(.25);e.snap('interleaved-first');e.snap('interleaved-second',name='second');e.keys('C-u');e.keys('C-z',name='second');e.wait(lambda:'PROBE_PROCESS_EXIT' in e.pane('second'));time.sleep(.2);e.snap('after-second-close')
# /exit: verify PID remains and attach again.
before=e.control('list');e.text('/exit');e.wait(lambda:'bash-3.2$' in e.pane());out['exit_before']=before;out['exit_after']=e.control('list');e.snap('flags-exit')
e.text(BIN+' attach '+short);e.wait(lambda:'holder-flags' in e.pane());e.keys('C-c');time.sleep(.2);e.snap('ctrl-c-once');e.keys('C-c');e.wait(lambda:'bash-3.2$' in e.pane());out['double_ctrl_c_after']=e.control('list');e.snap('ctrl-c-twice');e.save('phase2',out);print(json.dumps(out,indent=2))
