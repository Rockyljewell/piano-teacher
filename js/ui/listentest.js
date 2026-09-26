// The listening test (Listening check → "Record a listening test"): the student plays a fixed
// piece while the raw microphone is recorded. The files it saves (WAV + JSON with every note
// that was asked for, placed on the recording's own timeline, plus what the listener heard)
// are ground truth for the student's own piano, iPad and room, so listening engines can be
// scored on real audio.
import { S, app, audio, coach, toast } from './core.js';
import { listeningTestPiece } from '../music/listentest.js';

let pending = null;

export function startListeningTest() {
  const act = { kind: 'listentest', piece: listeningTestPiece(), level: 6, mode: 'tempo', free: true, label: 'Listening test', listenTest: true };
  app.withListening(() => {
    if (!audio.micWanted || S.listenSkipped) {
      toast('The listening test needs the microphone.', 3000);
      return;
    }
    app.runActivity(act);
  });
}
app.startListeningTest = startListeningTest;

// play.js calls this right after a session starts.
app.listenTestStart = (session, piece, act) => {
  pending = null;
  if (!act || !act.listenTest || S.demo || typeof audio.recordMic !== 'function') return;
  const seconds = (session.countIn + piece.totalBeats) * session.spb + 3;
  pending = { session, piece, act, rec: audio.recordMic(seconds) };
  audio.logEvent && audio.logEvent('listening-test', { seconds: Math.round(seconds * 10) / 10 });
};

// play.js calls this when the piece is over (before the results appear).
app.listenTestFinish = async (result) => {
  const p = pending;
  pending = null;
  if (!p) return;
  if (audio.tr && typeof audio.tr.stopRecording === 'function') audio.tr.stopRecording(); // (it has enough)
  let r = null;
  try {
    r = await p.rec;
  } catch {
    r = null;
  }
  if (!r || !r.samples || !r.samples.length) {
    toast("The recording didn't work. Try the Listening check.", 3500);
    return;
  }
  const sr = r.sampleRate;
  const start = (r.startFrame || 0) / sr; // audio-clock time of the recording's first sample
  const s = p.session;
  const expected = p.piece.notes.map((n) => {
    const st = s.status.get(n.id);
    return {
      midi: n.midi,
      hand: n.hand,
      t: round(s.timeOfBeat(n.beat) - start, 4), // when it was due, on the recording's timeline
      dur: round(n.dur * s.spb, 3),
      graded: st ? st.s : 'miss',
      errMs: st && st.err != null ? Math.round(st.err * 1000) : null,
    };
  });
  const heard = (audio.recentNotes || []).map((n) => ({ ...n, tRec: n.t != null ? round(n.t - start, 4) : null }));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const log = audio.troubleshootingLog({
    kind: 'listening-test',
    test: 'listening-test-v1',
    bpm: p.piece.bpm,
    latencyMs: coach.settings.latencyMs,
    recording: { file: `maestro-test-${stamp}.wav`, sampleRate: sr, startFrame: r.startFrame, seconds: round(r.samples.length / sr, 2) },
    expected,
    heard,
    result: { score: result.score, noteAcc: result.noteAcc, hits: result.hits, total: result.total, extras: result.extras, medianErrMs: result.medianErrMs },
  });
  if (app.showRecording) app.showRecording(r, log, `maestro-test-${stamp}`, 'Listening test recorded. Please share both files.');
};

function round(x, d) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}
