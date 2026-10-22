import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
p=Probe('basic4')
try:
 p.mode(drop=True,delay=3000,classic_drop=True)
 p.type('typed-refused')
 p.wait(lambda:any(x.get('ev')=='prompt.drop' for x in p.events()))
 p.pump(.5)
 r=p.req('read');print('composer-after-refusal',p.result(r),flush=True)
 r=p.req('submit',text='plugin-refused');print('plugin-refusal',p.result(r),flush=True)
 p.mode(drop=False,delay=3000,classic_drop=True)
 os.write(p.master,b'\x15');p.type('typed-classic-refused')
 p.wait(lambda:any(x.get('ev')=='prompt.result' and x.get('input',{}).get('text')=='typed-classic-refused' for x in p.events()))
 r=p.req('submit',text='plugin-classic-refused');print('plugin-classic',p.result(r),flush=True)
 r=p.req('tools');out=p.result(r);print('tools', [t['name'] for t in out['value']],flush=True)
 p.stop()
finally:p.cleanup()
