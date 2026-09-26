// Maestro brand assets as inline SVG: Pip the mascot (every pose), icons, the wordmark,
// signal bars and a small confetti engine. Everything is original art; no image files needed.
//
// Pip: a round penguin in concert tails. The body is a note head and the tuft on top is the stem
// and flag of an eighth note. The eyes (.pip-eyes) blink and the beak (.pip-talk) moves while the
// coach voice speaks (CSS in style.css, driven by body.pip-talking).

const C = {
  body: '#2E2B5F', bodyHi: '#433F82', mask: '#FFF4E0', eye: '#1C1936', beak: '#FFA629', beakDeep: '#E5801A',
  mouth: '#C9471C', tongue: '#FF7F8E', cheek: '#FF8FA8', tie: '#6F4BF2', tieDeep: '#4F30C9', tieHi: '#9B82FF',
  foot: '#FFA629', shadow: 'rgba(46,43,95,0.14)', spark: '#FFC23D', note: '#6F4BF2', wave: '#2F9BFF', sweat: '#7CC8FF',
};

const EYES = {
  open: `<ellipse cx="80" cy="92" rx="10.5" ry="13" fill="${C.eye}"/><ellipse cx="120" cy="92" rx="10.5" ry="13" fill="${C.eye}"/>
    <circle cx="84.5" cy="86.5" r="4.2" fill="#fff"/><circle cx="124.5" cy="86.5" r="4.2" fill="#fff"/>
    <circle cx="76.5" cy="98" r="2" fill="#fff" opacity=".85"/><circle cx="116.5" cy="98" r="2" fill="#fff" opacity=".85"/>`,
  joy: `<path d="M69 96 Q80 80 91 96" fill="none" stroke="${C.eye}" stroke-width="6" stroke-linecap="round"/>
    <path d="M109 96 Q120 80 131 96" fill="none" stroke="${C.eye}" stroke-width="6" stroke-linecap="round"/>`,
  up: `<ellipse cx="81" cy="91" rx="10.5" ry="13" fill="${C.eye}"/><ellipse cx="121" cy="91" rx="10.5" ry="13" fill="${C.eye}"/>
    <circle cx="86.5" cy="84" r="4.2" fill="#fff"/><circle cx="126.5" cy="84" r="4.2" fill="#fff"/>
    <circle cx="78" cy="97" r="1.8" fill="#fff" opacity=".85"/><circle cx="118" cy="97" r="1.8" fill="#fff" opacity=".85"/>`,
  worried: `<ellipse cx="80" cy="94" rx="9.5" ry="12" fill="${C.eye}"/><ellipse cx="120" cy="94" rx="9.5" ry="12" fill="${C.eye}"/>
    <circle cx="83.5" cy="89" r="3.8" fill="#fff"/><circle cx="123.5" cy="89" r="3.8" fill="#fff"/>
    <path d="M68 76 Q78 70 89 73" fill="none" stroke="${C.body}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M111 73 Q122 70 132 76" fill="none" stroke="${C.body}" stroke-width="4.5" stroke-linecap="round"/>`,
  wink: `<ellipse cx="80" cy="92" rx="10.5" ry="13" fill="${C.eye}"/>
    <circle cx="84.5" cy="86.5" r="4.2" fill="#fff"/><circle cx="76.5" cy="98" r="2" fill="#fff" opacity=".85"/>
    <path d="M109 94 Q120 84 131 94" fill="none" stroke="${C.eye}" stroke-width="6" stroke-linecap="round"/>`,
  closed: `<path d="M70 92 Q80 100 90 92" fill="none" stroke="${C.eye}" stroke-width="5" stroke-linecap="round"/>
    <path d="M110 92 Q120 100 130 92" fill="none" stroke="${C.eye}" stroke-width="5" stroke-linecap="round"/>`,
};

const BEAKS = {
  closed: `<path d="M87 106 Q100 99 113 106 Q107 119 100 120 Q93 119 87 106 Z" fill="${C.beak}"/>
    <path d="M91 106.5 Q100 102 109 106.5" fill="none" stroke="#FFD27A" stroke-width="2.4" stroke-linecap="round"/>`,
  smile: `<path d="M87 105 Q100 98 113 105 Q108 113 100 113 Q92 113 87 105 Z" fill="${C.beak}"/>
    <path d="M90 114 Q100 124 110 114 Q100 117 90 114 Z" fill="${C.beakDeep}"/>
    <path d="M91 105.5 Q100 101 109 105.5" fill="none" stroke="#FFD27A" stroke-width="2.4" stroke-linecap="round"/>`,
  open: `<path d="M85 104 Q100 96 115 104 Q108 112 100 112 Q92 112 85 104 Z" fill="${C.beak}"/>
    <path d="M89 113 Q100 110 111 113 Q107 129 100 130 Q93 129 89 113 Z" fill="${C.mouth}"/>
    <path d="M93 123 Q100 118 107 123 Q104 129 100 129.5 Q96 129 93 123 Z" fill="${C.tongue}"/>
    <path d="M89 104.5 Q100 99.5 111 104.5" fill="none" stroke="#FFD27A" stroke-width="2.4" stroke-linecap="round"/>`,
  o: `<path d="M88 105 Q100 99 112 105 Q107 111 100 111 Q93 111 88 105 Z" fill="${C.beak}"/>
    <ellipse cx="100" cy="117" rx="6" ry="6.5" fill="${C.mouth}"/>`,
};

