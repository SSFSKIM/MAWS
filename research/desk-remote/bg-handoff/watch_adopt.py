"""Copy every adopt.json* that appears under <cfg>/jobs/*/ (polling every 10 ms), so a consumed carrier is kept."""
import glob, os, shutil, sys, time
cfg, dest, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
os.makedirs(dest, exist_ok=True)
seen = {}
end = time.time() + secs
while time.time() < end:
    for p in glob.glob(os.path.join(cfg, "jobs", "*", "adopt.json*")):
        try:
            st = os.stat(p)
            key = (p, st.st_mtime_ns, st.st_size)
            if key in seen:
                continue
            data = open(p, "rb").read()
            seen[key] = True
            name = "%s_%s_%d" % (p.split("/")[-2], os.path.basename(p), int(time.time() * 1000))
            open(os.path.join(dest, name), "wb").write(data)
            print(time.strftime("%H:%M:%S"), "copied", p, len(data), flush=True)
        except OSError:
            pass
    time.sleep(0.01)
