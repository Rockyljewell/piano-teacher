// Getting the microphone ready: permission, a room-noise check and a "play middle C" test.
// If the microphone delivers nothing (a dead track, an iOS interruption) the setup screen says
// so and offers "Restart microphone"; the Listening check (diagnostics.js) is one tap away.
import { $, $$, S, app, audio, coach, show, screen, toast, say, showLine, sfx, unlockVoice, rise } from './core.js';
import { noteName } from '../music/theory.js';
import { openDiagnostics } from './diagnostics.js';

// Run `then` once listening is ready (first time: the full setup screen).
export async function withListening(then) {
  unlockVoice();
  try {
    await audio.ensureContext();
  } catch {
    /* ignored */
  }
  audio.startMidi();
  if (S.listenSkipped) return then();
  if (audio.micWanted) {
    // Started earlier in this session: check it still works (iOS can kill it silently).
    const r = await audio.ready({ timeoutMs: 1200 });
    if (r.ok) return then();
    const h = await audio.recover();
    if (h.ok) return then();
    S.pendingAfterSetup = then;
    openSetup();
    return;
  }
  if (coach.s.micChecked) {
    try {
      await audio.startMic();
      applyListeningSettings();
      toast('Listening to the room… stay quiet a moment', 1600);
      if (await audio.calibrate(1400)) return then();
      // nothing came from the microphone: the setup screen explains and offers a restart
    } catch (err) {
      console.warn(err);
    }
  }
  S.pendingAfterSetup = then;
  openSetup();
}
app.withListening = withListening;

export function applyListeningSettings() {
  audio.setSensitivity(coach.settings.sensitivity);
  if (typeof audio.setNoisyRoom === 'function') audio.setNoisyRoom(!!coach.settings.noisyRoom);
}

function setStep(id, cls) {
  const el = $(id);
  el.classList.remove('doing', 'done');
  if (cls) el.classList.add(cls);
}

app.openSetup = () => openSetup();

export function openSetup() {
  show('setup');
  ensureExtras();
  stopWatch();
  hideProblem();
  ['#step-mic', '#step-quiet', '#step-c', '#step-chord'].forEach((s) => setStep(s, null));
  setStep('#step-mic', 'doing');
  $('#setup-msg').textContent = '';
  $('#setup-room').textContent = '';
  showLine("I listen through the microphone. Let's make sure I can hear your piano!", { pop: false });
  rise([$('#screen-setup .coach-col .bubble'), ...$$('#screen-setup .steps li'), $('#screen-setup .setup-card .row')], { delay: 80, step: 55 });
  const go = $('#btn-setup-go');
  go.textContent = 'Allow microphone';
  go.disabled = false;
  go.classList.remove('hidden');
  go.onclick = runSetup;
  $('#btn-setup-skip').onclick = () => {
    S.listenSkipped = true; // on-screen keys / MIDI only for this session
    finishSetup();
  };
  if (audio.micWanted) runSetup();
}

// "Restart microphone" and "Listening check" buttons, added next to the setup buttons.
function ensureExtras() {
  if ($('#btn-setup-restart')) return;
  const go = $('#btn-setup-go');
  const row = go.parentElement;
  const restart = document.createElement('button');
  restart.id = 'btn-setup-restart';
  restart.className = 'btn btn-primary btn-lg hidden';
  restart.textContent = 'Restart microphone';
  restart.addEventListener('click', restartFromSetup);
  go.after(restart);
  const diag = document.createElement('button');
  diag.id = 'btn-setup-diag';
  diag.className = 'btn btn-ghost hidden';
  diag.textContent = 'Listening check';
  diag.addEventListener('click', () => openDiagnostics());
  row.appendChild(diag);
}

let meterRaf = 0;
function meterLoop() {
  const lvl = Math.min(1, audio.level * 6);
  $('#setup-meter').style.width = `${Math.round(lvl * 100)}%`;
  audio.level *= 0.92;
  meterRaf = requestAnimationFrame(meterLoop);
}

let offNote = null;
let running = false;

async function runSetup() {
  if (running) return;
  running = true;
  try {
    await setupSteps();
  } finally {
    running = false;
  }
}

