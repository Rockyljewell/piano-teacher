// Pip, the Maestro mascot: a round little penguin in concert tails.
// Pip's body is the note head and the tuft on top is the stem and flag of an eighth note.
// Original art for Maestro. Every pose is built from the same parts so the character stays on-model.
//
// pip({ pose, size, cls }) returns an inline <svg> string.
// Poses: hello, cheer, listen, oops, conduct, think, sleep, face (head-only, for avatars and the app icon).

const C = {
  body: '#2E2B5F',
  bodyHi: '#433F82',
  mask: '#FFF4E0',
  eye: '#1C1936',
  beak: '#FFA629',
  beakDeep: '#E5801A',
  mouth: '#C9471C',
  tongue: '#FF7F8E',
  cheek: '#FF8FA8',
  tie: '#6F4BF2',
  tieDeep: '#4F30C9',
  tieHi: '#9B82FF',
  foot: '#FFA629',
  shadow: 'rgba(46,43,95,0.14)',
  spark: '#FFC23D',
  note: '#6F4BF2',
  wave: '#2F9BFF',
  sweat: '#7CC8FF',
  baton: '#FFFFFF',
};

const eyes = {
  open: `
    <ellipse cx="80" cy="92" rx="10.5" ry="13" fill="${C.eye}"/>
    <ellipse cx="120" cy="92" rx="10.5" ry="13" fill="${C.eye}"/>
    <circle cx="84.5" cy="86.5" r="4.2" fill="#fff"/><circle cx="124.5" cy="86.5" r="4.2" fill="#fff"/>
    <circle cx="76.5" cy="98" r="2" fill="#fff" opacity=".85"/><circle cx="116.5" cy="98" r="2" fill="#fff" opacity=".85"/>`,
  joy: `
    <path d="M69 96 Q80 80 91 96" fill="none" stroke="${C.eye}" stroke-width="6" stroke-linecap="round"/>
    <path d="M109 96 Q120 80 131 96" fill="none" stroke="${C.eye}" stroke-width="6" stroke-linecap="round"/>`,
  up: `
    <ellipse cx="81" cy="91" rx="10.5" ry="13" fill="${C.eye}"/>
    <ellipse cx="121" cy="91" rx="10.5" ry="13" fill="${C.eye}"/>
    <circle cx="86.5" cy="84" r="4.2" fill="#fff"/><circle cx="126.5" cy="84" r="4.2" fill="#fff"/>
    <circle cx="78" cy="97" r="1.8" fill="#fff" opacity=".85"/><circle cx="118" cy="97" r="1.8" fill="#fff" opacity=".85"/>`,
  worried: `
    <ellipse cx="80" cy="94" rx="9.5" ry="12" fill="${C.eye}"/>
    <ellipse cx="120" cy="94" rx="9.5" ry="12" fill="${C.eye}"/>
    <circle cx="83.5" cy="89" r="3.8" fill="#fff"/><circle cx="123.5" cy="89" r="3.8" fill="#fff"/>
    <path d="M68 76 Q78 70 89 73" fill="none" stroke="${C.body}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M111 73 Q122 70 132 76" fill="none" stroke="${C.body}" stroke-width="4.5" stroke-linecap="round"/>`,
  wink: `
    <ellipse cx="80" cy="92" rx="10.5" ry="13" fill="${C.eye}"/>
    <circle cx="84.5" cy="86.5" r="4.2" fill="#fff"/><circle cx="76.5" cy="98" r="2" fill="#fff" opacity=".85"/>
    <path d="M109 94 Q120 84 131 94" fill="none" stroke="${C.eye}" stroke-width="6" stroke-linecap="round"/>`,
  closed: `
    <path d="M70 92 Q80 100 90 92" fill="none" stroke="${C.eye}" stroke-width="5" stroke-linecap="round"/>
    <path d="M110 92 Q120 100 130 92" fill="none" stroke="${C.eye}" stroke-width="5" stroke-linecap="round"/>`,
};

const beaks = {
  closed: `
    <path d="M87 106 Q100 99 113 106 Q107 119 100 120 Q93 119 87 106 Z" fill="${C.beak}"/>
    <path d="M91 106.5 Q100 102 109 106.5" fill="none" stroke="#FFD27A" stroke-width="2.4" stroke-linecap="round"/>`,
  smile: `
    <path d="M87 105 Q100 98 113 105 Q108 113 100 113 Q92 113 87 105 Z" fill="${C.beak}"/>
    <path d="M90 114 Q100 124 110 114 Q100 117 90 114 Z" fill="${C.beakDeep}"/>
    <path d="M91 105.5 Q100 101 109 105.5" fill="none" stroke="#FFD27A" stroke-width="2.4" stroke-linecap="round"/>`,
  open: `
    <path d="M85 104 Q100 96 115 104 Q108 112 100 112 Q92 112 85 104 Z" fill="${C.beak}"/>
    <path d="M89 113 Q100 110 111 113 Q107 129 100 130 Q93 129 89 113 Z" fill="${C.mouth}"/>
    <path d="M93 123 Q100 118 107 123 Q104 129 100 129.5 Q96 129 93 123 Z" fill="${C.tongue}"/>
    <path d="M89 104.5 Q100 99.5 111 104.5" fill="none" stroke="#FFD27A" stroke-width="2.4" stroke-linecap="round"/>`,
  o: `
    <path d="M88 105 Q100 99 112 105 Q107 111 100 111 Q93 111 88 105 Z" fill="${C.beak}"/>
    <ellipse cx="100" cy="117" rx="6" ry="6.5" fill="${C.mouth}"/>`,
};