const WING = {
  downL: `<path d="M42 104 C24 118 20 148 30 162 C40 158 47 140 49 118 Z" fill="${C.body}"/>`,
  downR: `<path d="M158 104 C176 118 180 148 170 162 C160 158 153 140 151 118 Z" fill="${C.body}"/>`,
  waveR: `<path d="M152 112 C170 104 186 82 184 62 C174 62 162 78 150 98 Z" fill="${C.body}"/>`,
  upL: `<path d="M48 112 C30 104 14 82 16 62 C26 62 38 78 50 98 Z" fill="${C.body}"/>`,
  upR: `<path d="M152 112 C170 104 186 82 184 62 C174 62 162 78 150 98 Z" fill="${C.body}"/>`,
  cupL: `<path d="M46 110 C30 100 26 80 34 66 C42 70 48 86 52 102 Z" fill="${C.body}"/>`,
  chinR: `<path d="M168 136 C168 116 158 100 142 98 C134 98 131 106 136 111 C144 114 150 122 152 138 Z" fill="${C.body}"/>`,
  hugL: `<path d="M44 108 C34 124 42 142 62 146 C62 138 54 128 52 116 Z" fill="${C.body}"/>`,
  hugR: `<path d="M156 108 C166 124 158 142 138 146 C138 138 146 128 148 116 Z" fill="${C.body}"/>`,
  pointR: `<path d="M150 102 C166 94 186 92 197 98 C203 102 201 111 193 113 C181 116 167 121 153 128 Z" fill="${C.body}"/>`,
};

const EXTRAS = {
  sparkles: `<g class="pip-sparkles" fill="${C.spark}"><path d="M22 34 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z"/>
    <path d="M176 28 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z"/><path d="M186 118 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5 Z"/><circle cx="14" cy="120" r="4"/></g>`,
  waves: `<g class="pip-waves" fill="none" stroke="${C.wave}" stroke-width="4.5" stroke-linecap="round"><path d="M22 70 Q14 82 22 94"/><path d="M12 62 Q0 82 12 102"/></g>
    <g fill="${C.note}"><circle cx="176" cy="48" r="6"/><rect x="180.5" y="20" width="3.6" height="29" rx="1.8"/><path d="M184 20 q10 4 9 14 q-3 -6 -9 -6 Z"/></g>`,
  sweat: `<path d="M150 58 q9 12 0 18 q-9 -6 0 -18 Z" fill="${C.sweat}"/>`,
  notes: `<g fill="${C.note}"><circle cx="30" cy="54" r="6.5"/><rect x="34.5" y="26" width="3.8" height="29" rx="1.9"/><path d="M38 26 q11 4 10 15 q-3 -7 -10 -7 Z"/>
    <circle cx="18" cy="104" r="5"/><rect x="21.5" y="84" width="3.2" height="21" rx="1.6"/></g>`,
  baton: `<path d="M178 66 L196 18" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M178 66 L196 18" stroke="#D9CFBB" stroke-width="1.2" stroke-linecap="round" opacity=".9"/><circle cx="178" cy="67" r="5" fill="#8E6A3E"/>`,
  zzz: `<g fill="${C.note}" font-family="Fredoka, Nunito, sans-serif" font-weight="700"><text x="148" y="44" font-size="22">z</text><text x="164" y="26" font-size="16">z</text></g>`,
  question: `<g fill="${C.note}" font-family="Fredoka, Nunito, sans-serif" font-weight="700"><text x="152" y="46" font-size="34">?</text></g>`,
  dash: `<g class="pip-dash" fill="none" stroke="${C.spark}" stroke-width="4.5" stroke-linecap="round"><path d="M208 90 l9 -6"/><path d="M211 104 h11"/><path d="M208 118 l9 6"/></g>`,
};

export const POSES = {
  hello: { eyes: 'open', beak: 'smile', wings: ['downL', 'waveR'], extra: [] },
  cheer: { eyes: 'joy', beak: 'open', wings: ['upL', 'upR'], extra: ['sparkles'] },
  listen: { eyes: 'up', beak: 'closed', wings: ['cupL', 'downR'], extra: ['waves'] },
  oops: { eyes: 'worried', beak: 'o', wings: ['hugL', 'hugR'], extra: ['sweat'] },
  conduct: { eyes: 'wink', beak: 'smile', wings: ['downL', 'waveR'], extra: ['baton', 'notes'] },
  think: { eyes: 'up', beak: 'closed', wings: ['downL', 'chinR'], extra: ['question'] },
  sleep: { eyes: 'closed', beak: 'closed', wings: ['hugL', 'hugR'], extra: ['zzz'] },
  // Points to the right with a flipper (mirror the slot with .pip-flip to point left).
  point: { eyes: 'open', beak: 'smile', wings: ['downL', 'pointR'], extra: ['dash'] },
};

