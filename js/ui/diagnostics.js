// "Listening check": a live look at everything between the microphone and the note detector,
// the fixes a student can do themselves (restart the microphone, a note test) and a
// troubleshooting recording (15 s of raw microphone + a JSON log) to send to the developer.
//
//   import { openDiagnostics } from './diagnostics.js';   // or app.openDiagnostics()
//   micChip.addEventListener('click', () => app.openDiagnostics());
//
// Markup: #diag in index.html. Styles: "listening check" at the end of css/style.css.
import { $, S, app, audio, coach, getVoice, toast } from './core.js';
import { icon, setPose } from './brand.js';
import { noteName } from '../music/theory.js';
import { encodeWav } from '../audio/wav.js';

const DB_MIN = -90; // left end of the meter (dBFS)
const REC_SECONDS = 15;
const pct = (db) => (db == null ? 0 : Math.max(0, Math.min(100, ((db - DB_MIN) / -DB_MIN) * 100)));
const dbOf = (x) => (x > 0 ? 20 * Math.log10(x) : null);
const fmtDb = (db) => (db == null ? '–' : `${Math.round(db)} dB`);
const now = () => performance.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let isOpen = false;
let raf = 0;
let lastRows = 0;
let notesKey = '';
const disp = { db: DB_MIN, peak: null, peakAt: 0 };
let test = null; // note test: {since, until}
let hints = null; // listener hints saved during the note test
let rec = null; // {state: 'recording' | 'done' | 'failed', started, files, urls, sizes}

const CTX_TEXT = {
  running: 'Running',
  suspended: 'Paused by the iPad',
  interrupted: 'Interrupted (call, Siri or another app)',
  stalled: 'Frozen',
  closed: 'Closed',
  none: 'Not started yet',
};
const MIC_TEXT = {
  off: 'Off',
  starting: 'Starting…',
  live: 'On',
  paused: 'Waiting for the sound engine',
  restarting: 'Restarting…',
  muted: 'Muted by the iPad',
  ended: 'Stopped',
  'no-data': 'No sound arriving',
  silent: 'Only digital silence',
  error: 'Could not open',
  denied: 'Blocked in Settings',
};
const HOLD_TEXT = { voice: 'Pip talking', demo: 'playing a demo', sfx: 'a sound effect', touch: 'an on-screen key', muted: 'muted', app: 'app sound' };

// ---- open / close ----------------------------------------------------------------------------

export function openDiagnostics() {
  const root = $('#diag');
  if (!root) return;
  if (!root.dataset.ready) setup(root);
  audio.ensureContext().catch(() => {});
  if (typeof audio.logEvent === 'function') audio.logEvent('diagnostics', { event: 'open', screen: S.screen });
  root.classList.remove('hidden');
  isOpen = true;
  notesKey = '';
  lastRows = 0;
  renderRec();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
  setTimeout(() => $('#diag-restart')?.focus({ preventScroll: true }), 50);
}
app.openDiagnostics = openDiagnostics;

export function closeDiagnostics() {
  const root = $('#diag');
  if (!root || !isOpen) return;
  isOpen = false;
  root.classList.add('hidden');
  cancelAnimationFrame(raf);
  endNoteTest();
}
app.closeDiagnostics = closeDiagnostics;

export const diagnosticsOpen = () => isOpen;

function setup(root) {
  root.dataset.ready = '1';
  const close = $('#diag-close');
  close.innerHTML = icon('close', 20);
  close.addEventListener('click', closeDiagnostics);
  root.addEventListener('click', (e) => {
    if (e.target === root) closeDiagnostics();
  });
  document.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') closeDiagnostics();
  });
  $('#diag-restart').addEventListener('click', restartMic);
  $('#diag-test').addEventListener('click', startNoteTest);
  $('#diag-record').addEventListener('click', startRecording);
  $('#diag-rec').addEventListener('click', (e) => {
    if (e.target.closest('#diag-share')) shareFiles();
  });
}

// Settings → "Listening check".
const setBtn = $('#btn-diag');
if (setBtn) setBtn.addEventListener('click', openDiagnostics);

// ---- actions -----------------------------------------------------------------------------------

async function restartMic() {
  const btn = $('#diag-restart');
  btn.disabled = true;
  btn.textContent = audio.micWanted ? 'Restarting…' : 'Starting…';
  try {
    if (audio.micWanted) {
      await audio.recover({ restartMic: true }); // (its synchronous part runs inside this tap)
    } else {
      await audio.startMic();
      audio.setSensitivity(coach.settings.sensitivity);
      if (typeof audio.setNoisyRoom === 'function') audio.setNoisyRoom(!!coach.settings.noisyRoom);
      S.listenSkipped = false;
    }
  } catch (err) {
    toast(err && err.name === 'NotAllowedError' ? 'Microphone access is blocked: Settings → Safari → Microphone → Allow.' : "Couldn't open the microphone.", 4000);
  }
  btn.disabled = false;
  lastRows = 0;
}