async function setupSteps() {
  const go = $('#btn-setup-go');
  go.disabled = true;
  const msg = $('#setup-msg');
  stopWatch();
  hideProblem();
  if (offNote) offNote();
  offNote = null;
  try {
    await audio.ensureContext();
    await audio.startMic();
    applyListeningSettings();
  } catch (err) {
    console.warn(err);
    msg.innerHTML = window.isSecureContext
      ? 'Microphone access was blocked. On iPad: Settings → Safari → Microphone → Allow, then reload. You can still use the on-screen keyboard.'
      : 'The microphone only works over a secure (https) connection. Open Maestro from its https address.';
    showLine("Hmm, I can't use the microphone yet. You can still play with the on-screen keys.");
    go.textContent = 'Use on-screen keys instead';
    go.disabled = false;
    go.onclick = () => {
      S.listenSkipped = true;
      finishSetup();
    };
    sfx('error');
    return;
  }
  if (S.screen !== 'setup') return;
  cancelAnimationFrame(meterRaf);
  meterLoop();
  setStep('#step-mic', 'done');
  setStep('#step-quiet', 'doing');
  $('#setup-room').textContent = '';
  msg.textContent = 'Shh… measuring the room';
  go.textContent = 'Listening…';
  showLine('Shh… stay quiet for a moment while I listen to the room.');
  const calibrated = await audio.calibrate(1800);
  if (S.screen !== 'setup') return;
  if (!calibrated) {
    // Nothing (or only digital silence) came from the microphone: don't claim a quiet room.
    setStep('#step-quiet', null);
    showProblem(audio.health, true);
    return;
  }
  const room = roomNoise();
  $('#setup-room').innerHTML = room.html;
  setStep('#step-quiet', 'done');
  setStep('#step-c', 'doing');
  msg.textContent = 'Now play middle C';
  go.textContent = 'Waiting for middle C…';
  say(room.level === 'noisy' ? 'Your room is a little noisy. I will listen extra carefully. Now play middle C.' : 'Great. Now play middle C.');
  watchSignal();
  const off = audio.on('noteon', (ev) => {
    if (S.screen !== 'setup') return off();
    if (ev.midi === 60) {
      off();
      offNote = null;
      stopWatch();
      hideProblem();
      setStep('#step-c', 'done');
      msg.textContent = '✓ I hear you! Now a chord.';
      sfx('success');
      coach.s.micChecked = true;
      coach.save();
      chordStep();
    } else {
      msg.textContent = `I heard ${noteName(ev.midi)}. Middle C is the white key just left of the two black keys in the middle.`;
    }
  });
  offNote = off;
}

// Step 4: a C major chord (C4 E4 G4) played together. Checks that the microphone hears every
// note of a chord where the iPad stands; if a note goes missing, says which one and what helps
// (from how loud the piano is against the room). Never blocks: after three tries, carry on.
const CHORD = [60, 64, 67];
function chordStep() {
  const msg = $('#setup-msg');
  const go = $('#btn-setup-go');
  setStep('#step-chord', 'doing');
  msg.textContent = 'Now play C, E and G together';
  go.textContent = 'Waiting for the chord…';
  say('Now play C, E and G together, like a chord.');
  audio.setExpected(CHORD);
  let tries = 0;
  let got = null; // {first, notes:Set}
  let timer = 0;
  const judge = () => {
    const heard = got ? got.notes : new Set();
    got = null;
    const missing = CHORD.filter((m) => !heard.has(m));
    if (!missing.length) return success();
    tries++;
    const names = (ms) => ms.map((m) => noteName(m).replace(/\d+$/, '')).join(' and ');
    const found = CHORD.filter((m) => heard.has(m));
    const tip = placementTip();
    if (tries >= 3) {
      off();
      offNote = null;
      audio.setExpected([]);
      setStep('#step-chord', 'done');
      msg.textContent = `I hear most notes. ${tip}`;
      showLine(`Good enough to start! ${tip}`);
      go.textContent = 'Continue';
      go.disabled = false;
      go.onclick = finishSetup;
      return;
    }
    msg.textContent = found.length ? `I heard ${names(found)}, but not ${names(missing)}. ${tip} Try again!` : `I didn't catch that. ${tip} Try again!`;
    sfx('tap');
  };
  const success = () => {
    off();
    offNote = null;
    clearTimeout(timer);
    audio.setExpected([]);
    stopWatch();
    setStep('#step-chord', 'done');
    msg.textContent = '✓ Perfect! I can hear every note.';
    sfx('success');
    coach.s.micChord = true;
    coach.save();
    say('Perfect! I can hear every note of your chords.').then(() => setTimeout(finishSetup, 300));
  };
  const off = audio.on('noteon', (ev) => {
    if (S.screen !== 'setup') return off();
    if (!got) {
      got = { notes: new Set() };
      clearTimeout(timer);
      timer = setTimeout(judge, 450); // notes of one chord arrive within a few hundred ms
    }
    got.notes.add(ev.midi);
    if (CHORD.every((m) => got.notes.has(m))) {
      clearTimeout(timer);
      got = null;
      success();
    }
  });
  offNote = off;
}

