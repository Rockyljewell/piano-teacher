// Getting the microphone ready: permission, a room-noise check and a "play middle C" test.
import { $, S, app, audio, coach, show, screen, toast, say, sfx, unlockVoice } from './core.js';
import { noteName } from '../music/theory.js';

// Run `then` once listening is ready (first time: the full setup screen).
export async function withListening(then) {
  unlockVoice();
  try {
    await audio.ensureContext();
  } catch {
    /* ignored */
  }
  audio.startMidi();
  if (audio.micOn || S.listenSkipped) return then();
  if (coach.s.micChecked) {
    try {
      await audio.startMic();
      applyListeningSettings();
      toast('Listening to the room… stay quiet a moment', 1600);
      await audio.calibrate(1400);
      return then();
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
  ['#step-mic', '#step-quiet', '#step-c'].forEach((s) => setStep(s, null));
  setStep('#step-mic', 'doing');
  $('#setup-msg').textContent = '';
  $('#setup-room').textContent = '';
  const go = $('#btn-setup-go');
  go.textContent = 'Allow microphone';
  go.disabled = false;
  go.onclick = runSetup;
  $('#btn-setup-skip').onclick = () => {
    S.listenSkipped = true; // on-screen keys / MIDI only for this session
    finishSetup();
  };
  if (audio.micOn) runSetup();
}

let meterRaf = 0;
function meterLoop() {
  const lvl = Math.min(1, audio.level * 6);
  $('#setup-meter').style.width = `${Math.round(lvl * 100)}%`;
  audio.level *= 0.92;
  meterRaf = requestAnimationFrame(meterLoop);
}

async function runSetup() {
  const go = $('#btn-setup-go');
  go.disabled = true;
  const msg = $('#setup-msg');
  try {
    await audio.ensureContext();
    await audio.startMic();
    applyListeningSettings();
  } catch (err) {
    console.warn(err);
    msg.innerHTML = window.isSecureContext
      ? 'Microphone access was blocked. On iPad: Settings → Safari → Microphone → Allow, then reload. You can still use the on-screen keyboard.'
      : 'The microphone only works over a secure (https) connection. Open Maestro from its https address.';
    go.textContent = 'Use on-screen keys instead';
    go.disabled = false;
    go.onclick = () => {
      S.listenSkipped = true;
      finishSetup();
    };
    sfx('error');
    return;
  }
  cancelAnimationFrame(meterRaf);
  meterLoop();
  setStep('#step-mic', 'done');
  setStep('#step-quiet', 'doing');
  msg.textContent = 'Shh… measuring the room';
  await audio.calibrate(1800);
  const room = roomNoise();
  $('#setup-room').innerHTML = room.html;
  setStep('#step-quiet', 'done');
  setStep('#step-c', 'doing');
  msg.textContent = 'Now play middle C';
  go.textContent = 'Waiting for middle C…';
  say(room.level === 'noisy' ? 'Your room is a little noisy. I will listen extra carefully. Now play middle C.' : 'Great. Now play middle C.');
  const off = audio.on('noteon', (ev) => {
    if (S.screen !== 'setup') return off();
    if (ev.midi === 60) {
      off();
      setStep('#step-c', 'done');
      msg.textContent = '✓ Perfect! I can hear you clearly.';
      sfx('success');
      coach.s.micChecked = true;
      coach.save();
      say('Perfect! I can hear you clearly.').then(() => setTimeout(finishSetup, 300));
    } else {
      msg.textContent = `I heard ${noteName(ev.midi)}. Middle C is the white key just left of the two black keys in the middle.`;
    }
  });
}

// How loud is the room? Uses the listener's calibrated noise floor.
function roomNoise() {
  const tr = audio.tr;
  const rms = tr ? tr.noiseRms || 0 : 0;
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
  const then = S.pendingAfterSetup;
  S.pendingAfterSetup = null;
  if (then) then();
  else show('home');
}

screen('setup', {
  leave() {
    cancelAnimationFrame(meterRaf);
  },
});