function startNoteTest() {
  if (!test) {
    hints = { range: audio._range ? [...audio._range] : null, expected: audio._expected ? [...audio._expected] : [] };
    audio.setRange(null); // any key counts the same during the test
    audio.setExpected([]);
  }
  test = { since: now(), until: now() + 30000 };
  const coin = $('#diag-note');
  coin.className = 'diag-note waiting';
  $('#diag-note-name').textContent = '♪';
  $('#diag-note-sub').textContent = 'listening…';
  $('#diag-test-msg').textContent = 'Play any key on your piano. I’ll show the note I hear.';
  $('#diag-test').textContent = 'Test again';
}

function endNoteTest() {
  if (!test) return;
  test = null;
  if (hints) {
    if (hints.range) audio.setRange(hints.range[0], hints.range[1]);
    else audio.setRange(null);
    audio.setExpected(hints.expected);
    hints = null;
  }
  const coin = $('#diag-note');
  if (coin) coin.classList.remove('waiting');
}

async function startRecording() {
  if (rec && rec.state === 'recording') return;
  if (!audio.micWanted) {
    try {
      await audio.startMic();
    } catch {
      toast("Couldn't open the microphone.");
      return;
    }
  }
  revoke();
  rec = { state: 'recording', started: now() };
  renderRec();
  const r = await audio.recordMic(REC_SECONDS);
  const stamp = timestamp();
  const vo = getVoice();
  const log = audio.troubleshootingLog({
    screen: S.screen,
    coach: { level: coach.level, placed: !!coach.s.placed, micChecked: !!coach.s.micChecked, settings: { ...coach.settings } },
    voice: vo ? { supported: !!vo.supported, enabled: !!vo.enabled, speaking: !!vo.speaking, current: vo.current } : null,
    screenSize: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    recording: r ? { file: `maestro-listening-${stamp}.wav`, seconds: Math.round((r.samples.length / r.sampleRate) * 100) / 100, sampleRate: r.sampleRate, startFrame: r.startFrame, peakDb: peakDb(r.samples) } : null,
  });
  const files = [];
  if (r && r.samples.length) files.push(new File([encodeWav(r.samples, r.sampleRate)], `maestro-listening-${stamp}.wav`, { type: 'audio/wav' }));
  files.push(new File([JSON.stringify(log, null, 1)], `maestro-listening-${stamp}.json`, { type: 'application/json' }));
  rec = { state: 'done', files, urls: files.map((f) => URL.createObjectURL(f)), noAudio: !(r && r.samples.length) };
  renderRec();
}

async function shareFiles() {
  if (!rec || !rec.files) return;
  try {
    await navigator.share({ files: rec.files, title: 'Maestro listening check', text: 'Maestro troubleshooting recording and log' });
  } catch (e) {
    if (!e || e.name !== 'AbortError') toast('Sharing did not work. Use the download buttons instead.', 3500);
  }
}

function revoke() {
  if (rec && rec.urls) for (const u of rec.urls) URL.revokeObjectURL(u);
}

