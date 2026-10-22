import runpy,re,json,time,os,subprocess
p=runpy.run_path('/private/tmp/holder-tui/scripts/plain_probe.py');Env=p['Env'];ctrl=p['ctrl'];detach=p['detach'];S=p['SCRIPTS']
for label in ['full','main']:
 e=Env('plain-'+label);out={}
 for i in range(20):
  r=e.call('run',command='rename',args='history-%02d'%i)
  assert r and r.get('ok'),r
 e.snap('long-before',name='after');detach(e,'after')
 data=open(e.root+'/out/pty.raw','rb').read();modes={}
 for m in re.finditer(rb'\x1b\[\?([\d;]+)([hl])',data):
  for n in m[1].split(b';'):modes[int(n)]=m[2]==b'h'
 restore=b''.join(b'\x1b[?'+str(k).encode()+b'h' for k,v in modes.items() if v and k in [1000,1002,1003,1004,1006,1049,2004,2031]);open(e.root+'/out/mode-preamble.bin','wb').write(restore);out['modes']=modes
 before=open(e.root+'/out/host-events.jsonl').read().count('"op": "attach"')
 e.window('modes','/usr/bin/python3 -I '+S+'/pty_client.py '+e.root+'/manager.sock '+e.root+'/out/mode-preamble.bin');assert e.wait(lambda:open(e.root+'/out/host-events.jsonl').read().count('"op": "attach"')>before)
 t=time.time();ctrl(e,'winch');time.sleep(.25);e.snap('long-winch',name='modes');out['winch_t']=t;t=time.time();ctrl(e,'jiggle');time.sleep(.3);e.snap('long-jiggle',name='modes');out['jiggle_t']=t
 out['pane_modes']=subprocess.run(e.tmux+['display-message','-p','-t','modes','#{alternate_on} #{mouse_any_flag} #{pane_title}'],capture_output=True,text=True).stdout
 # Confirm history is still an application property even though terminal scrollback isn't replayed.
 e.keys('Up',name='modes');time.sleep(.2);e.snap('long-up',name='modes');e.keys('C-u',name='modes');e.save('long-repaint',out)
print('done')
