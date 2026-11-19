// Generates the spike's clips in Chromium itself (the build VM has no ffmpeg): a second of a moving canvas and a tone,
// recorded by MediaRecorder in each container it supports. Invented content only.
window.gen = {
  supported(types) {
    return types.map((type) => ({ type, supported: MediaRecorder.isTypeSupported(type) }));
  },
  async record(type, ms = 1200) {
    const canvas = document.getElementById('c');
    const g = canvas.getContext('2d');
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    const dest = audio.createMediaStreamDestination();
    osc.frequency.value = 440;
    osc.connect(dest);
    osc.start();
    const stream = canvas.captureStream(30);
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    let frame = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${(frame * 12) % 360} 70% 50%)`;
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = '#fff';
      g.fillRect((frame * 8) % 320, 100, 40, 40);
      frame++;
    }, 33);
    const recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(200);
    await new Promise((r) => setTimeout(r, ms));
    recorder.stop();
    await done;
    clearInterval(timer);
    osc.stop();
    await audio.close();
    const blob = new Blob(chunks, { type });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: recorder.mimeType, size: bytes.length, base64: btoa(s) };
  },
};
