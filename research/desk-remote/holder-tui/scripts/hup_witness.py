import os,pty,signal,time,json
root='/private/tmp/holder-tui';pid,fd=pty.fork()
if pid==0:
 def hup(sig,frame):
  with open(root+'/hup-witness.json','w') as f:json.dump({'signal':sig,'name':'SIGHUP','pid':os.getpid(),'t':time.time()},f)
  os._exit(0)
 signal.signal(signal.SIGHUP,hup);os.write(1,b'READY\n')
 while True:signal.pause()
assert b'READY' in os.read(fd,128);os.close(fd);_,status=os.waitpid(pid,0);print(json.load(open(root+'/hup-witness.json')),'status',status)
