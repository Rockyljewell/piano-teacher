// Side-by-side summary of listening-benchmark reports (tests/bench-listen.js JSON output):
// the targets, the go/no-go bar of the learned listener, per condition.
//
//   node tools/nn/compare.mjs name=path/to/report.json [name2=...]
import fs from 'node:fs';

const runs = process.argv.slice(2).map((a) => {
  const [name, file] = a.includes('=') ? a.split('=') : [a, a];
  return { name, R: JSON.parse(fs.readFileSync(file, 'utf8')) };
});
const p = (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%');
const ms = (v) => (v == null ? '–' : Math.round(v));

function agg(R, cond, mode, mats) {
  let n = 0,
    hit = 0,
    ex = 0,
    exc = 0,
    ch = 0,
    chc = 0,
    oc = 0,
    occ = 0;
  for (const inst of R.heldOut.length ? R.heldOut : R.instruments)
    for (const m of mats) {
      const c = R.cells[`${inst}|${cond}|${mode}|${m}`];
      if (!c) continue;
      n += c.n;
      hit += c.hit;
      ex += c.extras;
      exc += c.extrasConf;
      ch += c.chords;
      chc += (c.chordComplete || 0) * c.chords;
      oc += c.octaves;
      occ += (c.octaveComplete || 0) * c.octaves;
    }
  const r = n ? hit / n : null,
    pr = hit + ex ? hit / (hit + ex) : null;
  return { r, p: pr, f1: r != null && pr != null && r + pr ? (2 * r * pr) / (r + pr) : null, chords: ch ? chc / ch : null, oct: oc ? occ / oc : null, extrasConf: exc };
}

const rows = [];
const conds = [...new Set(runs.flatMap((x) => x.R.conditions))].filter((c) => c !== 'close');
for (const cond of conds) {
  const line = (label, f) => rows.push([`${label} (${cond})`, ...runs.map((x) => (x.R.conditions.includes(cond) ? f(x.R) : '–'))]);
  const T = (R, id) => R.targets[id] && R.targets[id][cond] && R.targets[id][cond].value;
  line('latency lesson ≥C3 med/p90 ms', (R) => {
    const v = T(R, 'latLessonUp');
    return v ? `${ms(v.med)}/${ms(v.p90)}` : '–';
  });
  line('latency lesson <C3 med ms', (R) => {
    const v = T(R, 'latLessonLo');
    return v ? `${ms(v.med)}` : '–';
  });
  line('latency free ≥C3 med/p90 ms', (R) => {
    const v = T(R, 'latFreeUp');
    return v ? `${ms(v.med)}/${ms(v.p90)}` : '–';
  });
  line('lesson F1, pieces L1-20', (R) => p(T(R, 'f1Lesson')));
  line('lesson chords complete', (R) => p(T(R, 'chordLesson')));
  line('lesson octaves complete', (R) => p(T(R, 'octLesson')));
  line('free triads R/P', (R) => {
    const v = T(R, 'triadFree');
    return v ? `${p(v.recall)}/${p(v.precision)}` : '–';
  });
  line('free octaves complete', (R) => p(T(R, 'octFree')));
  line('free singles R/P', (R) => {
    const a = agg(R, cond, 'free', ['singles']);
    return `${p(a.r)}/${p(a.p)}`;
  });
  line('lesson singles R/P', (R) => {
    const a = agg(R, cond, 'lesson', ['singles']);
    return `${p(a.r)}/${p(a.p)}`;
  });
  line('free 16th scales R', (R) => p(T(R, 'scalesFree')));
  line('lesson fast passages R', (R) => p(agg(R, cond, 'lesson', ['scales16', 'repeated8', 'trills', 'arpeggios']).r));
  line('lesson pedal F1', (R) => p(agg(R, cond, 'lesson', ['pedal']).f1));
  line('lesson both-hands complete', (R) => p(agg(R, cond, 'lesson', ['bothhands']).chords));
  line('free both-hands complete', (R) => p(agg(R, cond, 'free', ['bothhands']).chords));
}
rows.push(['noise-only false notes/min (realistic, sum)', ...runs.map((x) => (x.R.noise ? Object.values(x.R.noise).reduce((a, v) => a + (v.realistic ? v.realistic.fpm : 0), 0).toFixed(1) : '–'))]);
rows.push(['  of which confidence ≥ .55', ...runs.map((x) => (x.R.noise ? Object.values(x.R.noise).reduce((a, v) => a + (v.realistic ? v.realistic.fpmConf : 0), 0).toFixed(1) : '–'))]);
rows.push(['  speech', ...runs.map((x) => (x.R.noise && x.R.noise.speech && x.R.noise.speech.realistic ? x.R.noise.speech.realistic.fpm.toFixed(1) : '–'))]);
rows.push(['speed (× real time, median job)', ...runs.map((x) => x.R.speed.median.toFixed(1) + '×')]);
const head = ['', ...runs.map((x) => x.name)];
console.log(`| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n` + rows.map((r) => `| ${r.join(' | ')} |`).join('\n'));
