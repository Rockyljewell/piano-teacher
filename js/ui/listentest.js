// The listening test (Listening check → "Record a listening test"): the student plays a fixed
// piece while the raw microphone is recorded. The files it saves (WAV + JSON with every note
// that was asked for, placed on the recording's own timeline, plus what the listener heard)
// are ground truth for the student's own piano, iPad and room, so listening engines can be
// scored on real audio.
import { S, app, audio, coach, toast } from './core.js';
import { listeningTestPiece } from '../music/listentest.js';

let pending = null;

export function startListeningTest() {
  // wait mode: the piece waits for each note, so anyone can play it at their own pace
  const act = { kind: 'listentest', piece: listeningTestPiece(), level: 2, mode: 'wait', free: true, label: 'Listening test', listenTest: true };
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
  // (wait mode takes as long as it takes: record up to 3 minutes, stopped when the piece ends)
  const seconds = session.mode === 'wait' ? 180 : (session.countIn + piece.totalBeats) * session.spb + 3;
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
    // when it was played (wait mode: the listener's own hit time) or due (tempo mode), on the
    // recording's timeline
    const at = s.mode === 'wait' ? (st && st.t != null ? st.t : null) : s.timeOfBeat(n.beat);
    return {
      midi: n.midi,
      hand: n.hand,
      t: at == null ? null : round(at - start, 4),
      dur: round(n.dur * s.spb, 3),
      graded: st ? st.s : 'miss',
      errMs: st && st.err != null ? Math.round(st.err * 1000) : null,
    };
  });
  const heard = (audio.recentNotes || []).map((n) => ({ ...n, tRec: n.t != null ? round(n.t - start, 4) : null }));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const log = audio.troubleshootingLog({
    kind: 'listening-test',
    test: 'listening-test-v2-easy',
    mode: s.mode,
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