const TUFT = `<path d="M103 26 L103 6" stroke="${C.body}" stroke-width="6" stroke-linecap="round"/><path d="M103 4 C113 8 124 14 121 30 C118 22 111 18 103 17 Z" fill="${C.body}"/>`;

// The beak Pip shows while talking alternates with the pose's own beak (see .pip-talk in CSS).
function beakGroup(name) {
  return `<g class="pip-beak">${BEAKS[name]}</g><g class="pip-talk">${BEAKS.open}</g>`;
}

function body(p) {
  const back = p.wings.filter((w) => !w.startsWith('hug') && w !== 'chinR').map((w) => WING[w]).join('');
  const front = p.wings.filter((w) => w.startsWith('hug') || w === 'chinR').map((w) => WING[w]).join('');
  return `<ellipse cx="100" cy="194" rx="52" ry="6" fill="${C.shadow}"/>
    <g class="pip-body">
    <ellipse cx="80" cy="187" rx="16" ry="7.5" fill="${C.foot}"/><ellipse cx="120" cy="187" rx="16" ry="7.5" fill="${C.foot}"/>
    <g class="pip-wings">${back}</g>${TUFT}
    <path d="M100 22 C140 22 166 58 166 110 C166 156 138 186 100 186 C62 186 34 156 34 110 C34 58 60 22 100 22 Z" fill="${C.body}"/>
    <ellipse cx="72" cy="50" rx="14" ry="7" transform="rotate(-32 72 50)" fill="${C.bodyHi}" opacity=".7"/>
    <ellipse cx="100" cy="138" rx="50" ry="45" fill="${C.mask}"/><circle cx="78" cy="92" r="30" fill="${C.mask}"/><circle cx="122" cy="92" r="30" fill="${C.mask}"/>
    <ellipse cx="100" cy="112" rx="40" ry="24" fill="${C.mask}"/>
    <ellipse cx="64" cy="112" rx="9" ry="5.5" fill="${C.cheek}" opacity=".6"/><ellipse cx="136" cy="112" rx="9" ry="5.5" fill="${C.cheek}" opacity=".6"/>
    <g class="pip-eyes">${EYES[p.eyes]}</g>
    ${beakGroup(p.beak)}
    <path d="M100 140 L79 129 Q73 140 79 151 Z" fill="${C.tie}"/><path d="M100 140 L121 129 Q127 140 121 151 Z" fill="${C.tie}"/>
    <path d="M82 133 Q80 138 81 142" fill="none" stroke="${C.tieHi}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M118 133 Q120 138 119 142" fill="none" stroke="${C.tieHi}" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="93.5" y="133.5" width="13" height="13" rx="4.5" fill="${C.tieDeep}"/>
    ${front}${p.extra.map((e) => EXTRAS[e]).join('')}
    </g>`;
}

// Idle life (CSS in style.css): each Pip gets its own blink cycle (two blinks per cycle at
// uneven spacing, so blinks land every ~3-6 s) and its own phase, so Pips never blink in unison.
function idleVars() {
  const cycle = 7 + Math.random() * 4;
  return `--blink:${cycle.toFixed(2)}s;--blink-at:-${(Math.random() * cycle).toFixed(2)}s;--breathe-at:-${(Math.random() * 3).toFixed(2)}s`;
}

/** Pip in a pose. size in px; cls extra classes. */
export function pip(pose = 'hello', size = 160, cls = '') {
  if (pose === 'face') return pipFace(size, null, cls);
  const p = POSES[pose] || POSES.hello;
  return `<svg class="pip pip-${pose} ${cls}" style="${idleVars()}" aria-hidden="true" viewBox="0 0 200 200" width="${size}" height="${size}" overflow="visible">${body(p)}</svg>`;
}

/** Head-only Pip (avatar, app icon). bg: squircle colour or null. */
export function pipFace(size = 48, bg = null, cls = '') {
  const back = bg ? `<rect x="0" y="0" width="200" height="200" rx="46" fill="${bg}"/>` : '';
  return `<svg class="pip pip-face ${cls}" style="${idleVars()}" aria-hidden="true" viewBox="0 0 200 200" width="${size}" height="${size}">${back}
    <g transform="translate(100 120) scale(1.42) translate(-100 -92)">
      <path d="M103 30 L103 12" stroke="${C.body}" stroke-width="6" stroke-linecap="round"/><path d="M103 10 C113 14 124 20 121 36 C118 28 111 24 103 23 Z" fill="${C.body}"/>
      <path d="M100 28 C140 28 162 58 162 100 C162 142 136 160 100 160 C64 160 38 142 38 100 C38 58 60 28 100 28 Z" fill="${C.body}"/>
      <ellipse cx="72" cy="52" rx="12" ry="6" transform="rotate(-32 72 52)" fill="${C.bodyHi}" opacity=".7"/>
      <circle cx="78" cy="94" r="29" fill="${C.mask}"/><circle cx="122" cy="94" r="29" fill="${C.mask}"/><ellipse cx="100" cy="126" rx="44" ry="30" fill="${C.mask}"/>
      <ellipse cx="64" cy="114" rx="8.5" ry="5" fill="${C.cheek}" opacity=".6"/><ellipse cx="136" cy="114" rx="8.5" ry="5" fill="${C.cheek}" opacity=".6"/>
      <g transform="translate(0 2)"><g class="pip-eyes">${EYES.open}</g>${beakGroup('smile')}</g>
    </g></svg>`;
}

