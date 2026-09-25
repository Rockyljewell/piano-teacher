import { page, pip, icon } from '../lib.mjs';

// Interactive sound-design reference. Every sound is synthesised with Web Audio (no sample files),
// so these recipes can be copied into the app as-is. Not rendered to PNG.
const ui = [
  ['tap', 'Tap', 'Any button. Soft wooden tick.', '1 marimba blip, 1.76 kHz, 40 ms'],
  ['select', 'Select', 'Option card, filter chip, toggle on.', 'Marimba G5, 120 ms'],
  ['next', 'Continue', 'Primary button, next step.', 'Marimba B5 → E6'],
  ['back', 'Back / close', 'Back arrow, dismiss.', 'Marimba E6 → B5, quieter'],
  ['pip', 'Pip pops in', 'Mascot enters / speech bubble opens.', 'Sine sweep 300 → 900 Hz, 80 ms'],
  ['oops', 'Gentle oops', 'Mic not found, no notes heard. Never for wrong notes.', 'Two soft notes, minor third down'],
];
const reward = [
  ['stars', 'Stars', 'Results: one chime per star as it lands.', 'Celesta C6 · E6 · G6, 260 ms apart'],
  ['xp', 'XP count-up', 'Numbers roll up, ding at the end.', '2.5 kHz ticks every 35 ms + ding'],
  ['complete', 'Level complete', 'Results screen opens.', 'Marimba arpeggio + C major bloom'],
  ['streak', 'Streak +1', 'Flame grows on the streak screen.', 'Noise whoosh 400 → 3 kHz + chime'],
  ['unlock', 'Level reveal', 'Placement result, stage unlocked.', 'Drum roll 600 ms + chord bloom'],
];
const play = [
  ['sparkle', 'Perfect sparkle', 'Perfect hit (optional). 11–15 kHz, −32 dBFS.', 'High-passed noise, 45 ms'],
  ['combo', 'Combo shimmer', 'Every 10 in a row. Above 12 kHz only.', '3 noise glints, 12 / 13.5 / 15 kHz'],
  ['click', 'Metronome click', '“Always” metronome during a graded take.', 'Noise click 10–16 kHz, 8 ms'],
  ['countin', 'Count-in', 'Before grading starts (mic ignored).', 'High marimba ticks C7 · G6, accent on 1'],
];

const row = ([id, name, when, how]) => `
  <button class="snd" data-s="${id}"><span class="pl">${icon('play', 18)}</span><span><b>${name}</b><small>${when}</small><em>${how}</em></span></button>`;

