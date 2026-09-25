// Adaptive placement test. The student's skill is modelled as a probability distribution over
// the curriculum (0 = not yet at level 1, 40 = master). Each short both-hands test at level L
// yields a score that updates the distribution (Bayes' rule with a smooth score model); the
// next test is chosen near the current best estimate, and always moves up after a good score
// and down after a poor one. The test stops once the estimate is tight.
export const MAX_LEVEL = 40;
export const MIN_TESTS = 5;
export const MAX_TESTS = 9;

export const EXPERIENCE = [
  { id: 'new', label: 'Never played', detail: 'I am brand new to the piano', mean: 0.5, sd: 2 },
  { id: 'little', label: 'A little', detail: 'I know where middle C is and a few tunes', mean: 4, sd: 3.5 },
  { id: 'some', label: 'Some experience', detail: 'I can play simple pieces with both hands', mean: 12, sd: 6 },
  { id: 'lots', label: 'Years of lessons', detail: 'I read music and play real repertoire', mean: 25, sd: 9 },
];

const GRID = Array.from({ length: MAX_LEVEL + 1 }, (_, i) => i);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Expected score for a student of skill s on a test at level L. s = L means "comfortable"
// (~82%); a few levels above your skill the score falls towards chance.
export function expectedScore(s, L) {
  return 10 + 88 * sigmoid((s - L + 2.08) / 1.39);
}

const SCORE_SD = 14;
function likelihood(score, s, L) {
  const e = expectedScore(s, L);
  const z = (score - e) / SCORE_SD;
  return Math.exp(-0.5 * z * z) + 1e-4;
}

function normalize(p) {
  const t = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / t);
}

export function prior(experienceId = 'little') {
  const e = EXPERIENCE.find((x) => x.id === experienceId) || EXPERIENCE[1];
  return normalize(GRID.map((s) => Math.exp(-0.5 * ((s - e.mean) / e.sd) ** 2) + 0.01));
}

export function update(post, level, score) {
  return normalize(post.map((p, s) => p * likelihood(score, s, level)));
}

export function quantile(post, q) {
  let c = 0;
  for (let s = 0; s < post.length; s++) {
    c += post[s];
    if (c >= q) return s;
  }
  return post.length - 1;
}

export function estimate(post) {
  return { level: Math.max(1, quantile(post, 0.5)), low: Math.max(1, quantile(post, 0.1)), high: Math.max(1, quantile(post, 0.9)) };
}

// Pick the next test level. `tests` = [{level, score}] so far.
export function nextLevel(post, tests) {
  let L = Math.round(quantile(post, 0.5));
  L = Math.max(1, Math.min(MAX_LEVEL, L));
  const last = tests[tests.length - 1];
  if (last) {
    if (last.score >= 92) L = Math.max(L, Math.min(MAX_LEVEL, last.level + 2)); // aced it: jump
    else if (last.score >= 80) L = Math.max(L, Math.min(MAX_LEVEL, last.level + 1)); // did well: harder
    else if (last.score < 55) L = Math.min(L, Math.max(1, last.level - 1)); // struggled: easier
    // Don't give the same level three times in a row; probe the side the estimate leans to.
    const prev = tests[tests.length - 2];
    if (prev && prev.level === last.level && L === last.level) {
      const mean = post.reduce((a, p, s) => a + p * s, 0);
      L = Math.max(1, Math.min(MAX_LEVEL, L + (mean >= L ? 1 : -1)));
    }
  }
  return L;
}

export function shouldStop(post, tests) {
  const n = tests.length;
  if (n >= MAX_TESTS) return true;
  // A complete beginner: no need to keep failing tests.
  if (n >= 3 && tests.every((t) => t.level <= 2 && t.score < 60) && post[0] + post[1] > 0.9) return true;
  if (n < MIN_TESTS) return false;
  return quantile(post, 0.9) - quantile(post, 0.1) <= 4;
}

export function estimatedTotal(post, tests) {
  const n = tests.length;
  const width = quantile(post, 0.9) - quantile(post, 0.1);
  const more = width > 10 ? 4 : width > 6 ? 3 : width > 4 ? 2 : 1;
  return Math.max(MIN_TESTS, Math.min(MAX_TESTS, n + more));
}

// Where the student starts: slightly conservative so the first lessons feel achievable.
export function finalLevel(post) {
  return Math.max(1, Math.min(MAX_LEVEL, quantile(post, 0.35)));
}
