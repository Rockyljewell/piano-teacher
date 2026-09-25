// Listener Web Worker: runs the Transcriber off the main thread so note detection never janks
// the animation (and animation never delays note detection).
//
// Wiring (see AudioEngine._buildPipeline in audio.js):
//   capture AudioWorklet --MessagePort (transferred Float32Arrays)--> this worker
//   main thread --postMessage--> this worker: init / port / control commands / relayed chunks
//   this worker --postMessage--> main thread: ready, noteon/noteoff/onset, status (~20 Hz), cal,
//                                             recording, error
import { Listener } from './listener.js';

let L = null;
let port = null;

const post = (msg, transfer) => {
  try {
    self.postMessage(msg, transfer || []);
  } catch {
    self.postMessage(msg);
  }
};

function onChunk(e) {
  const d = e.data;
  if (L && d && d.samples) L.push(d.samples, d.frame);
}

self.onmessage = (e) => {
  const m = e.data || {};
  switch (m.type) {
    case 'init':
      if (L) L.stopStatus();
      L = new Listener(m.sampleRate, m.config || {}, post);
      L.startStatus(50);
      post({ type: 'ready' });
      break;
    case 'port':
      if (port && port !== m.port) {
        try {
          port.close();
        } catch {
          /* ignore */
        }
      }
      port = m.port;
      port.onmessage = onChunk;
      break;
    case 'chunk': // relay path: the worklet could not take our port, the main thread forwards
      if (L) L.push(m.samples, m.frame);
      break;
    default:
      if (L) L.command(m);
  }
};
