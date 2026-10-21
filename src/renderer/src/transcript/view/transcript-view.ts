// The transcript view's chunk (../lazy.tsx imports this module, and only it, dynamically): the virtualised list and the
// slot that mounts one, so neither module is itself a dynamic import's target. The desk draws Transcript statically
// (apps/desk-web's TranscriptPane), and a module both imported dynamically and drawn statically in one chunk is a mixed
// import Vite warns of.
export { Transcript } from './Transcript';
export { TranscriptSlot } from './TranscriptSlot';
