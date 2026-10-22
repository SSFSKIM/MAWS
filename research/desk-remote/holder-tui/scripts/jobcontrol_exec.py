"""Minimal same-session parent so the TUI's foreground process group is not orphaned."""
import os,sys,signal,json,time
root,binpath,plugin=sys.argv[1:];r,w=os.pipe();child=os.fork()
if child==0:
 os.close(w);os.setpgid(0,0);os.read(r,1);os.close(r);os.execv(binpath,[binpath,'--model','haiku','--permission-mode','default','--plugin-dir',plugin])
os.close(r);os.setpgid(child,child);os.tcsetpgrp(0,child);json.dump({'helper':os.getpid(),'engine':child},open(root+'/jobcontrol-pids.json','w'));os.write(w,b'1');os.close(w)
def forward(sig,frame):
 try:os.killpg(child,sig)
 except ProcessLookupError:pass
for sig in [signal.SIGHUP,signal.SIGTERM,signal.SIGINT]:signal.signal(sig,forward)
f=open(root+'/out/jobcontrol-events.jsonl','a',buffering=1)
while True:
 pid,status=os.waitpid(child,os.WUNTRACED|os.WCONTINUED);f.write(json.dumps({'t':time.time(),'pid':pid,'status':status,'stopped':os.WIFSTOPPED(status),'continued':os.WIFCONTINUED(status)})+'\n')
 if os.WIFEXITED(status):sys.exit(os.WEXITSTATUS(status))
 if os.WIFSIGNALED(status):sys.exit(128+os.WTERMSIG(status))
