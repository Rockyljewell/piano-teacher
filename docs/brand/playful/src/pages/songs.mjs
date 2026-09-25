import { page, pip, icon, rail } from '../lib.mjs';

// Generated cover art (no album art in a public-domain library): category colour + a simple motif.
const covers = {
  twinkle: `<rect width="220" height="112" fill="#2E2B5F"/><g fill="#FFC23D"><path d="M110 22 l9 19 21 3 -15 15 4 21 -19 -10 -19 10 4 -21 -15 -15 21 -3Z"/></g><g fill="#fff" opacity=".85"><circle cx="40" cy="30" r="3"/><circle cx="178" cy="24" r="2.5"/><circle cx="170" cy="84" r="3.5"/><circle cx="52" cy="84" r="2"/><path d="M186 54 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5Z"/><path d="M30 56 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z"/></g>`,
  jingle: `<rect width="220" height="112" fill="#E8484F"/><g transform="translate(110 58)"><path d="M-26 22 C-26 -6 -18 -26 0 -26 C18 -26 26 -6 26 22 Z" fill="#FFC23D"/><rect x="-32" y="18" width="64" height="9" rx="4.5" fill="#E09A0B"/><circle cy="31" r="7" fill="#E09A0B"/><path d="M-6 -26 q6 -10 12 0" fill="none" stroke="#FFC23D" stroke-width="5"/></g><g fill="#fff" opacity=".9"><circle cx="34" cy="30" r="4"/><circle cx="186" cy="80" r="4"/><circle cx="182" cy="26" r="2.5"/><circle cx="40" cy="86" r="2.5"/></g><path d="M0 102 q55 -14 110 0 t110 0 V112 H0Z" fill="#fff" opacity=".9"/>`,
  grace: `<rect width="220" height="112" fill="#14B8A6"/><circle cx="110" cy="112" r="44" fill="#FFE08A"/><g stroke="#FFE08A" stroke-width="6" stroke-linecap="round"><path d="M110 50 V34"/><path d="M66 70 l-12 -10"/><path d="M154 70 l12 -10"/><path d="M84 56 l-6 -13"/><path d="M136 56 l6 -13"/></g><path d="M0 98 q60 -18 120 -2 t100 -4 V112 H0Z" fill="#0B8C7E"/>`,
  canon: `<rect width="220" height="112" fill="#6F4BF2"/><g fill="none" stroke="#fff" stroke-width="6" opacity=".9"><circle cx="110" cy="56" r="14"/><circle cx="110" cy="56" r="30" opacity=".7"/><circle cx="110" cy="56" r="46" opacity=".45"/><circle cx="110" cy="56" r="62" opacity=".25"/></g>`,
  elise: `<rect width="220" height="112" fill="#E0436F"/><g transform="translate(110 56)"><g fill="#FFD1DE">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="13" ry="21" transform="rotate(${a}) translate(0 -19)"/>`).join('')}</g><circle r="11" fill="#FFC23D"/></g><g fill="#fff" opacity=".5"><circle cx="36" cy="28" r="6"/><circle cx="188" cy="86" r="8"/></g>`,
  entertainer: `<rect width="220" height="112" fill="#FF9A2E"/><g transform="translate(116 70)"><ellipse rx="62" ry="15" fill="#FFE08A"/><path d="M-34 -2 V-30 Q-34 -38 -26 -38 H26 Q34 -38 34 -30 V-2 Z" fill="#FFE08A"/><rect x="-34" y="-16" width="68" height="11" fill="#2E2B5F"/></g><g fill="#fff" opacity=".6"><rect x="16" y="88" width="10" height="24" rx="2"/><rect x="30" y="88" width="10" height="24" rx="2"/><rect x="180" y="88" width="10" height="24" rx="2"/><rect x="194" y="88" width="10" height="24" rx="2"/></g>`,
  prelude: `<rect width="220" height="112" fill="#2F9BFF"/><g fill="#fff">${Array.from({ length: 16 }, (_, i) => `<circle cx="${18 + i * 12.4}" cy="${58 - Math.sin(i / 2.4) * 26 - (i % 4) * 3}" r="${4 + (i % 4)}" opacity="${0.45 + (i % 4) * 0.15}"/>`).join('')}</g>`,
  green: `<rect width="220" height="112" fill="#3CC46F"/><g transform="translate(150 56) rotate(-24)"><path d="M0 -40 C30 -24 30 24 0 40 C-30 24 -30 -24 0 -40Z" fill="#C9F5D9"/><path d="M0 -34 V34" stroke="#229A51" stroke-width="4" stroke-linecap="round"/><g stroke="#229A51" stroke-width="3" stroke-linecap="round"><path d="M0 -14 l12 -10"/><path d="M0 0 l-12 -10"/><path d="M0 14 l12 -10"/></g></g>`,
};

const songs = [
  { c: 'twinkle', t: 'Twinkle, Twinkle, Little Star', by: 'Traditional · 1761', cat: 'Kids & folk', lv: [2, 6, 14], stars: 3 },
  { c: 'jingle', t: 'Jingle Bells', by: 'J. L. Pierpont · 1857', cat: 'Holiday', lv: [2, 12], stars: 2 },
  { c: 'grace', t: 'Amazing Grace', by: 'Traditional · 1831', cat: 'Hymns & ballads', lv: [9, 12], stars: 1 },
  { c: 'canon', t: 'Canon in D', by: 'Pachelbel · 1694', cat: 'Classical', lv: [16], stars: 0 },
  { c: 'elise', t: 'Für Elise', by: 'Beethoven · 1810', cat: 'Classical', lv: [20, 26], stars: 0 },
  { c: 'entertainer', t: 'The Entertainer', by: 'Scott Joplin · 1902', cat: 'Ragtime & blues', lv: [21, 35], stars: 0 },
  { c: 'prelude', t: 'Prelude in C, BWV&nbsp;846', by: 'J. S. Bach · 1722', cat: 'Classical', lv: [25], stars: 0 },
  { c: 'green', t: 'Greensleeves', by: 'Traditional · 1580', cat: 'Hymns & ballads', lv: [13, 16], stars: 0 },
];
const ME = 12;

const lvChips = (lv) => lv.map((n) => `<span class="lv ${n <= ME ? 'ok' : n <= ME + 4 ? 'soon' : 'later'}">${n}</span>`).join('');
const card = (s) => `
  <article class="song">
    <div class="cover"><svg viewBox="0 0 220 112" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${covers[s.c]}</svg>
      <span class="cat">${s.cat}</span>
      ${s.stars ? `<span class="got">${[0, 1, 2].map((i) => icon(i < s.stars ? 'star' : 'starOff', 16)).join('')}</span>` : ''}
    </div>
    <div class="info">
      <h3>${s.t}</h3>
      <p>${s.by}</p>
      <div class="foot"><span class="lvs"><small>Lv</small>${lvChips(s.lv)}</span>
        ${s.lv[0] <= ME ? `<span class="play">${icon('play', 16)}</span>` : `<span class="soon-txt">${s.lv[0] <= ME + 4 ? 'Almost!' : 'Challenge'}</span>`}</div>
    </div>
  </article>`;

export default () => page({
  title: 'Maestro · Songs (playful)',
  css: `
  main { position: absolute; left: 236px; top: 0; width: 924px; height: 820px; }
  .head { position: absolute; left: 0; right: 0; top: 24px; display: flex; align-items: center; gap: 14px; }
  .head h1 { font-size: 40px; line-height: 1; }
  .head .sub { font-weight: 800; font-size: 15px; color: var(--ink-3); margin-top: 4px; }
  .search { margin-left: auto; width: 240px; height: 52px; border-radius: 16px; background: #fff; border: 2px solid var(--line); box-shadow: inset 0 3px 0 #F6EEE1; display: flex; align-items: center; gap: 10px; padding: 0 14px; color: var(--ink-3); font-weight: 700; font-size: 17px; }
  .filters { position: absolute; left: 0; right: 0; top: 98px; display: flex; gap: 10px; align-items: center; }
  .filters .toggle { margin-left: auto; display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 15px; color: var(--ink-2); }
  .switch { width: 52px; height: 32px; border-radius: 999px; background: var(--brand); position: relative; box-shadow: inset 0 -3px 0 var(--brand-edge); }
  .switch::after { content: ""; position: absolute; right: 4px; top: 4px; width: 24px; height: 24px; border-radius: 50%; background: #fff; }
  .feat { position: absolute; left: 0; right: 0; top: 166px; height: 128px; border-radius: 24px; background: var(--brand); box-shadow: 0 6px 0 var(--brand-edge); color: #fff; overflow: hidden; display: flex; align-items: center; padding: 0 28px; gap: 22px; }
  .feat .art { width: 150px; height: 96px; border-radius: 16px; overflow: hidden; flex: none; box-shadow: 0 4px 0 rgba(0,0,0,.18); }
  .feat .eyebrow { color: #F3EFFF; }
  .feat h2 { font-size: 32px; line-height: 1.05; margin: 4px 0 4px; }
  .feat p { font-weight: 700; font-size: 16px; color: #F3EFFF; }
  .feat .btn { margin-left: auto; }
  .feat .pip { flex: none; margin: 18px -8px 0 0; }
  .grid { position: absolute; left: 0; right: 0; top: 316px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px 16px; }
  .song { background: #fff; border: 2px solid var(--line); border-radius: 22px; box-shadow: 0 5px 0 var(--edge); overflow: hidden; height: 226px; display: flex; flex-direction: column; }
  .cover { position: relative; height: 96px; }
  .cover > svg { display: block; width: 100%; height: 100%; }
  .cat { position: absolute; left: 10px; top: 10px; height: 26px; padding: 0 10px; border-radius: 999px; background: rgba(255,255,255,.94); font-weight: 800; font-size: 12px; color: var(--ink); display: flex; align-items: center; }
  .got { position: absolute; right: 10px; top: 10px; height: 26px; display: flex; align-items: center; padding: 0 5px; border-radius: 999px; background: rgba(255,255,255,.94); }
  .info { padding: 10px 14px 12px; display: flex; flex-direction: column; flex: 1; }
  .info h3 { font-size: 19px; line-height: 1.12; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .info p { font-weight: 700; font-size: 14px; color: var(--ink-2); margin-top: 2px; }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
  .lvs { display: flex; align-items: center; gap: 4px; }
  .lvs small { font-weight: 800; font-size: 12px; color: var(--ink-3); margin-right: 2px; }
  .lv { min-width: 28px; height: 26px; padding: 0 6px; border-radius: 8px; display: grid; place-items: center; font-family: var(--font-display); font-weight: 600; font-size: 15px; }
  .lv.ok { background: var(--brand-soft); color: var(--brand-ink); }
  .lv.soon { background: var(--sun-soft); color: var(--sun-ink); }
  .lv.later { background: #F3EADB; color: var(--ink-3); }
  .play { width: 38px; height: 38px; border-radius: 12px; background: var(--brand); color: #fff; display: grid; place-items: center; box-shadow: 0 4px 0 var(--brand-edge); }
  .soon-txt { font-weight: 800; font-size: 13px; color: var(--ink-3); }
  `,
  body: `
  ${rail('songs')}
  <main>
    <header class="head">
      <div><h1>Songs</h1><div class="sub">41 songs, free forever · public domain</div></div>
      <div class="search">${icon('search', 20)} Search songs</div>
      <button class="btn">${icon('upload', 22)} Import MIDI</button>
    </header>

    <div class="filters">
      <span class="chip on">All <span class="count">41</span></span>
      <span class="chip">Kids &amp; folk <span class="count">10</span></span>
      <span class="chip">Holiday <span class="count">9</span></span>
      <span class="chip">Hymns &amp; ballads <span class="count">3</span></span>
      <span class="chip">Classical <span class="count">16</span></span>
      <span class="chip">Ragtime &amp; blues <span class="count">3</span></span>
    </div>

    <section class="feat">
      <div class="art"><svg viewBox="0 0 150 96" aria-hidden="true"><rect width="150" height="96" fill="#FFC23D"/><circle cx="75" cy="96" r="40" fill="#fff" opacity=".9"/><g stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".9"><path d="M75 40 V22"/><path d="M34 62 l-14 -8"/><path d="M116 62 l14 -8"/><path d="M50 46 l-9 -13"/><path d="M100 46 l9 -13"/></g></svg></div>
      <div><div class="eyebrow">Pip’s pick for Level 12</div><h2>Ode to Joy</h2><p>Beethoven · 1824 · Both hands · Level 12</p></div>
      <button class="btn btn-white-on-brand btn-lg">${icon('play', 22)} Play</button>
      ${pip({ pose: 'conduct', size: 118 })}
    </section>

    <section class="grid">${songs.map(card).join('')}</section>
  </main>
  `,
});