export default () => page({
  title: 'Maestro · Sound design (playful)',
  tall: true,
  css: `
  body { padding: 40px 56px 60px; height: auto; }
  header { display: flex; align-items: center; gap: 20px; margin-bottom: 26px; }
  header h1 { font-size: 40px; }
  header p { color: var(--ink-2); font-size: 18px; max-width: 700px; }
  h2 { font-size: 24px; margin: 28px 0 6px; }
  .lead { color: var(--ink-2); font-size: 16px; margin-bottom: 14px; max-width: 900px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .snd { display: flex; gap: 14px; align-items: flex-start; text-align: left; padding: 16px; border-radius: 20px; background: #fff; border: 2px solid var(--line); box-shadow: 0 5px 0 var(--edge); }
  .snd:active { transform: translateY(5px); box-shadow: 0 0 0 var(--edge); }
  .snd .pl { flex: none; width: 44px; height: 44px; border-radius: 14px; background: var(--brand); color: #fff; display: grid; place-items: center; box-shadow: 0 4px 0 var(--brand-edge); }
  .snd b { display: block; font-family: var(--font-display); font-weight: 600; font-size: 20px; }
  .snd small { display: block; color: var(--ink-2); font-size: 15px; font-weight: 700; line-height: 1.35; margin-top: 2px; }
  .snd em { display: block; font-style: normal; color: var(--ink-3); font-size: 13px; font-weight: 800; margin-top: 6px; }
  .play .snd .pl { background: var(--mint); box-shadow: 0 4px 0 var(--mint-edge); color: var(--ink); }
  .rule { display: flex; gap: 14px; align-items: center; background: var(--mint-soft); border: 2px solid var(--mint); border-radius: 20px; padding: 14px 18px; font-weight: 700; color: var(--mint-ink); margin-bottom: 14px; }
  .vol { display: flex; align-items: center; gap: 12px; font-weight: 800; color: var(--ink-2); margin-top: 18px; }
  `,
  body: `
  <header>${pip({ pose: 'conduct', size: 110 })}<div><h1>Sound design</h1><p>Every sound here is synthesised with Web Audio, so there are no files to license or download. Tap to hear. UI sounds are warm marimba and celesta; anything that can play while the microphone is grading lives above 10 kHz.</p></div></header>

  <h2>Interface</h2><p class="lead">Short, soft, pitched in C major so sequences never clash. Master UI volume −18 dBFS peak, respects the device mute switch and a “Sounds” setting.</p>
  <div class="grid">${ui.map(row).join('')}</div>

  <h2>Rewards</h2><p class="lead">Only on screens where the mic is not grading (results, streak, placement reveal).</p>
  <div class="grid">${reward.map(row).join('')}</div>

  <h2>During play</h2>
  <div class="rule">${icon('mic', 22)} While a take is graded, nothing tonal below 10 kHz. The analyser also low-passes its input at 9 kHz, so these cues can never be heard as piano notes. Pip’s voice waits for the gaps.</div>
  <div class="grid play">${play.map(row).join('')}</div>
  <div class="vol">Volume <input id="vol" type="range" min="0" max="1" step="0.05" value="0.7"></div>

  <script>
  let ac;
  const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  const master = () => { const c = ctx(); if (!c._m) { c._m = c.createGain(); c._m.connect(c.destination); } c._m.gain.value = +document.getElementById('vol').value; return c._m; };
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  // Marimba: sine fundamental + 3.93x partial with a faster decay.
  function marimba(m, t = 0, dur = 0.35, g = 0.22) {
    const c = ctx(), t0 = c.currentTime + t, out = master();
    [[1, g, dur], [3.93, g * 0.35, dur * 0.25]].forEach(([mul, amp, d]) => {
      const o = c.createOscillator(), v = c.createGain();
      o.type = 'sine'; o.frequency.value = hz(m) * mul;
      v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(amp, t0 + 0.004); v.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(v).connect(out); o.start(t0); o.stop(t0 + d + 0.05);
    });
  }
  // Celesta: sine + octave + slight detune shimmer, longer tail.
  function celesta(m, t = 0, g = 0.16) {
    const c = ctx(), t0 = c.currentTime + t, out = master();
    [[1, g, 1.1, 0], [2, g * 0.4, 0.6, 4], [1, g * 0.3, 0.9, -6]].forEach(([mul, amp, d, det]) => {
      const o = c.createOscillator(), v = c.createGain();
      o.type = 'sine'; o.frequency.value = hz(m) * mul; o.detune.value = det;
      v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(amp, t0 + 0.006); v.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(v).connect(out); o.start(t0); o.stop(t0 + d + 0.05);
    });
  }
  function noise(t, dur, { hp = 0, lp = 0, bp = 0, q = 1, g = 0.1, sweep } = {}) {
    const c = ctx(), t0 = c.currentTime + t, out = master();
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf; let node = s;
    const f = (type, freq) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; node.connect(b); node = b; return b; };
    if (hp) f('highpass', hp); if (lp) f('lowpass', lp);
    if (bp) { const b = f('bandpass', bp); if (sweep) b.frequency.exponentialRampToValueAtTime(sweep, t0 + dur); }
    const v = c.createGain(); v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(g, t0 + Math.min(0.01, dur / 3)); v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(v).connect(out); s.start(t0); s.stop(t0 + dur + 0.02);
  }
  function blip(f1, f2, dur = 0.08, g = 0.12, t = 0) {
    const c = ctx(), t0 = c.currentTime + t, o = c.createOscillator(), v = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(g, t0 + 0.005); v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(v).connect(master()); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const S = {
    tap: () => blip(1760, 1500, 0.04, 0.08),
    select: () => marimba(79, 0, 0.3, 0.18),
    next: () => { marimba(83, 0, 0.25, 0.18); marimba(88, 0.09, 0.4, 0.2); },
    back: () => { marimba(88, 0, 0.2, 0.12); marimba(83, 0.08, 0.3, 0.12); },
    pip: () => blip(300, 900, 0.09, 0.14),
    oops: () => { marimba(76, 0, 0.3, 0.12); marimba(73, 0.14, 0.45, 0.12); },
    stars: () => [84, 88, 91].forEach((m, i) => celesta(m, i * 0.26)),
    xp: () => { for (let i = 0; i < 14; i++) blip(2500, 2400, 0.02, 0.05, i * 0.035); celesta(96, 14 * 0.035 + 0.02, 0.12); },
    complete: () => { [72, 76, 79, 84].forEach((m, i) => marimba(m, i * 0.09, 0.4, 0.18)); [84, 88, 91].forEach((m) => celesta(m, 0.42, 0.1)); noise(0.42, 0.6, { hp: 11000, g: 0.02 }); },
    streak: () => { noise(0, 0.38, { bp: 400, sweep: 3000, q: 2, g: 0.16 }); for (let i = 0; i < 6; i++) noise(0.25 + i * 0.05 + Math.random() * 0.03, 0.02, { hp: 3000, g: 0.05 }); celesta(91, 0.36); },
    unlock: () => { for (let i = 0; i < 14; i++) noise(i * (0.06 - i * 0.0025), 0.04, { bp: 180, q: 0.8, g: 0.18 }); [60, 64, 67, 72, 76].forEach((m) => marimba(m, 0.62, 0.9, 0.12)); [84, 88, 91, 96].forEach((m, i) => celesta(m, 0.66 + i * 0.05, 0.08)); },
    sparkle: () => noise(0, 0.045, { hp: 11000, lp: 15000, g: 0.025 }),
    combo: () => [12000, 13500, 15000].forEach((f, i) => noise(i * 0.07, 0.05, { bp: f, q: 6, g: 0.05 })),
    click: () => [0, 1, 2, 3].forEach((b) => noise(b * 0.5, 0.008, { hp: 10000, lp: 16000, g: b ? 0.05 : 0.08 })),
    countin: () => [0, 1, 2, 3].forEach((b) => { marimba(b ? 91 : 96, b * 0.5, 0.08, b ? 0.14 : 0.2); }),
  };
  document.querySelectorAll('.snd').forEach((b) => b.addEventListener('click', () => { ctx().resume(); S[b.dataset.s](); }));
  </script>
  `,
});