/** Swap the pose of a Pip already in the DOM (keeps its size and classes). */
export function setPose(el, pose) {
  if (!el) return;
  const svg = el.matches && el.matches('svg.pip') ? el : el.querySelector('svg.pip');
  if (!svg || svg.classList.contains(`pip-${pose}`)) return;
  const size = svg.getAttribute('width');
  const extra = [...svg.classList].filter((c) => c !== 'pip' && !c.startsWith('pip-')).join(' ');
  const tmp = document.createElement('div');
  tmp.innerHTML = pip(pose, size, `${extra} pip-swap`);
  if (svg.getAttribute('style')) tmp.firstChild.setAttribute('style', svg.getAttribute('style'));
  svg.replaceWith(tmp.firstChild);
}

// ---- icons (24 x 24, currentColor unless noted) -------------------------------------------
const MONO = {
  close: '<path d="M6.3 4.2 12 9.9l5.7-5.7a1.5 1.5 0 0 1 2.1 2.1L14.1 12l5.7 5.7a1.5 1.5 0 0 1-2.1 2.1L12 14.1l-5.7 5.7a1.5 1.5 0 0 1-2.1-2.1L9.9 12 4.2 6.3a1.5 1.5 0 0 1 2.1-2.1Z"/>',
  back: '<path d="M10.6 5.1a1.6 1.6 0 0 1 0 2.3L7.6 10.4H19a1.6 1.6 0 0 1 0 3.2H7.6l3 3a1.6 1.6 0 1 1-2.3 2.3l-5.7-5.8a1.6 1.6 0 0 1 0-2.2l5.7-5.8a1.6 1.6 0 0 1 2.3 0Z"/>',
  fwd: '<path d="M13.4 5.1a1.6 1.6 0 0 0 0 2.3l3 3H5a1.6 1.6 0 0 0 0 3.2h11.4l-3 3a1.6 1.6 0 1 0 2.3 2.3l5.7-5.8a1.6 1.6 0 0 0 0-2.2l-5.7-5.8a1.6 1.6 0 0 0-2.3 0Z"/>',
  chevron: '<path d="M8.9 4.6a1.6 1.6 0 0 1 2.2 0l6.2 6.3a1.6 1.6 0 0 1 0 2.2l-6.2 6.3a1.6 1.6 0 1 1-2.3-2.3l5.2-5.1-5.2-5.1a1.6 1.6 0 0 1 0-2.3Z"/>',
  up: '<path d="M12 3.6c.4 0 .8.2 1.1.5l5.8 5.7a1.6 1.6 0 1 1-2.3 2.3l-3-3V19a1.6 1.6 0 0 1-3.2 0V9.1l-3 3a1.6 1.6 0 1 1-2.3-2.3l5.8-5.7c.3-.3.7-.5 1.1-.5Z"/>',
  down: '<path d="M12 20.4c-.4 0-.8-.2-1.1-.5l-5.8-5.7a1.6 1.6 0 1 1 2.3-2.3l3 3V5a1.6 1.6 0 0 1 3.2 0v9.9l3-3a1.6 1.6 0 1 1 2.3 2.3l-5.8 5.7c-.3.3-.7.5-1.1.5Z"/>',
  play: '<path d="M7.5 4.3c0-1.2 1.3-1.9 2.3-1.3l10.6 7.7c.9.6.9 2 0 2.6L9.8 21c-1 .7-2.3 0-2.3-1.3V4.3Z"/>',
  pause: '<rect x="5" y="4" width="5.2" height="16" rx="2"/><rect x="13.8" y="4" width="5.2" height="16" rx="2"/>',
  plus: '<path d="M12 4.2c.9 0 1.6.7 1.6 1.6v4.6h4.6a1.6 1.6 0 0 1 0 3.2h-4.6v4.6a1.6 1.6 0 0 1-3.2 0v-4.6H5.8a1.6 1.6 0 0 1 0-3.2h4.6V5.8c0-.9.7-1.6 1.6-1.6Z"/>',
  minus: '<rect x="4.2" y="10.4" width="15.6" height="3.2" rx="1.6"/>',
  check: '<path d="M19.6 6.1a1.7 1.7 0 0 1 .1 2.4l-8.6 9.6a1.7 1.7 0 0 1-2.5 0l-4.4-4.7a1.7 1.7 0 1 1 2.5-2.3l3.1 3.3 7.4-8.2a1.7 1.7 0 0 1 2.4-.1Z"/>',
  lock: '<path d="M12 2.8a5 5 0 0 1 5 5v2.3h.6c1.3 0 2.4 1.1 2.4 2.4v6.6c0 1.3-1.1 2.4-2.4 2.4H6.4A2.4 2.4 0 0 1 4 19.1v-6.6c0-1.3 1.1-2.4 2.4-2.4H7V7.8a5 5 0 0 1 5-5Zm0 3a2 2 0 0 0-2 2v2.3h4V7.8a2 2 0 0 0-2-2Zm0 7.5a1.6 1.6 0 0 0-.9 3v1.4a.9.9 0 0 0 1.8 0v-1.4a1.6 1.6 0 0 0-.9-3Z"/>',
  speaker: '<path d="M11.3 4.3c.9-.7 2.2-.1 2.2 1.1v13.2c0 1.2-1.3 1.8-2.2 1.1L7 16H4.6C3.7 16 3 15.3 3 14.4V9.6C3 8.7 3.7 8 4.6 8H7l4.3-3.7Z"/><path d="M16.3 8.2a1.3 1.3 0 0 1 1.8.2 5.8 5.8 0 0 1 0 7.2 1.3 1.3 0 1 1-2-1.6 3.2 3.2 0 0 0 0-4 1.3 1.3 0 0 1 .2-1.8Z"/><path d="M18.6 5.2a1.3 1.3 0 0 1 1.8 0 9.8 9.8 0 0 1 0 13.6 1.3 1.3 0 0 1-1.9-1.8 7.2 7.2 0 0 0 0-10 1.3 1.3 0 0 1 .1-1.8Z"/>',
  search: '<path d="M10.5 3a7.5 7.5 0 0 1 6.1 11.9l3.9 3.9a1.6 1.6 0 1 1-2.3 2.3l-3.9-3.9A7.5 7.5 0 1 1 10.5 3Zm0 3.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6Z"/>',
  upload: '<path d="M12 3c.4 0 .8.2 1.1.5l4.3 4.3a1.5 1.5 0 1 1-2.1 2.1l-1.8-1.8v6.6a1.5 1.5 0 0 1-3 0V8.1L8.7 9.9a1.5 1.5 0 1 1-2.1-2.1l4.3-4.3c.3-.3.7-.5 1.1-.5Z"/><path d="M4.5 14c.8 0 1.5.7 1.5 1.5V18h12v-2.5a1.5 1.5 0 0 1 3 0V18c0 1.7-1.3 3-3 3H6a3 3 0 0 1-3-3v-2.5c0-.8.7-1.5 1.5-1.5Z"/>',
  mic: '<path d="M12 2.5a3.8 3.8 0 0 1 3.8 3.8v5.4a3.8 3.8 0 0 1-7.6 0V6.3A3.8 3.8 0 0 1 12 2.5Z"/><path d="M6 10.4c.8 0 1.4.6 1.4 1.4a4.6 4.6 0 0 0 9.2 0 1.4 1.4 0 0 1 2.8 0 7.4 7.4 0 0 1-6 7.3v1.5a1.4 1.4 0 0 1-2.8 0v-1.5a7.4 7.4 0 0 1-6-7.3c0-.8.6-1.4 1.4-1.4Z"/>',
  retry: '<path d="M12 3.5a8.5 8.5 0 1 1-8.2 10.7 1.5 1.5 0 0 1 2.9-.8A5.5 5.5 0 1 0 8 7.9l1.3.1a1.5 1.5 0 0 1-.2 3l-4.3-.4A1.5 1.5 0 0 1 3.4 9L3 4.8a1.5 1.5 0 0 1 3-.3l.1 1.2A8.5 8.5 0 0 1 12 3.5Z"/>',
  book: '<path d="M4 5.2C4 4 5 3 6.2 3H18c1.1 0 2 .9 2 2v12.2c0 .6-.4 1-1 1.1-.6.1-1 .6-1 1.2s.4 1.1 1 1.2c.6.1 1 .5 1 1.1V22H6.5A2.5 2.5 0 0 1 4 19.5V5.2Zm3.5 13.3a1 1 0 1 0 0 2h8.8a3.8 3.8 0 0 1 0-2H7.5ZM8 7v2h8V7H8Z"/>',
  clock: '<path d="M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4Zm0 3c-.8 0-1.4.6-1.4 1.4V12c0 .4.2.8.5 1l3.3 2.6a1.4 1.4 0 0 0 1.7-2.2l-2.7-2.1V7.2c0-.8-.6-1.4-1.4-1.4Z"/>',
  gear: '<path d="M13.4 2.5c.6 0 1.1.4 1.2 1l.3 1.8c.5.2.9.4 1.3.7l1.7-.7c.6-.2 1.2 0 1.5.5l1.4 2.4c.3.5.2 1.2-.3 1.6l-1.4 1.1a7 7 0 0 1 0 1.5l1.4 1.1c.5.4.6 1.1.3 1.6l-1.4 2.4c-.3.5-1 .7-1.5.5l-1.7-.7c-.4.3-.8.5-1.3.7l-.3 1.8c-.1.6-.6 1-1.2 1h-2.8c-.6 0-1.1-.4-1.2-1l-.3-1.8c-.5-.2-.9-.4-1.3-.7l-1.7.7c-.6.2-1.2 0-1.5-.5l-1.4-2.4c-.3-.5-.2-1.2.3-1.6l1.4-1.1a7 7 0 0 1 0-1.5L3.4 9.8c-.5-.4-.6-1.1-.3-1.6l1.4-2.4c.3-.5 1-.7 1.5-.5l1.7.7c.4-.3.8-.5 1.3-.7l.3-1.8c.1-.6.6-1 1.2-1h2.9ZM12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"/>',
  note: '<path d="M17.3 2.7c.9-.3 1.7.4 1.7 1.3v11.8a3.6 3.6 0 1 1-2.6-3.5V7.6l-7 2.2v8a3.6 3.6 0 1 1-2.6-3.5V6.9c0-.6.4-1.1 1-1.3l9.5-2.9Z"/>',
  target: '<path d="M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4Zm0 3.4a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6Zm0 3.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z"/>',
  chart: '<rect x="3" y="12" width="4.6" height="9" rx="1.8"/><rect x="9.7" y="7" width="4.6" height="14" rx="1.8"/><rect x="16.4" y="3" width="4.6" height="18" rx="1.8"/>',
  home: '<path d="M10.6 3.1a2.2 2.2 0 0 1 2.8 0l7 5.6c.4.4.6.9.6 1.4V19c0 1.1-.9 2-2 2h-4v-5.5a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 15.5V21H5a2 2 0 0 1-2-2v-8.9c0-.5.2-1 .6-1.4l7-5.6Z"/>',
  sparkle: '<path d="M12 2.5c.5 0 .9.3 1 .8l1.2 4.6c.2.8.8 1.5 1.7 1.7l4.6 1.2c1 .3 1 1.7 0 2l-4.6 1.2c-.9.2-1.5.9-1.7 1.7L13 20.3c-.3 1-1.7 1-2 0l-1.2-4.6c-.2-.8-.8-1.5-1.7-1.7l-4.6-1.2c-1-.3-1-1.7 0-2l4.6-1.2c.9-.2 1.5-.9 1.7-1.7L11 3.3c.1-.5.5-.8 1-.8Z"/>',
  metronome: '<path d="M9.6 3h4.8c.7 0 1.3.5 1.5 1.1l3.9 15.1c.3 1-.5 1.8-1.5 1.8H5.7c-1 0-1.8-.9-1.5-1.8L8.1 4.1C8.3 3.5 8.9 3 9.6 3Zm.9 3-1.6 6.4 2.2-.8 4.3-4.9L15 6h-4.5Zm7.2-2.6a1.3 1.3 0 0 1 .4 1.8l-5.3 8.6a1.3 1.3 0 1 1-2.2-1.4l5.3-8.6a1.3 1.3 0 0 1 1.8-.4ZM7.8 17.4h8.4l-.6-2.4H8.4l-.6 2.4Z"/>',
  hourglass: '<path d="M6 3h12a1.5 1.5 0 0 1 0 3h-.5c0 2.6-1.4 4.7-3.5 6 2.1 1.3 3.5 3.4 3.5 6h.5a1.5 1.5 0 0 1 0 3H6a1.5 1.5 0 0 1 0-3h.5c0-2.6 1.4-4.7 3.5-6-2.1-1.3-3.5-3.4-3.5-6H6a1.5 1.5 0 0 1 0-3Zm3.6 3c0 1.9 1.1 3.5 2.4 4.3 1.3-.8 2.4-2.4 2.4-4.3H9.6Z"/>',
  levels: '<rect x="3" y="4" width="18" height="4" rx="2"/><rect x="3" y="10" width="13" height="4" rx="2"/><rect x="3" y="16" width="8" height="4" rx="2"/>',
  ear: '<path d="M12.5 2.5a7 7 0 0 1 7 7c0 2.4-1 3.7-2 4.9-.8 1-1.5 1.8-1.7 3.2a4.4 4.4 0 0 1-8.6.7 1.4 1.4 0 1 1 2.7-.8 1.6 1.6 0 0 0 3.1-.3c.3-2.3 1.4-3.6 2.3-4.7.8-1 1.4-1.7 1.4-3a4.2 4.2 0 1 0-8.4 0 1.4 1.4 0 0 1-2.8 0 7 7 0 0 1 7-7Z"/>',
};

