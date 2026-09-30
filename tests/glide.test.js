// The view glides back when the playhead jumps back (a bar played again), so the staff and the
// falling notes never jump: js/ui/glide.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewGlide, GLIDE } from '../js/ui/glide.js';

// Frames at 60 fps; the session's beat runs at `bps` beats a second, and jumps to `jumpTo` at t = jumpAt.
function run({ from = 6, jumpTo = -1, jumpAt = 100, bps = 1, frames = 90, opts, instant = false } = {}) {
  const g = new ViewGlide(opts);
  const out = [];
  let beat = from;
  let jumped = null;
  for (let i = 0; i < frames; i++) {
    const t = 1000 + (i * 1000) / 60;
    if (jumped == null && t >= 1000 + jumpAt) {
      beat = jumpTo;
      jumped = t;
    } else if (i) beat += bps / 60;
    out.push({ t, raw: beat, ...g.update(beat, t, { instant }) });
  }
  return { out, jumped };
}

test('no jump, no glide: the view is the session\'s beat', () => {
  const { out } = run({ jumpAt: 1e9 });
  assert.ok(out.every((v) => !v.gliding && v.fade === 0));
  assert.ok(out.every((v) => Math.abs(v.beat - v.raw) < 1e-9));
});

test('a jump back glides: the first frame still shows where the view was, then it eases back', () => {
  const { out, jumped } = run();
  const at = out.findIndex((v) => v.t >= jumped);
  const before = out[at - 1];
  const first = out[at];
  assert.ok(first.gliding);
  assert.ok(Math.abs(first.beat - before.beat) < 0.1, `no jump on the first frame (${before.beat.toFixed(2)} -> ${first.beat.toFixed(2)})`);
  assert.equal(first.fade, 1, 'the old notes are still fully there');
  // no frame moves the view by more than a fifth of a beat (before: one frame, 7 beats)
  for (let i = 1; i < out.length; i++) assert.ok(Math.abs(out[i].beat - out[i - 1].beat) < 0.2, `frame ${i}: ${out[i - 1].beat} -> ${out[i].beat}`);
  // it gets there: after the glide the view is the session's beat again
  const settled = out.find((v) => !v.gliding && v.t > jumped);
  assert.ok(Math.abs(settled.beat - settled.raw) < 1e-9, 'the view is the session\'s beat again');
  const ms = settled.t - jumped;
  const want = Math.max(GLIDE.minMs, Math.min(GLIDE.maxMs, GLIDE.baseMs + GLIDE.msPerBeat * 7));
  assert.ok(Math.abs(ms - want) < 40, `glide took ${ms.toFixed(0)} ms, wanted about ${want}`);
});

test('a longer way back takes longer, up to a limit', () => {
  const took = (jumpTo) => {
    const { out, jumped } = run({ from: 20, jumpTo, frames: 200 });
    return out.find((v) => !v.gliding && v.t > jumped).t - jumped;
  };
  assert.ok(took(17) < took(10), 'three beats < ten beats');
  assert.ok(took(-30) <= GLIDE.maxMs + 40, 'capped');
  assert.ok(took(19) >= GLIDE.minMs - 40, 'and never too brief');
});

test('the view never moves forward faster than the beat, and only goes back during the glide', () => {
  const { out, jumped } = run();
  for (let i = 1; i < out.length; i++) {
    const d = out[i].beat - out[i - 1].beat;
    if (!out[i].gliding && out[i].t > jumped) assert.ok(d > 0, 'moving on normally afterwards');
    assert.ok(d < 0.05, `frame ${i} moves forward by ${d}`);
  }
});

test('the old notes fade out early in the glide (gone by fadeShare) and stay gone', () => {
  const { out, jumped } = run();
  const glide = out.filter((v) => v.t >= jumped && v.gliding);
  const fades = glide.map((v) => v.fade);
  assert.ok(fades.every((f, i) => i === 0 || f <= fades[i - 1] + 1e-9), 'monotone');
  const gone = glide.find((v) => v.fade === 0);
  const took = out.find((v) => !v.gliding && v.t > jumped).t - jumped;
  assert.ok(gone && gone.t - jumped <= took * GLIDE.fadeShare + 20, `gone after ${(gone.t - jumped).toFixed(0)} ms of ${took.toFixed(0)}`);
  assert.ok(out.filter((v) => v.t > jumped && !v.gliding).every((v) => v.fade === 0));
});

test('a small step back is not a glide; reduced motion never glides', () => {
  const small = run({ from: 6, jumpTo: 5.5 });
  assert.ok(small.out.every((v) => !v.gliding));
  const instant = run({ instant: true });
  assert.ok(instant.out.every((v) => !v.gliding && v.beat === v.beat));
  const at = instant.out.findIndex((v) => v.t >= instant.jumped);
  assert.ok(Math.abs(instant.out[at].beat - -1) < 1e-9, 'jumps at once');
});

test('a second jump while gliding continues from where the view is', () => {
  const g = new ViewGlide();
  let t = 0;
  const frame = (beat) => g.update(beat, (t += 16));
  for (let b = 6; b < 6.2; b += 0.016) frame(b);
  frame(-1); // jump back
  const mid = [];
  for (let i = 0; i < 20; i++) mid.push(frame(-1 + i * 0.016));
  const shownBefore = mid.at(-1).beat;
  const v = frame(-2); // and again, before it got there
  assert.ok(v.gliding);
  assert.ok(Math.abs(v.beat - shownBefore) < 0.4, `no jump (${shownBefore.toFixed(2)} -> ${v.beat.toFixed(2)})`);
});
