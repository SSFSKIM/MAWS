exec(compile(open('/private/tmp/holder-tui/scripts/probe.py').read().split("if __name__")[0], 'probe.py','exec'))
e=Env('timing');e.setup();out=[]
for i in range(3):
 n='plain'+str(i);t=time.time();e.window(n,BIN+' --model haiku --permission-mode default');ready=e.wait(lambda:'shift+tab' in e.pane(n));dt=time.time()-t;e.snap(n,name=n);out.append({'mode':'plain','trial':i,'sec':dt,'ready':bool(ready)});e.text('/exit',name=n);e.wait(lambda:'PROBE_PROCESS_EXIT' in e.pane(n))
for i in range(3):
 n='holder'+str(i)
 cmd='r=$('+BIN+' --bg --model haiku --permission-mode default -n speed'+str(i)+'); printf "%s\\n" "$r"; id=$(printf "%s\\n" "$r" | sed -n "s/.*backgrounded · \\([a-f0-9]*\\).*/\\1/p"); '+BIN+' attach "$id"'
 t=time.time();e.window(n,cmd);ready=e.wait(lambda:'shift+tab' in e.pane(n));dt=time.time()-t;out.append({'mode':'bg-attach','trial':i,'daemon':'cold' if i==0 else 'warm','sec':dt,'ready':bool(ready)});e.snap(n,name=n);e.keys('C-z',name=n);e.wait(lambda:'PROBE_PROCESS_EXIT' in e.pane(n))
e.save('timings',out);print(json.dumps(out,indent=2))
