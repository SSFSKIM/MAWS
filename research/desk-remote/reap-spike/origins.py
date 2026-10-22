import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
p=Probe('origins')
try:
 p.mode(drop=False,delay=3000,classic_drop=True,classic_delay=3000,abort_turn=True)
 r=p.req('tool',input={'tool':'Bash','command':'sleep 2; echo BACKGROUND_DONE','description':'Probe idle completion','run_in_background':True});print('background',p.result(r),flush=True)
 p.pump(10)
 print('events-after-bg',[(e['ev'],e.get('input',{}).get('origin')) for e in p.events()],flush=True)
 r=p.req('tool',input={'tool':'CronCreate','cron':'* * * * *','prompt':'CRON_PROBE_FIRE','recurring':False});print('cron',p.result(r),flush=True)
 r=p.req('tool',input={'tool':'ScheduleWakeup','delaySeconds':60,'reason':'Probe scheduled origin','prompt':'WAKEUP_PROBE_FIRE','noop':True});print('wakeup',p.result(r),flush=True)
 p.wait(lambda:len([e for e in p.events() if e['ev']=='prompt.enter' and ('CRON_PROBE_FIRE' in e['input']['text'] or 'WAKEUP_PROBE_FIRE' in e['input']['text'])])>=2,100)
 p.pump(8)
 p.stop()
finally:p.cleanup()