// Flippers. Each is drawn in body colour; wing "tips" catch a little highlight.
const wing = {
  downL: `<path d="M42 104 C24 118 20 148 30 162 C40 158 47 140 49 118 Z" fill="${C.body}"/>`,
  downR: `<path d="M158 104 C176 118 180 148 170 162 C160 158 153 140 151 118 Z" fill="${C.body}"/>`,
  waveR: `<path d="M152 112 C170 104 186 82 184 62 C174 62 162 78 150 98 Z" fill="${C.body}"/>`,
  upL: `<path d="M48 112 C30 104 14 82 16 62 C26 62 38 78 50 98 Z" fill="${C.body}"/>`,
  upR: `<path d="M152 112 C170 104 186 82 184 62 C174 62 162 78 150 98 Z" fill="${C.body}"/>`,
  cupL: `<path d="M46 110 C30 100 26 80 34 66 C42 70 48 86 52 102 Z" fill="${C.body}"/>`,
  chinR: `<path d="M168 136 C168 116 158 100 142 98 C134 98 131 106 136 111 C144 114 150 122 152 138 Z" fill="${C.body}"/>`,
  hugL: `<path d="M44 108 C34 124 42 142 62 146 C62 138 54 128 52 116 Z" fill="${C.body}"/>`,
  hugR: `<path d="M156 108 C166 124 158 142 138 146 C138 138 146 128 148 116 Z" fill="${C.body}"/>`,
};

const extras = {
  sparkles: `
    <g fill="${C.spark}">
      <path d="M22 34 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z"/>
      <path d="M176 28 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z"/>
      <path d="M186 118 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5 Z"/>
      <circle cx="14" cy="120" r="4"/>
    </g>`,
  waves: `
    <g fill="none" stroke="${C.wave}" stroke-width="4.5" stroke-linecap="round">
      <path d="M22 70 Q14 82 22 94"/><path d="M12 62 Q0 82 12 102"/>
    </g>
    <g fill="${C.note}"><circle cx="176" cy="48" r="6"/><rect x="180.5" y="20" width="3.6" height="29" rx="1.8"/><path d="M184 20 q10 4 9 14 q-3 -6 -9 -6 Z"/></g>`,
  sweat: `<path d="M150 58 q9 12 0 18 q-9 -6 0 -18 Z" fill="${C.sweat}"/>`,
  notes: `
    <g fill="${C.note}">
      <circle cx="30" cy="54" r="6.5"/><rect x="34.5" y="26" width="3.8" height="29" rx="1.9"/><path d="M38 26 q11 4 10 15 q-3 -7 -10 -7 Z"/>
      <circle cx="18" cy="104" r="5"/><rect x="21.5" y="84" width="3.2" height="21" rx="1.6"/>
    </g>`,
  baton: `
    <path d="M178 66 L196 18" stroke="${C.baton}" stroke-width="5" stroke-linecap="round"/>
    <path d="M178 66 L196 18" stroke="#D9CFBB" stroke-width="1.2" stroke-linecap="round" opacity=".9"/>
    <circle cx="178" cy="67" r="5" fill="#8E6A3E"/>`,
  zzz: `<g fill="${C.note}" font-family="Fredoka, Nunito, sans-serif" font-weight="700"><text x="148" y="44" font-size="22">z</text><text x="164" y="26" font-size="16">z</text></g>`,
  question: `<g fill="${C.note}" font-family="Fredoka, Nunito, sans-serif" font-weight="700"><text x="152" y="46" font-size="34">?</text></g>`,
};

const POSES = {
  hello:   { eyes: 'open',    beak: 'smile',  wings: ['downL', 'waveR'], extra: [] },
  cheer:   { eyes: 'joy',     beak: 'open',   wings: ['upL', 'upR'],     extra: ['sparkles'] },
  listen:  { eyes: 'up',      beak: 'closed', wings: ['cupL', 'downR'],  extra: ['waves'] },
  oops:    { eyes: 'worried', beak: 'o',      wings: ['hugL', 'hugR'],   extra: ['sweat'] },
  conduct: { eyes: 'wink',    beak: 'smile',  wings: ['downL', 'waveR'], extra: ['baton', 'notes'] },
  think:   { eyes: 'up',      beak: 'closed', wings: ['downL', 'chinR'], extra: ['question'] },
  sleep:   { eyes: 'closed',  beak: 'closed', wings: ['hugL', 'hugR'],   extra: ['zzz'] },
};