// Advice from how loud the piano is compared with the room.
function placementTip() {
  const piano = audio.pianoLevel;
  const room = audio.noiseLevel;
  if (piano != null && room != null && piano - room < 20) return 'Move the iPad closer to the strings (open the lid if you can) and play a little louder.';
  if (room != null && room > -45) return 'Your room is noisy: turning off TV or music helps.';
  return 'Press all three keys at the same moment, a little firmly.';
}

// While waiting for middle C: notice when the microphone delivers nothing at all.
let watchTimer = 0;
function watchSignal() {
  stopWatch();
  const started = performance.now();
  let bad = 0;
  let hinted = false;
  watchTimer = setInterval(() => {
    if (S.screen !== 'setup') return stopWatch();
    const h = audio.health;
    const dead = !h.ok && h.mic !== 'starting' && h.mic !== 'restarting';
    if (dead) {
      if (++bad === 3) showProblem(h, false); // ~1.5 s without a signal
    } else {
      if (bad >= 3) {
        hideProblem();
        $('#setup-msg').textContent = 'Now play middle C';
        showLine("I can hear the microphone again. Play middle C!");
      }
      bad = 0;
    }
    if (!hinted && performance.now() - started > 15000) {
      hinted = true;
      const d = $('#btn-setup-diag');
      if (d) d.classList.remove('hidden'); // playing but nothing detected? the Listening check helps
    }
  }, 500);
}

function stopWatch() {
  clearInterval(watchTimer);
  watchTimer = 0;
}

function showProblem(h, fromCalibration) {
  const paused = h && h.context && h.context !== 'running' && h.context !== 'none';
  $('#setup-room').innerHTML = `<span class="room room-noisy">${paused ? 'The iPad paused Maestro’s sound.' : 'I can’t hear anything from the microphone.'}</span>`;
  $('#setup-msg').textContent = paused
    ? 'Tap “Restart microphone” to wake it up.'
    : 'Tap “Restart microphone”. If that doesn’t help, close other apps that use the microphone (calls, voice memos) and try again.';
  showLine(paused ? 'The iPad paused my ears. Tap Restart microphone!' : "Hmm, I can't hear anything at all. Let's restart the microphone.");
  $('#btn-setup-go').classList.add('hidden');
  $('#btn-setup-restart').classList.remove('hidden');
  $('#btn-setup-diag').classList.remove('hidden');
  if (fromCalibration) sfx('error');
  if (typeof audio.logEvent === 'function') audio.logEvent('setup-no-signal', { step: fromCalibration ? 'room' : 'middle-c', health: h });
}

function hideProblem() {
  const r = $('#btn-setup-restart');
  if (r) r.classList.add('hidden');
  $('#btn-setup-go').classList.remove('hidden');
}

async function restartFromSetup() {
  const b = $('#btn-setup-restart');
  b.disabled = true;
  b.textContent = 'Restarting…';
  const p = audio.micWanted ? audio.recover({ restartMic: true }) : Promise.resolve(); // inside the tap
  try {
    await p;
  } catch {
    /* the setup steps below report what is still wrong */
  }
  b.disabled = false;
  b.textContent = 'Restart microphone';
  if (S.screen === 'setup') runSetup(); // measure the room again, then wait for middle C
}

// How loud is the room? Uses the listener's calibrated noise floor.
function roomNoise() {
  const rms = audio.noiseRms || 0;
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  let level = 'quiet';
  if (db > -45) level = 'noisy';
  else if (db > -58) level = 'moderate';
  if (level === 'noisy' && !coach.settings.noisyRoom) {
    coach.setSetting('noisyRoom', true);
    applyListeningSettings();
  }
  const text = {
    quiet: 'Room: quiet ✓',
    moderate: 'Room: a little background noise. That\'s fine.',
    noisy: 'Room: noisy. I switched on noisy-room mode (turn off TV/music for best results).',
  }[level];
  return { level, db, html: `<span class="room room-${level}">${text}</span>` };
}

export function finishSetup() {
  cancelAnimationFrame(meterRaf);
  stopWatch();
  if (offNote) offNote();
  offNote = null;
  const then = S.pendingAfterSetup;
  S.pendingAfterSetup = null;
  if (then) then();
  else show('home');
}

screen('setup', {
  leave() {
    cancelAnimationFrame(meterRaf);
    stopWatch();
  },
});
