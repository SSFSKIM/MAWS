"""Replaceable routing process: each client gets a stream to the persistent host."""
import asyncio,os,sys,signal,json
root=sys.argv[1]
async def relay(r,w):
 try:
  while True:
   d=await r.read(65536)
   if not d:break
   w.write(d);await w.drain()
 finally:w.close()
async def handle(r,w):
 try:
  hr,hw=await asyncio.open_unix_connection(root+'/host.sock');await asyncio.gather(relay(r,hw),relay(hr,w))
 except (ConnectionError,OSError):w.close()
async def main():
 p=root+'/manager.sock'
 if os.path.exists(p):os.unlink(p)
 server=await asyncio.start_unix_server(handle,p);os.chmod(p,0o600)
 json.dump({'manager':os.getpid()},open(root+'/manager-pid.json','w'))
 async with server:await server.serve_forever()
asyncio.run(main())
