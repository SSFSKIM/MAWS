exec(compile(open('/private/tmp/holder-tui/scripts/probe.py').read().split("if __name__")[0], 'probe.py','exec'))
e=Env();short='f792a270';out={}
def attached(n):return 'plan mode on' in e.pane(n) and 'holder-flags' in e.pane(n)
e.window('human',BIN+' attach '+short,120,35);assert e.wait(lambda:attached('human'));e.snap('human-start',name='human')
e.window('web',BIN+' attach '+short,70,20);assert e.wait(lambda:attached('web'));time.sleep(.2);e.snap('both-human',name='human');e.snap('both-web',name='web')
e.keys('C-u',name='human')
for n,c in [('human','A'),('web','1'),('human','B'),('web','2')]:e.text(c,name=n,enter=False)
e.wait(lambda:'A1B2' in e.pane('human'));e.snap('mix-human',name='human');e.snap('mix-web',name='web')
e.keys('C-u',name='human');e.keys('C-z',name='web');assert e.wait(lambda:'PROBE_PROCESS_EXIT' in e.pane('web'));time.sleep(.25);e.snap('web-closed-human',name='human')
out['before_exit']=e.control('list');e.text('/exit',name='human');time.sleep(.8);e.snap('real-slash-exit',name='human');out['after_exit']=e.control('list');out['state_after_exit']=e.state()
# Escape whatever view /exit chose, by terminal Ctrl+Z only.
e.keys('C-z',name='human');time.sleep(.2)
e.window('ctrlc',BIN+' attach '+short,120,35);assert e.wait(lambda:attached('ctrlc'));e.keys('C-u',name='ctrlc');e.keys('C-c',name='ctrlc');time.sleep(.2);e.snap('real-ctrlc-one',name='ctrlc');e.keys('C-c',name='ctrlc');time.sleep(.8);e.snap('real-ctrlc-two',name='ctrlc');out['after_ctrlc']=e.control('list');out['state_after_ctrlc']=e.state();e.keys('C-z',name='ctrlc')
e.save('phase3',out);print('done',[(j['short'],j.get('pid'),j.get('state')) for j in out['after_ctrlc'].get('jobs',[])])
