// No key stays lit for ever: microphone notes are released when the listener that would have
// ended them goes away, and after 12 s without a new attack at the latest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../js/audio/audio.js';

function engine() {
  const a = new AudioEngine({ worker: false, env: { document: null, window: null, navigator: null } });
  let T = 0;
  a.now = () => T;
  const offs = [];
  a.on('noteoff', (e) => offs.push(e.midi));
  const mic = a._transcriberOptions();
  return { a, offs, mic, at: (t) => (T = t) };
}

test('releaseMicNotes ends every microphone note still on, once', () => {
  const { a, offs, mic } = engine();
  mic.onNoteOn(60, 0, 0.5, { confidence: 1 });
  mic.onNoteOn(64, 0, 0.5, { confidence: 1 });
  assert.ok(a.heard.has(60) && a.heard.has(64));
  assert.equal(a.releaseMicNotes('listener-restart'), 2);
  assert.deepEqual(offs.sort(), [60, 64]);
  assert.equal(a.heard.size, 0);
  // the old listener's late note-off changes nothing
  mic.onNoteOff(60, 1);
  assert.equal(offs.length, 2);
  a.dispose();
});

test('a microphone note with no new attack for 12 s is released; a re-attack restarts the clock', () => {
  const { a, offs, mic, at } = engine();
  mic.onNoteOn(62, 0, 0.5, { confidence: 1 });
  mic.onNoteOn(67, 0, 0.5, { confidence: 1 });
  at(8);
  mic.onNoteOn(67, 8, 0.5, { confidence: 1, restrike: true });
  at(11);
  assert.equal(a.releaseMicNotes('tick', 12), 0);
  at(12.5);
  assert.equal(a.releaseMicNotes('tick', 12), 1);
  assert.deepEqual(offs, [62]);
  at(20.5);
  assert.equal(a.releaseMicNotes('tick', 12), 1);
  assert.deepEqual(offs, [62, 67]);
  a.dispose();
});

test('stopping the microphone releases its notes', () => {
  const { a, offs, mic } = engine();
  mic.onNoteOn(48, 0, 0.5, { confidence: 1 });
  a.stopMic();
  assert.deepEqual(offs, [48]);
  a.dispose();
});
