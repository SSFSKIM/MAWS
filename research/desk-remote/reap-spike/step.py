import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
p=Probe('step-gate')
try:
 p.mode(drop=True,classic_drop=True,step_delay=3000,step_block=True)
 p.type('! printf STEP_BASH_BYPASS')
 p.wait(lambda:any(e['ev']=='step.refuse' for e in p.events()),15)
 p.wait(lambda:any(e['ev']=='turn.complete' for e in p.events()),10)
 print('bash-gate-complete',flush=True)
 p.mode(drop=False,classic_drop=False,delay=3000,step_delay=3000,step_block=True)
 r=p.req('submit',text='PLUGIN_STEP_FENCED')
 print('sender',p.result(r),flush=True)
 p.wait(lambda:len([e for e in p.events() if e['ev']=='turn.complete'])>=2,15)
 print('prompt',p.result(p.req('read')),flush=True)
 p.stop()
finally:p.cleanup()