function peakDb(x) {
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  const d = dbOf(pk);
  return d == null ? null : Math.round(d * 10) / 10;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// ---- rendering ---------------------------------------------------------------------------------

function loop() {
  if (!isOpen) return;
  const t = now();
  const st = audio.st;
  const fresh = audio.micWanted && t - st.lastChunkWall < 500;
  const db = fresh ? dbOf(st.rms) : null;
  disp.db = db == null ? Math.max(DB_MIN, disp.db - 1.2) : Math.max(db, disp.db - 0.7); // fast up, slow down
  const pk = fresh ? dbOf(st.peak) : null;
  if (pk != null && (disp.peak == null || pk >= disp.peak || t - disp.peakAt > 1500)) {
    disp.peak = pk;
    disp.peakAt = t;
  } else if (!fresh && t - disp.peakAt > 1500) disp.peak = null;
  const meter = $('#diag-meter');
  meter.style.setProperty('--lvl', `${pct(disp.db).toFixed(1)}%`);
  meter.style.setProperty('--pk', `${pct(disp.peak).toFixed(1)}%`);
  meter.classList.toggle('no-peak', disp.peak == null);
  const big = $('#diag-db');
  const txt = fresh && db != null ? fmtDb(disp.db) : '–';
  if (big.textContent !== txt) big.textContent = txt;
  if (rec && rec.state === 'recording') {
    const s = Math.min(REC_SECONDS, (t - rec.started) / 1000);
    const bar = $('#diag-rec-bar');
    if (bar) bar.style.width = `${(100 * s) / REC_SECONDS}%`;
    const sec = $('#diag-rec-s');
    if (sec) sec.textContent = String(Math.floor(s));
  }
  if (test && t > test.until) endNoteTest();
  checkNotes();
  if (t - lastRows > 250) {
    lastRows = t;
    renderStatus();
  }
  raf = requestAnimationFrame(loop);
}

// A new mic note (for the note test readout and the list).
function checkNotes() {
  const list = audio.recentNotes;
  const last = list[list.length - 1];
  const key = last ? `${list.length}:${last.at}` : '';
  if (key === notesKey) return;
  notesKey = key;
  renderNotes();
  if (!last) return;
  if (!test && now() - last.at > 3000) return;
  if (test && last.at < test.since) return;
  const coin = $('#diag-note');
  coin.className = `diag-note heard${last.gated ? ' gated' : ''}`;
  void coin.offsetWidth;
  coin.classList.add('pop');
  $('#diag-note-name').textContent = noteName(last.midi);
  $('#diag-note-sub').textContent = last.gated ? 'heard while paused' : `${Math.round(last.confidence * 100)}% sure`;
  $('#diag-test-msg').textContent = last.gated
    ? 'I heard it, but I was paused (I ignore the microphone while I talk or play).'
    : `Heard ${noteName(last.midi)}, ${Math.max(0, last.delayMs)} ms after you played it. Try another key!`;
}

function renderNotes() {
  const items = audio.recentNotes.slice(-8).reverse();
  const box = $('#diag-notes');
  const t = now();
  box.innerHTML = items.length
    ? items
        .map((n) => {
          const ago = Math.max(0, Math.round((t - n.at) / 1000));
          const conf = Math.round(n.confidence * 100);
          return `<span class="dn${n.gated ? ' gated' : ''}" title="confidence ${conf}%"><b>${esc(noteName(n.midi))}</b><span class="conf" aria-label="${conf}% sure"><i style="width:${conf}%"></i></span><small>${n.gated ? 'paused' : ago < 1 ? 'now' : `${ago} s`}</small></span>`;
        })
        .join('')
    : '<span class="fine">Nothing yet. Play a few keys!</span>';
}

function verdict(d) {
  const h = d.health;
  const last = audio.recentNotes[audio.recentNotes.length - 1];
  const recent = last && !last.gated && now() - last.at < 6000;
  if (!d.context) return ['warn', 'The sound engine has not started yet.', 'think'];
  if (h.mic === 'denied') return ['bad', 'Microphone access is blocked. On iPad: Settings → Safari → Microphone → Allow.', 'oops'];
  if (!d.mic.wanted) return ['warn', 'The microphone is off. Tap “Start microphone”.', 'think'];
  if (!h.ok) {
    if (h.reason === 'page-hidden') return ['warn', 'Maestro is in the background.', 'sleep'];
    if (h.context !== 'running') return ['bad', `The iPad ${h.context === 'interrupted' ? 'interrupted' : 'paused'} Maestro’s sound. Tap “Restart microphone”.`, 'oops'];
    if (h.mic === 'restarting' || h.mic === 'starting') return ['warn', 'Starting the microphone…', 'think'];
    return ['bad', 'I’m not getting any sound from the microphone. Tap “Restart microphone”.', 'oops'];
  }
  if (d.holds.held) return ['warn', 'I pause listening while I talk or play. That’s normal.', 'listen'];
  if (recent) return ['ok', `I can hear your piano! Last note: ${noteName(last.midi)}.`, 'cheer'];
  return ['ok', 'The microphone works. Play a note to test it!', 'listen'];
}

function renderStatus() {
  const d = audio.diagnostics();
  const [lvl, text, pose] = verdict(d);
  const v = $('#diag-verdict');
  v.className = `diag-verdict ${lvl}`;
  const vt = v.querySelector('span');
  if (vt.textContent !== text) vt.textContent = text;
  setPose($('#diag-pip'), pose);

  const h = d.health;
  const c = d.context;
  const L = d.listener;
  const ctxLevel = !c ? 'warn' : h.context === 'running' ? 'ok' : 'bad';
  const ctxText = !c ? CTX_TEXT.none : `${CTX_TEXT[h.context] || h.context}${c.sampleRate ? ` · ${Math.round(c.sampleRate / 100) / 10} kHz` : ''}`;
  const micState = d.mic.state;
  const micLevel = micState === 'live' ? 'ok' : micState === 'off' || micState === 'starting' || micState === 'restarting' || micState === 'paused' ? 'warn' : 'bad';
  let micText = MIC_TEXT[micState] || micState;
  if (micState === 'error' && d.mic.error) micText += ` (${d.mic.error})`;
  const flowing = d.mic.wanted && L.lastChunkMs != null && L.lastChunkMs < 600;
  const dataText = !d.mic.wanted ? '–' : flowing ? `${Math.round(L.chunkRate || 0)} blocks per second` : L.lastChunkMs == null ? 'Nothing yet' : `Nothing for ${Math.round(L.lastChunkMs / 1000)} s`;
  const dataLevel = !d.mic.wanted ? 'warn' : flowing && L.zeroMs < 1000 ? 'ok' : 'bad';
  const busy = Math.round((L.load || 0) * 100);
  const where = L.mode === 'worker' ? 'in the background' : L.mode === 'relay' ? 'in the background (relayed)' : L.mode ? 'on the main thread' : '';
  const loadText = L.mode ? `${busy}% busy · ${where}` : '–';
  const loadLevel = !L.mode ? 'warn' : busy > 60 ? 'bad' : busy > 35 ? 'warn' : 'ok';
  const hi = d.holds;
  const holdText = hi.holds.length ? `Paused: ${[...new Set(hi.holds.map((x) => HOLD_TEXT[x.reason] || x.reason))].join(', ')} (${(Math.max(...hi.holds.map((x) => x.ms)) / 1000).toFixed(1)} s)` : hi.tailMs > 0 ? 'Resuming…' : 'Listening';
  const rows = [
    ['Sound engine', ctxText, ctxLevel],
    ['Microphone', micText, micLevel],
    ['Sound arriving', dataText, dataLevel],
    ['Note detector', loadText, loadLevel],
    ['Right now', holdText, hi.held ? 'warn' : 'ok'],
    ['Restarts', d.mic.restarts ? `${d.mic.restarts} microphone restart${d.mic.restarts === 1 ? '' : 's'}` : 'None needed', d.mic.restarts ? 'warn' : 'ok'],
  ];
  const html = rows.map(([k, val, l]) => `<li class="${l}"><i class="dot"></i><b>${k}</b><span>${esc(val)}</span></li>`).join('');
  const ul = $('#diag-rows');
  if (ul.innerHTML !== html) ul.innerHTML = html;

  // meter markers + legend
  const lv = d.levels;
  const meter = $('#diag-meter');
  const room = lv.noiseDb;
  const piano = lv.pianoDb;
  meter.style.setProperty('--room', `${pct(room)}%`);
  meter.style.setProperty('--piano', `${pct(piano)}%`);
  meter.classList.toggle('no-room', room == null);
  meter.classList.toggle('no-piano', piano == null);
  $('#diag-room').textContent = fmtDb(room);
  $('#diag-piano').textContent = fmtDb(piano);
  $('#diag-peak-db').textContent = fmtDb(disp.peak);
  const rej = L.stats && L.stats.rejected;
  $('#diag-rejected').textContent = rej ? `Ignored ${rej} sound${rej === 1 ? '' : 's'} that weren’t piano notes` : '';
  const restart = $('#diag-restart');
  if (!restart.disabled) restart.textContent = d.mic.wanted ? 'Restart microphone' : 'Start microphone';
  renderNotes();
}

function renderRec() {
  const box = $('#diag-rec');
  const btn = $('#diag-record');
  if (!box || !btn) return;
  if (!rec) {
    box.classList.add('hidden');
    btn.classList.remove('hidden');
    return;
  }
  box.classList.remove('hidden');
  if (rec.state === 'recording') {
    btn.classList.add('hidden');
    box.innerHTML = `<div class="diag-rec-top"><span class="rec-dot" aria-hidden="true"></span><b>Recording… <span id="diag-rec-s">0</span> of ${REC_SECONDS} s</b></div>
      <div class="bar mint"><i id="diag-rec-bar" style="width:0%"></i></div>
      <p class="fine">Play a few notes the way you normally do. If something goes wrong, make it happen now.</p>`;
    return;
  }
  btn.classList.remove('hidden');
  btn.textContent = 'Record again';
  const canShare = !!(navigator.canShare && navigator.share && (() => {
    try {
      return navigator.canShare({ files: rec.files });
    } catch {
      return false;
    }
  })());
  const links = rec.files
    .map((f, i) => `<a class="btn btn-sm" href="${rec.urls[i]}" download="${esc(f.name)}">${f.type === 'audio/wav' ? 'Sound' : 'Log'} · ${kb(f.size)}</a>`)
    .join('');
  box.innerHTML = `<div class="diag-rec-top"><span class="rec-ok" aria-hidden="true">${icon('check', 18)}</span><b>Saved! Send ${rec.files.length === 1 ? 'this file' : 'both files'} to the developer.</b></div>
    ${rec.noAudio ? '<p class="fine">No sound came from the microphone, so there is only the log. That is useful too!</p>' : ''}
    <div class="row">${canShare ? '<button id="diag-share" class="btn btn-primary btn-sm">Share…</button>' : ''}${links}</div>`;
}
