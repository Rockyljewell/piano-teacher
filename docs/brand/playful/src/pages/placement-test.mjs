import { page, pip, icon, keyboard, staff } from '../lib.mjs';

// Placement test 3 (of about 7): 2 bars, both hands, a little harder than test 2.
const rh = [
  { p: 'E4', t: 0, d: 'q', now: true }, { p: 'G4', t: 1, d: 'q' }, { p: 'C5', t: 2, d: 'h' },
  { p: 'B4', t: 4, d: 'q' }, { p: 'A4', t: 5, d: '8' }, { p: 'G4', t: 5.5, d: '8' }, { p: 'F4', t: 6, d: 'q' }, { p: 'E4', t: 7, d: 'q' },
].map((n, i) => ({ ...n, hand: 'R', finger: [1, 3, 5, 4, 3, 2, 2, 1][i] }));
const lh = [
  { p: 'C3', t: 0, d: 'h', now: true }, { p: 'E3', t: 2, d: 'h' },
  { p: 'G3', t: 4, d: 'h' }, { p: 'C3', t: 6, d: 'h' },
].map((n) => ({ ...n, hand: 'L' }));

const st = staff({ width: 1060, height: 276, top: 66, sp: 14, playX: 236, now: 0, ppb: 100, notes: [...rh, ...lh], clefW: 160, bars: 2, showPlayhead: false });

export default () => page({
  title: 'Maestro · Placement test (playful)',
  css: `
  .top { position: absolute; left: 28px; right: 28px; top: 20px; height: 60px; display: flex; align-items: center; gap: 18px; }
  .prog { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .prog .row { display: flex; align-items: baseline; justify-content: space-between; }
  .prog b { font-family: var(--font-display); font-weight: 600; font-size: 22px; }
  .prog b span { color: var(--ink-3); }
  .segs { display: flex; gap: 6px; }
  .segs i { flex: 1; height: 14px; border-radius: 999px; background: #EADFCC; display: grid; place-items: center; }
  .segs i.done { background: var(--mint); box-shadow: inset 0 -3px 0 var(--mint-edge); }
  .segs i.cur { background: var(--brand); box-shadow: inset 0 -3px 0 var(--brand-edge), 0 0 0 4px var(--brand-soft); }
  .segs i.maybe { background: transparent; border: 2.5px dashed #DCCDB3; }
  .cue { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px 0 10px; border-radius: 999px; font-weight: 800; font-size: 17px; white-space: nowrap; }
  .cue .arrow { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; }
  .cue.harder { background: var(--sun-soft); color: var(--sun-ink); border: 2.5px solid var(--sun); box-shadow: 0 4px 0 var(--sun-edge); }
  .cue.harder .arrow { background: var(--sun); color: var(--ink); }
  .done-chips { display: flex; gap: 8px; }
  .dchip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 6px; border-radius: 999px; background: var(--mint-soft); color: var(--mint-ink); font-weight: 800; font-size: 14px; }
  .dchip i { width: 20px; height: 20px; border-radius: 50%; background: var(--mint); color: #fff; display: grid; place-items: center; }
  .coachrow { position: absolute; left: 60px; top: 104px; display: flex; align-items: center; gap: 8px; }
  .coachrow .bubble { font-size: 20px; max-width: 700px; }
  .paper { position: absolute; left: 60px; top: 238px; width: 1060px; height: 276px; border-radius: 24px; background: var(--paper); border: 2px solid #EADBBE; box-shadow: 0 5px 0 #E3CFAD, var(--shadow-card); }
  .paper .staff { position: absolute; left: 0; top: 0; }
  .paper .tag { position: absolute; left: 24px; top: 16px; font-weight: 800; font-size: 14px; color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  .listen { position: absolute; left: 50%; top: 544px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 22px 0 14px; border-radius: 999px; background: #fff; border: 2.5px solid var(--mint); box-shadow: 0 4px 0 var(--mint-edge); font-family: var(--font-display); font-weight: 600; font-size: 21px; color: var(--mint-ink); z-index: 3; }
  .listen .lv { display: flex; gap: 3px; align-items: center; }
  .listen .lv i { width: 5px; border-radius: 3px; background: var(--mint); }
  .listen .mic { width: 36px; height: 36px; border-radius: 50%; background: var(--mint); color: #fff; display: grid; place-items: center; box-shadow: 0 0 0 6px var(--mint-soft); }
  .kb { position: absolute; left: 60px; top: 626px; }
  .side-btns { display: flex; gap: 10px; }
  `,
  body: `
  <header class="top">
    <button class="icon-btn" aria-label="Stop test">${icon('close', 22)}</button>
    <div class="prog">
      <div class="row"><b>Test 3 <span>of ~7</span></b>
        <div class="done-chips"><span class="dchip"><i>${icon('check', 13)}</i>Test 1 · 96%</span><span class="dchip"><i>${icon('check', 13)}</i>Test 2 · 91%</span></div>
      </div>
      <div class="segs"><i class="done"></i><i class="done"></i><i class="cur"></i><i></i><i></i><i class="maybe"></i><i class="maybe"></i></div>
    </div>
    <span class="cue harder"><span class="arrow">${icon('up', 18)}</span>A bit harder</span>
    <div class="side-btns">
      <button class="btn btn-sm" style="height:56px;border-radius:16px">${icon('speaker', 20)} Listen</button>
    </div>
  </header>

  <div class="coachrow">
    ${pip({ pose: 'listen', size: 118 })}
    <div class="bubble tail-left">${icon('speaker', 22, 'speaker')}You nailed that one, so here’s a <b>trickier</b> tune. Both hands, no rush. I’ll start when you play the first note.</div>
  </div>

  <section class="paper" aria-label="Test music">
    <span class="tag">Both hands · ♩ = 80</span>
    ${st.svg}
  </section>

  <div class="listen"><span class="mic">${icon('mic', 20)}</span>I’m listening…<span class="lv"><i style="height:10px"></i><i style="height:18px"></i><i style="height:26px"></i><i style="height:16px"></i><i style="height:8px"></i></span></div>

  <div class="kb">${keyboard({ from: 'C3', to: 'C6', width: 1060, height: 168, hintLetters: ['E4', 'C3'] })}</div>
  `,
});
