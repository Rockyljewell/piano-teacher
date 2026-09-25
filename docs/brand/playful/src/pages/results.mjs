import { page, pip, icon, confetti } from '../lib.mjs';

// Timing histogram: 13 bins of 30 ms from -180 to +180 (46 notes hit).
const BINS = [0, 0, 1, 2, 3, 5, 10, 10, 7, 4, 2, 1, 1];
const hist = () => {
  const W = 560, H = 132, bw = 34, gap = (W - BINS.length * bw) / (BINS.length - 1);
  const max = Math.max(...BINS);
  let s = `<svg width="${W}" height="${H + 30}" viewBox="0 0 ${W} ${H + 30}" aria-hidden="true">`;
  // on-time window (+-40 ms) behind the centre bars
  const cx = W / 2;
  const px = (ms) => cx + (ms / 30) * (bw + gap);
  s += `<rect x="${px(-45)}" y="0" width="${px(45) - px(-45)}" height="${H}" rx="12" fill="var(--mint-soft)"/>`;
  s += `<text x="${cx}" y="16" text-anchor="middle" font-family="Nunito" font-weight="800" font-size="12" fill="var(--mint-ink)" letter-spacing="1">ON THE BEAT</text>`;
  BINS.forEach((v, i) => {
    const ms = (i - 6) * 30;
    const x = cx + (i - 6) * (bw + gap) - bw / 2;
    const h = v ? Math.max(8, (v / max) * (H - 34)) : 4;
    const [c, e] = Math.abs(ms) <= 30 ? ['var(--mint)', 'var(--mint-edge)'] : ms < 0 ? ['var(--early)', 'var(--early-edge)'] : ['var(--late)', 'var(--late-edge)'];
    if (!v) { s += `<rect x="${x}" y="${H - 4}" width="${bw}" height="4" rx="2" fill="#EADFCC"/>`; return; }
    s += `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="9" fill="${e}"/>`;
    s += `<rect x="${x}" y="${H - h}" width="${bw}" height="${h - 4}" rx="9" fill="${c}"/>`;
    if (v >= 3) s += `<text x="${x + bw / 2}" y="${H - h + 20}" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="15" fill="${Math.abs(ms) <= 30 ? 'var(--ink)' : '#fff'}">${v}</text>`;
  });
  // average marker (+14 ms)
  const ax = px(14);
  s += `<rect x="${ax - 1.5}" y="22" width="3" height="${H - 22}" rx="1.5" fill="var(--brand)"/>`;
  s += `<path d="M${ax - 8} 22 h16 l-8 10 Z" fill="var(--brand)"/>`;
  s += `<rect x="0" y="${H}" width="${W}" height="2" fill="#EADFCC"/>`;
  [['−150 ms', px(-150)], ['0', cx], ['+150 ms', px(150)]].forEach(([t, x]) => {
    s += `<text x="${x}" y="${H + 22}" text-anchor="middle" font-family="Nunito" font-weight="800" font-size="13" fill="var(--ink-3)">${t}</text>`;
  });
  return s + `</svg>`;
};

