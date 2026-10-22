import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
p=Probe('queued')
try:
 p.mode(drop=False,classic_drop=False,turn_delay=6000,abort_turn=True)
 r=p.req('submit',text='ALLOW: queued-gate-first')
 p.wait(lambda:any(e['ev']=='turn.start' for e in p.events()))
 # A real turn exists but its model boundary remains held, with network disabled.
 p.mode(drop=True,delay=3000,classic_drop=True,turn_delay=6000,abort_turn=True)
 p.type('QUEUED_TYPED_REFUSED')
 p.wait(lambda:any(e['ev']=='prompt.drop' and e['input']['text']=='QUEUED_TYPED_REFUSED' for e in p.events()))
 p.pump(5)
 print('submit-result',p.result(r),flush=True)
 print('composer',p.result(p.req('read')),flush=True)
 p.stop()
finally:p.cleanup()
