// AudioWorklet that forwards microphone samples (with their exact frame index) to the main
// thread in small batches.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 512;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.start = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const ch = input[0];
      const frame = currentFrame;
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.start = frame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage({ frame: this.start, samples: this.buf });
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
