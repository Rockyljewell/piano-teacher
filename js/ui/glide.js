// The view of a piece follows the session's beat. When the playhead jumps back (a bar played
// again, resuming after a pause) the view glides back instead of jumping: it eases over `ms`, and
// the notes that are cleared away before the bar fade out while it goes, so nothing pops.
//
//   const g = new ViewGlide();
//   const v = g.update(session.beat, performance.now());
//   v.beat      the beat to draw
//   v.fade      1 -> 0 while gliding: how visible the notes before the cleared bar still are
//   v.gliding   a glide is going on
export const GLIDE = {
  minBeats: 0.75, // a jump back of at least this many beats glides
  baseMs: 600, // the glide takes baseMs + msPerBeat * beats to go back...
  msPerBeat: 80,
  minMs: 800, // ...but at least this long and at most this long
  maxMs: 1400,
  fadeShare: 0.5, // the old notes are gone by this share of the glide
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeInOut = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k); // (gentle: the view is never in a hurry)

export class ViewGlide {
  constructor(opts = {}) {
    this.opts = { ...GLIDE, ...opts };
    this.reset();
  }

  reset() {
    this.raw = null; // the session's beat at the last update
    this.off = 0; // how far the view was ahead of it (beats)
    this.g = null; // {off, t0}: a glide in progress
  }

  // beat: the session's beat; t: time in ms; instant: no glide (reduced motion)
  update(beat, t, { instant = false } = {}) {
    const o = this.opts;
    if (this.raw != null && this.raw - beat > o.minBeats && !instant) {
      // Jumped back: keep showing where the view was, then ease to where the playhead is.
      const off = this.raw + this.off - beat;
      this.g = { off, t0: t, ms: Math.max(o.minMs, Math.min(o.maxMs, o.baseMs + o.msPerBeat * off)) };
    }
    if (instant) this.g = null;
    this.raw = beat;
    let k = 1;
    this.off = 0;
    if (this.g) {
      k = clamp01((t - this.g.t0) / this.g.ms);
      if (k >= 1) this.g = null;
      else this.off = this.g.off * (1 - easeInOut(k));
    }
    const f = clamp01(k / o.fadeShare);
    return { beat: beat + this.off, gliding: !!this.g, fade: this.g ? 1 - f * f * (3 - 2 * f) : 0 };
  }
}
