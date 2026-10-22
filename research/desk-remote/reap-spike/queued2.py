import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
p=Probe('queued-before-arm')
try:
 p.mode(drop=False,classic_drop=False,turn_delay=6000,abort_turn=True)
 r=p.req('submit',text='ALLOW: first-turn')
 p.wait(lambda:any(e['ev']=='turn.start' for e in p.events()))
 p.type('QUEUED_BEFORE_ARM')
 p.wait(lambda:any(e['ev']=='prompt.result' and e['input']['text']=='QUEUED_BEFORE_ARM' for e in p.events()))
 p.mode(drop=True,classic_drop=True,turn_delay=3000,abort_turn=True)
 (p.root/'armed-at').write_text(str(time.time()))
 p.wait(lambda:len([e for e in p.events() if e['ev']=='turn.complete'])>=2,20)
 print('events',[(e['ev'],e.get('input',{}).get('text')) for e in p.events()],flush=True)
 p.stop()
finally:p.cleanup()