const BADGE = {
  flame: '<path d="M12.6 1.8c.4-.4 1-.3 1.3.1 1.2 1.8 1.7 3.7 1.4 5.6 1-.4 1.7-1.2 2.1-2.2.2-.5.9-.7 1.3-.3A9.4 9.4 0 0 1 21 11.7c0 5.3-4 9.5-9 9.5s-9-4.2-9-9.5c0-3.7 2-6.3 4.2-8.4.4-.4 1.1-.2 1.3.3.4 1.1.9 1.9 1.6 2.5.3-2 1.2-3.8 2.5-5.3Z" fill="#FF7A2F"/><path d="M12.2 10.3c.3-.3.8-.3 1.1 0 1.6 1.5 3.1 3.3 3.1 5.6a4.4 4.4 0 0 1-8.8 0c0-1.3.6-2.4 1.4-3.2.3-.3.8-.2 1 .2l.5 1c.5-1.4 1-2.6 1.7-3.6Z" fill="#FFC23D"/>',
  flameOff: '<path d="M12.6 1.8c.4-.4 1-.3 1.3.1 1.2 1.8 1.7 3.7 1.4 5.6 1-.4 1.7-1.2 2.1-2.2.2-.5.9-.7 1.3-.3A9.4 9.4 0 0 1 21 11.7c0 5.3-4 9.5-9 9.5s-9-4.2-9-9.5c0-3.7 2-6.3 4.2-8.4.4-.4 1.1-.2 1.3.3.4 1.1.9 1.9 1.6 2.5.3-2 1.2-3.8 2.5-5.3Z" fill="#E3D8C6"/>',
  bolt: '<path d="M13.9 1.9c.7-.9 2.1-.2 1.9.9l-1.3 6.6h4.3c1 0 1.6 1.2.9 2l-8.2 10.7c-.7.9-2.1.2-1.9-.9l1.3-6.6H6.6c-1 0-1.6-1.2-.9-2l8.2-10.7Z" fill="#FFC23D"/><path d="M13.9 1.9c.7-.9 2.1-.2 1.9.9l-1.3 6.6h-3.2L13.9 2Z" fill="#FFE08A"/>',
  star: '<path d="M11.1 2.6c.4-.8 1.5-.8 1.9 0l2.4 4.9 5.4.8c.9.1 1.2 1.2.6 1.8l-3.9 3.8.9 5.4c.2.9-.8 1.5-1.5 1.1L12 17.8l-4.9 2.6c-.8.4-1.7-.2-1.5-1.1l.9-5.4-3.9-3.8c-.6-.6-.3-1.7.6-1.8l5.4-.8 2.5-4.9Z" fill="#FFC23D"/><path d="M11.1 2.6c.4-.8 1.5-.8 1.9 0l2.4 4.9-3.4 3.4-3.4-3.4 2.5-4.9Z" fill="#FFD970"/>',
  starOff: '<path d="M11.1 2.6c.4-.8 1.5-.8 1.9 0l2.4 4.9 5.4.8c.9.1 1.2 1.2.6 1.8l-3.9 3.8.9 5.4c.2.9-.8 1.5-1.5 1.1L12 17.8l-4.9 2.6c-.8.4-1.7-.2-1.5-1.1l.9-5.4-3.9-3.8c-.6-.6-.3-1.7.6-1.8l5.4-.8 2.5-4.9Z" fill="#E6DCCB"/>',
  trophy: '<path d="M6 3h12c.6 0 1 .4 1 1v1h1.5c.8 0 1.5.7 1.5 1.5V8a4.5 4.5 0 0 1-4 4.5 6 6 0 0 1-4.5 3.4V18h2.5c.8 0 1.5.7 1.5 1.5V21H6.5v-1.5c0-.8.7-1.5 1.5-1.5h2.5v-2.1A6 6 0 0 1 6 12.5 4.5 4.5 0 0 1 2 8V6.5C2 5.7 2.7 5 3.5 5H5V4c0-.6.4-1 1-1ZM4 7v1c0 1 .5 1.9 1.3 2.3A6 6 0 0 1 5 9V7H4Zm15 0v2c0 .5 0 .9-.1 1.3.7-.4 1.1-1.3 1.1-2.3V7h-1Z" fill="#FFC23D"/><path d="M9 5.5h2v6.5c-1.2-.4-2-1.6-2-3V5.5Z" fill="#FFE08A"/>',
  crown: '<path d="M3.2 7.6c-.1-.9.9-1.5 1.6-.9l3.7 3.1 2.6-5c.4-.8 1.5-.8 1.9 0l2.6 5 3.7-3.1c.7-.6 1.8 0 1.6.9l-1.5 10c-.1.8-.8 1.4-1.6 1.4H6.3c-.8 0-1.5-.6-1.6-1.4l-1.5-10Z" fill="#FFC23D"/><rect x="6" y="15" width="12" height="2.2" rx="1.1" fill="#E09A0B"/>',
};

