// AudioWorklet that cuts the microphone signal into 512-sample chunks tagged with their exact
// frame index (the AudioContext clock) and sends them to the listener.
//
// Normal path: the main thread passes in a MessagePort ({type: 'port', port}) whose other end
// belongs to the listener Web Worker, so chunks go straight from the audio thread to the worker
// (buffers are transferred, not copied) and never touch the main thread. Without a port (older
// browsers, or the main-thread fallback) chunks go to this node's own port as before.
//
// A small heartbeat ({type: 'hb'}) goes to the main thread ~4x per second: the frame, how many
// input channels are connected and how many chunks were sent. The health supervisor uses it to
// tell "the audio thread stopped" from "the microphone delivers nothing".
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.size = o.chunk || 512;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.start = 0;
    this.out = null; // MessagePort to the listener worker
    this.sent = 0;
    this.calls = 0;
    this.hbEvery = Math.max(1, Math.round(((o.heartbeatSec ?? 0.25) * sampleRate) / 128));
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'port' && d.port) {
        if (this.out && this.out !== d.port) {
          try {
            this.out.close();
          } catch {
            /* ignore */
          }
        }
        this.out = d.port;
        this.port.postMessage({ type: 'port-ok' });
      } else if (d.type === 'unport') {
        this.out = null;
      }
    };
  }

  _send() {
    const msg = { frame: this.start, samples: this.buf };
    const dest = this.out || this.port;
    try {
      dest.postMessage(msg, [this.buf.buffer]);
    } catch {
      try {
        this.port.postMessage(msg); // transfer not supported: copy
      } catch {
        /* ignore */
      }
    }
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.sent++;
  }

  process(inputs) {
    const input = inputs[0];
    const chans = input ? input.length : 0;
    if (chans) {
      const ch = input[0];
      const frame = currentFrame;
      // a gap in the input (source reconnected): drop the partial chunk so frames stay exact
      if (this.n > 0 && frame !== this.start + this.n) this.n = 0;
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.start = frame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) this._send();
      }
    }
    if (++this.calls % this.hbEvery === 0) this.port.postMessage({ type: 'hb', frame: currentFrame, chans, sent: this.sent });
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
