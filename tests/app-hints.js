// Lesson hints as the app sends them (js/ui/play.js -> audio.setExpected): the notes due now that
// the practice engine (js/game/engine.js) has not matched yet - a multiset of MIDI numbers in score
// order. A key that was just heard leaves the list; if the same key is due again (repeated notes,
// trills, repeated chords) its next instance stays in it.
//
//   const h = new AppHints(notes);              notes: [{ midi, tn }] (tn: score time, s)
//   h.report(midi, t, at)                       the listener reported `midi` (attack t) at time `at`
//   h.due(now)                                  -> [midi, ...] to pass to setExpected
//
// Matching is the engine's (tempo mode): a report goes to the nearest unmatched note of that key
// whose score time is within its window (the profile's "ok" window, but at most half the gap to
// the next note of the same key, at least 90 ms). The list covers notes due within
// -behind..+ahead s of now (the bench's window). A report reaches the list `delay` s after the
// listener made it (worker hop + the next animation frame).
export class AppHints {
  constructor(notes, { behind = 0.25, ahead = 0.35, ok = 0.28, delay = 0.03 } = {}) {
    this.notes = notes.map((n, i) => ({ midi: n.midi, tn: n.tn ?? n.t, i })).sort((a, b) => a.tn - b.tn || a.i - b.i);
    this.behind = behind;
    this.ahead = ahead;
    this.delay = delay;
    this.matched = new Uint8Array(this.notes.length);
    this.win = new Float64Array(this.notes.length);
    const byKey = new Map();
    this.notes.forEach((n, k) => {
      if (!byKey.has(n.midi)) byKey.set(n.midi, []);
      byKey.get(n.midi).push(k);
    });
    for (const ks of byKey.values())
      ks.forEach((k, j) => {
        let gap = Infinity;
        if (j > 0) gap = Math.min(gap, this.notes[k].tn - this.notes[ks[j - 1]].tn);
        if (j < ks.length - 1) gap = Math.min(gap, this.notes[ks[j + 1]].tn - this.notes[k].tn);
        this.win[k] = gap > 1e-6 ? Math.max(0.09, Math.min(ok, gap * 0.5)) : ok;
      });
    this.queue = []; // reports not yet applied: { midi, t, at }
    this.lo = 0;
  }

  report(midi, t, at = t) {
    this.queue.push({ midi, t, at: at + this.delay });
  }

  _apply(r) {
    let best = -1,
      bestErr = Infinity;
    for (let k = 0; k < this.notes.length; k++) {
      const n = this.notes[k];
      if (this.matched[k] || n.midi !== r.midi) continue;
      const err = Math.abs(r.t - n.tn);
      if (err <= this.win[k] && err < bestErr) (best = k), (bestErr = err);
    }
    if (best >= 0) this.matched[best] = 1;
  }

  due(now) {
    if (this.queue.length) {
      const rest = [];
      for (const r of this.queue) if (r.at <= now) this._apply(r);
      else rest.push(r);
      this.queue = rest;
    }
    while (this.lo < this.notes.length && this.notes[this.lo].tn <= now - this.behind) this.lo++;
    const out = [];
    for (let k = this.lo; k < this.notes.length && this.notes[k].tn < now + this.ahead; k++) if (!this.matched[k]) out.push(this.notes[k].midi);
    return out;
  }
}