export function icon(name, size = 24, cls = '') {
  if (name === 'pianokeys') {
    return `<svg class="ic ${cls}" aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}"><g fill="currentColor"><rect x="3" y="5" width="5.4" height="14" rx="1.6"/><rect x="9.3" y="5" width="5.4" height="14" rx="1.6"/><rect x="15.6" y="5" width="5.4" height="14" rx="1.6"/></g><g fill="#2E2B5F"><rect x="6.6" y="5" width="4.2" height="8.2" rx="1.2"/><rect x="13.2" y="5" width="4.2" height="8.2" rx="1.2"/></g></svg>`;
  }
  if (BADGE[name]) return `<svg class="ic ic-${name} ${cls}" aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}">${BADGE[name]}</svg>`;
  return `<svg class="ic ic-${name} ${cls}" aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">${MONO[name] || MONO.note}</svg>`;
}

/** Signal bars (experience level 1..4). */
export function bars(level, size = 34) {
  const hs = [7, 12, 17, 22];
  return `<svg class="bars" aria-hidden="true" viewBox="0 0 28 26" width="${size}" height="${Math.round((size * 26) / 28)}">${hs
    .map((h, i) => `<rect x="${1 + i * 7}" y="${24 - h}" width="5" height="${h}" rx="2.5" fill="${i < level ? '#6F4BF2' : '#DCD3F7'}"/>`)
    .join('')}</svg>`;
}

