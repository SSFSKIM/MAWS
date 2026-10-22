import runpy,os,signal,time,json,subprocess,glob,socket
p=runpy.run_path('/private/tmp/holder-tui/scripts/plain_probe.py');Env=p['Env'];ctrl=p['ctrl']
for label in ['full','main']:
 e=Env('plain-'+label);meta=json.load(open(e.root+'/pids.json'));pid=meta['child'];r={}
 def ps():return subprocess.run(['ps','-p',str(pid),'-o','pid=,ppid=,pgid=,stat=,command='],capture_output=True,text=True).stdout.strip()
 r['before_ctrl_z']=ps();r['ctrl_z_t']=time.time();e.keys('C-z',name='modes');time.sleep(.3);r['after_ctrl_z']=ps();e.snap('ctrl-z-plain',name='modes');os.kill(pid,signal.SIGCONT);time.sleep(.2);r['after_cont']=ps();e.snap('ctrl-z-resumed',name='modes');r['mod_after_cont']=e.call('id')
 r['close_t']=time.time()
 try:r['close_ack']=ctrl(e,'close-master')
 except (socket.timeout,ConnectionError):r['close_ack']='closed'
 r['child_gone']=bool(e.wait(lambda:not ps(),timeout=10));r['remaining_process']=ps();r['after_close_t']=time.time();e.snap('closed-master',name='modes');r['events']=sorted([json.load(open(f)) for f in glob.glob(e.bus+'/events/*.json')],key=lambda v:v['t'])[-4:];e.save('close-results',r);print(label,json.dumps(r,indent=2))