function tuft() {
  // Stem + flag of an eighth note growing out of the head.
  return `
    <path d="M103 26 L103 6" stroke="${C.body}" stroke-width="6" stroke-linecap="round"/>
    <path d="M103 4 C113 8 124 14 121 30 C118 22 111 18 103 17 Z" fill="${C.body}"/>`;
}

function bodyParts(p) {
  return `
    <ellipse cx="100" cy="194" rx="52" ry="6" fill="${C.shadow}"/>
    <ellipse cx="80" cy="187" rx="16" ry="7.5" fill="${C.foot}"/>
    <ellipse cx="120" cy="187" rx="16" ry="7.5" fill="${C.foot}"/>
    ${p.wings.filter((w) => w.endsWith('L') && !w.startsWith('hug')).map((w) => wing[w]).join('')}
    ${p.wings.filter((w) => w.endsWith('R') && !w.startsWith('hug') && w !== 'chinR').map((w) => wing[w]).join('')}
    ${tuft()}
    <path d="M100 22 C140 22 166 58 166 110 C166 156 138 186 100 186 C62 186 34 156 34 110 C34 58 60 22 100 22 Z" fill="${C.body}"/>
    <ellipse cx="72" cy="50" rx="14" ry="7" transform="rotate(-32 72 50)" fill="${C.bodyHi}" opacity=".7"/>
    <ellipse cx="100" cy="138" rx="50" ry="45" fill="${C.mask}"/>
    <circle cx="78" cy="92" r="30" fill="${C.mask}"/>
    <circle cx="122" cy="92" r="30" fill="${C.mask}"/>
    <ellipse cx="100" cy="112" rx="40" ry="24" fill="${C.mask}"/>
    <ellipse cx="64" cy="112" rx="9" ry="5.5" fill="${C.cheek}" opacity=".6"/>
    <ellipse cx="136" cy="112" rx="9" ry="5.5" fill="${C.cheek}" opacity=".6"/>
    ${eyes[p.eyes]}
    ${beaks[p.beak]}
    <g>
      <path d="M100 140 L79 129 Q73 140 79 151 Z" fill="${C.tie}"/>
      <path d="M100 140 L121 129 Q127 140 121 151 Z" fill="${C.tie}"/>
      <path d="M82 133 Q80 138 81 142" fill="none" stroke="${C.tieHi}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M118 133 Q120 138 119 142" fill="none" stroke="${C.tieHi}" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="93.5" y="133.5" width="13" height="13" rx="4.5" fill="${C.tieDeep}"/>
    </g>
    ${p.wings.filter((w) => w.startsWith('hug') || w === 'chinR').map((w) => wing[w]).join('')}
    ${p.extra.map((e) => extras[e]).join('')}`;
}

export function pip({ pose = 'hello', size = 160, cls = '', label } = {}) {
  if (pose === 'face') return pipFace({ size, cls });
  const p = POSES[pose];
  if (!p) throw new Error('Unknown Pip pose ' + pose);
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="pip pip-${pose} ${cls}" ${aria} viewBox="0 0 200 200" width="${size}" height="${size}" overflow="visible">${bodyParts(p)}</svg>`;
}

// Head-only crop for avatars and the app icon.
export function pipFace({ size = 48, cls = '', bg = null } = {}) {
  const back = bg ? `<rect x="0" y="0" width="200" height="200" rx="46" fill="${bg}"/>` : '';
  return `<svg class="pip-face ${cls}" aria-hidden="true" viewBox="0 0 200 200" width="${size}" height="${size}">
    ${back}
    <g transform="translate(100 120) scale(1.42) translate(-100 -92)">
      <path d="M103 30 L103 12" stroke="${C.body}" stroke-width="6" stroke-linecap="round"/>
      <path d="M103 10 C113 14 124 20 121 36 C118 28 111 24 103 23 Z" fill="${C.body}"/>
      <path d="M100 28 C140 28 162 58 162 100 C162 142 136 160 100 160 C64 160 38 142 38 100 C38 58 60 28 100 28 Z" fill="${C.body}"/>
      <ellipse cx="72" cy="52" rx="12" ry="6" transform="rotate(-32 72 52)" fill="${C.bodyHi}" opacity=".7"/>
      <circle cx="78" cy="94" r="29" fill="${C.mask}"/>
      <circle cx="122" cy="94" r="29" fill="${C.mask}"/>
      <ellipse cx="100" cy="126" rx="44" ry="30" fill="${C.mask}"/>
      <ellipse cx="64" cy="114" rx="8.5" ry="5" fill="${C.cheek}" opacity=".6"/>
      <ellipse cx="136" cy="114" rx="8.5" ry="5" fill="${C.cheek}" opacity=".6"/>
      <g transform="translate(0 2)">${eyes.open}</g>
      <g transform="translate(0 2)">${beaks.smile}</g>
    </g>
  </svg>`;
}

export const PIP_COLORS = C;