/** "maestro": the t's stem grows into an eighth-note flag (Fredoka Bold metrics). */
export function wordmark(size = 40, color = 'var(--brand)') {
  return `<span class="wordmark" style="font-size:${size}px;color:${color}" role="img" aria-label="Maestro"><span aria-hidden="true">maest</span><svg aria-hidden="true" viewBox="0 0 50 110" style="width:.5em;height:1.1em;margin-left:-.41em;margin-right:-.09em;vertical-align:baseline;overflow:visible"><path d="M10 60 V20.5 A8.5 8.5 0 0 1 27 20.5 V60 Z" fill="currentColor"/><path d="M24 12 C39 15 57 26 52 50 C48 40.5 38 35 25 34 Z" fill="currentColor"/></svg><span aria-hidden="true">ro</span></span>`;
}

// ---- confetti (canvas, capped, respects reduced motion) ------------------------------------
const PALETTE = ['#6F4BF2', '#FFC23D', '#20C07A', '#FF5A6A', '#2F9BFF', '#FF9A2E'];
export const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export function confetti(canvas, { count = 100, palette = PALETTE, from = 'corners', duration = 2800 } = {}) {
  if (!canvas || reducedMotion()) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const W = r.width, H = r.height;
  if (!W || !H) return () => {};
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  const n = Math.min(120, count);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const left = i % 2 === 0;
    let x, y, vx, vy;
    if (from === 'top') {
      x = Math.random() * W;
      y = -20 - Math.random() * H * 0.3;
      vx = (Math.random() - 0.5) * 120;
      vy = 60 + Math.random() * 160;
    } else {
      const ang = ((60 + Math.random() * 22) * Math.PI) / 180;
      const sp = 700 + Math.random() * 450;
      x = left ? -10 : W + 10;
      y = H + 10;
      vx = Math.cos(ang) * sp * (left ? 1 : -1) * (W / 1180);
      vy = -Math.sin(ang) * sp * Math.max(0.8, H / 820);
    }
    parts.push({ x, y, vx, vy, rot: Math.random() * 6.28, vr: (Math.random() * 2 - 1) * 9, kind: i % 4, c: palette[i % palette.length], ph: Math.random() * 6.28, f: 2 + Math.random() * 2, delay: Math.random() * 160 });
  }
  const t0 = performance.now();
  let last = t0;
  let raf = 0;
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = now - t0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fade = age > duration - 400 ? Math.max(0, (duration - age) / 400) : 1;
    ctx.globalAlpha = fade;
    for (const p of parts) {
      if (age < p.delay) continue;
      p.vy += 1400 * dt * (from === 'top' ? 0.25 : 1);
      p.vx *= 1 - 0.9 * dt;
      p.vy *= 1 - 0.35 * dt;
      p.x += p.vx * dt + Math.sin(p.ph + age / 1000 * p.f * 6.28) * 0.6;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.strokeStyle = p.c;
      if (p.kind === 0) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-5, -9, 10, 18, 3);
        else ctx.rect(-5, -9, 10, 18);
        ctx.fill();
      } else if (p.kind === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, 6.28);
        ctx.fill();
      } else if (p.kind === 2) {
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.quadraticCurveTo(-5, -8, 0, 0);
        ctx.quadraticCurveTo(5, 8, 10, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(2.4, -2.4);
        ctx.lineTo(8, 0);
        ctx.lineTo(2.4, 2.4);
        ctx.lineTo(0, 8);
        ctx.lineTo(-2.4, 2.4);
        ctx.lineTo(-8, 0);
        ctx.lineTo(-2.4, -2.4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    if (age < duration) raf = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(raf);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

export const PIP_COLORS = C;