export default () => page({
  title: 'Maestro · Results (playful)',
  css: `
  body { background: radial-gradient(900px 620px at 250px 430px, #F1EAFF 0%, rgba(241,234,255,0) 70%), var(--bg); }
  .confetti { position: absolute; left: 0; top: 0; z-index: 0; opacity: .9; }
  @media (prefers-reduced-motion: no-preference) { .confetti g { animation: fall 5s linear infinite; } }
  .left { position: absolute; left: 40px; top: 64px; width: 440px; text-align: center; z-index: 1; }
  .stars { display: flex; justify-content: center; align-items: flex-end; gap: 6px; height: 118px; }
  .stars .s { filter: drop-shadow(0 5px 0 var(--sun-edge)); }
  .stars .s.off { filter: drop-shadow(0 5px 0 #D8CCB6); }
  .stars .mid { margin-bottom: 22px; }
  .pct { font-family: var(--font-display); font-weight: 700; font-size: 104px; line-height: .95; letter-spacing: -0.02em; color: var(--ink); margin-top: 10px; }
  .pct small { font-size: 52px; }
  .pct-label { font-weight: 800; font-size: 17px; color: var(--ink-2); letter-spacing: .08em; text-transform: uppercase; margin-top: 2px; }
  .coach { position: absolute; left: 40px; top: 430px; width: 470px; z-index: 1; }
  .coach .bubble { font-size: 20px; margin-left: 176px; }
  .coach .pip { position: absolute; left: -10px; top: 96px; }
  .right { position: absolute; left: 528px; top: 70px; width: 612px; z-index: 1; }
  .right h1 { font-size: 44px; line-height: 1.05; }
  .right .sub { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-weight: 800; color: var(--ink-2); font-size: 17px; }
  .xp { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px 0 8px; border-radius: 999px; background: var(--sun-soft); color: var(--sun-ink); font-family: var(--font-display); font-weight: 600; font-size: 18px; border: 2px solid #FFE08A; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 24px; }
  .tile { border-radius: 20px; border: 3px solid var(--c); background: var(--c); box-shadow: 0 5px 0 var(--ce); overflow: hidden; }
  .tile .hd { color: var(--hdc, #fff); font-size: 13px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; text-align: center; padding: 5px 0 6px; }
  .tile .bd { background: #fff; border-radius: 16px 16px 17px 17px; padding: 12px 10px 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .tile .v { display: flex; align-items: baseline; gap: 3px; font-family: var(--font-display); font-weight: 600; font-size: 32px; line-height: 1.05; }
  .tile .v small { font-size: 20px; color: var(--ink-3); }
  .tile .d { font-weight: 800; font-size: 14px; color: var(--ink-2); }
  .t-hit { --c: var(--mint); --ce: var(--mint-edge); --hdc: var(--ink); }
  .t-time { --c: var(--sun); --ce: var(--sun-edge); --hdc: var(--ink); }
  .t-off { --c: var(--late); --ce: var(--late-edge); --hdc: var(--ink); }
  .histo { margin-top: 20px; padding: 16px 28px 10px; }
  .histo .top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .histo h3 { font-size: 21px; }
  .histo .legend { display: flex; gap: 14px; font-weight: 800; font-size: 14px; }
  .histo .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .histo .legend i { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
  .actions { display: flex; gap: 16px; margin-top: 26px; align-items: center; }
  .actions .next { flex: 1; }
  .actions .hint { font-weight: 800; font-size: 14px; color: var(--ink-3); margin-top: 8px; text-align: right; }
  .goal { display: flex; align-items: center; gap: 12px; margin-top: 16px; font-weight: 800; font-size: 15px; color: var(--ink-2); }
  .goal .bar { flex: 1; height: 14px; }
  `,
  body: `
  ${confetti(11, 150, undefined, undefined, [[100, 40, 330, 290], [520, 60, 630, 680], [210, 425, 305, 185], [40, 520, 190, 215]])}
  <section class="left">
    <div class="stars" aria-label="2 of 3 stars">
      <span class="s">${icon('star', 96)}</span>
      <span class="s mid">${icon('star', 118)}</span>
      <span class="s off">${icon('starOff', 96)}</span>
    </div>
    <div class="pct">92<small>%</small></div>
    <div class="pct-label">Accuracy</div>
  </section>

  <section class="coach">
    <div class="bubble tail-left" style="margin-top:0">${icon('speaker', 21, 'speaker')}Your dotted rhythms really <b>bounced</b>! Your left hand came in a little early in bar 2. One more try for three stars?</div>
    ${pip({ pose: 'cheer', size: 200 })}
  </section>

  <section class="right">
    <h1>Level 12 complete!</h1>
    <div class="sub">Dotted rhythms · 5 of 5 exercises <span class="xp">${icon('bolt', 22)} +25 XP</span></div>
    <div class="tiles">
      <div class="tile t-hit"><div class="hd">Notes hit</div><div class="bd"><div class="v">46<small>/50</small></div><div class="d">4 missed · 2 extra</div></div></div>
      <div class="tile t-time"><div class="hd">On time</div><div class="bd"><div class="v">88<small>%</small></div><div class="d">within ±40 ms</div></div></div>
      <div class="tile t-off"><div class="hd">Avg. offset</div><div class="bd"><div class="v">+14<small>ms</small></div><div class="d">a touch late</div></div></div>
    </div>
    <div class="card histo">
      <div class="top"><h3>Your timing</h3>
        <div class="legend"><span style="color:var(--early-ink)"><i style="background:var(--early)"></i>Early</span><span style="color:var(--mint-ink)"><i style="background:var(--mint)"></i>On the beat</span><span style="color:var(--late-ink)"><i style="background:var(--late)"></i>Late</span></div>
      </div>
      ${hist()}
    </div>
    <div class="goal">${icon('flame', 22)} Daily goal done! <div class="bar sun"><i style="width:100%"></i></div> 50/50 XP</div>
    <div class="actions">
      <button class="btn btn-lg">${icon('retry', 24)} Retry</button>
      <button class="btn btn-primary btn-lg next">Next level ${icon('chevron', 24)}</button>
    </div>
    <div class="actions" style="margin-top:8px"><span style="flex:1"></span><span class="hint">Level 13 · Moving around the keyboard</span></div>
  </section>
  `,
});
