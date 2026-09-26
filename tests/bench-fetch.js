// Downloads and prepares the held-out pianos for the listening benchmark (tests/bench-listen.js)
// into tests/.cache/ (git-ignored; nothing here is ever committed).
//
//   node tests/bench-fetch.js
//
//  - Upright Piano KW (Kawai upright in a living room, FreePats, CC0): SFZ + 24-bit FLAC, two
//    velocity layers, one sample every minor third. The .7z is unpacked with py7zr
//    (`pip install py7zr`); the FLACs are decoded in headless Chromium (Playwright) the way
//    tests/corpus-fetch.js decodes MP3s, resampled to 48 kHz mono float32.
//  - YDP Grand Piano (Yamaha Disklavier Pro, FreePats, CC BY 3.0): a SoundFont 2 file, parsed
//    here directly (RIFF sdta/smpl for the 16-bit samples, pdta for the key and velocity
//    ranges of its five velocity layers).
//  - The Salamander grand (the in-sample piano) and the speech/radio recordings come from
//    tests/corpus-fetch.js, which is run first if its cache is missing.
//
// Output: tests/.cache/bench/{upright,ydp}/*.f32 plus tests/.cache/bench/manifest.json:
//   { instruments: { <name>: { license, url, regions: [{ lokey, hikey, lovel, hivel, key, tune,
//     cutoff, file, sr, length }] } } }
// Samples are capped at MAX_SEC seconds (no benchmark note rings longer).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(here, '.cache');
export const BENCH = path.join(CACHE, 'bench');
const RAW = path.join(CACHE, 'raw');
const MAX_SEC = 8;
const SR = 48000;

const FP = 'https://freepats.zenvoid.org/Piano';
const UPRIGHT = {
  url: `${FP}/UprightPianoKW/UprightPianoKW-SFZ+FLAC-20220221.7z`,
  file: 'UprightPianoKW-SFZ+FLAC-20220221.7z',
  license: 'Upright Piano KW (FreePats), CC0 1.0',
};
const YDP = {
  url: `${FP}/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2`,
  file: 'YDP-GrandPiano-SF2-20160804.tar.bz2',
  license: 'YDP Grand Piano (FreePats, from Zenph Studios / OLPC samples), CC BY 3.0',
};

function download(src) {
  const file = path.join(RAW, src.file);
  if (fs.existsSync(file) && fs.statSync(file).size > 1e6) return file;
  console.log(`downloading ${src.url}`);
  execFileSync('curl', ['-sSLf', '--retry', '3', '-o', file, src.url], { stdio: 'inherit' });
  return file;
}

function findFile(dir, re) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, re);
      if (f) return f;
    } else if (re.test(e.name)) return p;
  }
  return null;
}

// ---- Upright KW: SFZ + FLAC --------------------------------------------------------------------
function extractUpright(archive) {
  const dir = path.join(CACHE, 'upright');
  let sfz = findFile(dir, /\.sfz$/);
  if (sfz) return sfz;
  fs.mkdirSync(dir, { recursive: true });
  const py = `import py7zr, sys\nwith py7zr.SevenZipFile(sys.argv[1], 'r') as z: z.extractall(sys.argv[2])`;
  let r = spawnSync('python3', ['-c', py, archive, dir], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log('py7zr missing: pip install py7zr');
    spawnSync('pip', ['install', '-q', 'py7zr'], { stdio: 'inherit' });
    r = spawnSync('python3', ['-c', py, archive, dir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('could not unpack the .7z (pip install py7zr)');
  }
  sfz = findFile(dir, /\.sfz$/);
  if (!sfz) throw new Error('no .sfz in the upright archive');
  return sfz;
}

// Minimal SFZ reader: <global>/<group>/<region> headers with opcodes; later levels override.
export function parseSfz(text) {
  const regions = [];
  let global = {},
    group = {},
    cur = null,
    level = null;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim());
  for (const line of lines) {
    if (!line) continue;
    for (const tok of line.split(/\s+(?=<|\w+=)/)) {
      const h = tok.match(/^<(\w+)>$/);
      if (h) {
        level = h[1];
        if (level === 'global') global = {};
        else if (level === 'group') group = {};
        else if (level === 'region') {
          cur = {};
          regions.push({ g: global, gr: group, r: cur });
        }
        continue;
      }
      const kv = tok.match(/^(\w+)=(.*)$/);
      if (!kv) continue;
      const target = level === 'global' ? global : level === 'group' ? group : cur;
      if (target) target[kv[1]] = kv[2].trim();
    }
  }
  const noteNum = (v) => {
    if (v == null) return null;
    if (/^-?\d+$/.test(v)) return Number(v);
    const m = v.match(/^([a-gA-G])(#|b)?(-?\d)$/);
    if (!m) return null;
    const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return (Number(m[3]) + 1) * 12 + pc;
  };
  return regions.map(({ g, gr, r }) => {
    const o = { ...g, ...gr, ...r };
    const key = noteNum(o.key);
    return {
      sample: o.sample.replace(/\\/g, '/'),
      lokey: key ?? noteNum(o.lokey) ?? 0,
      hikey: key ?? noteNum(o.hikey) ?? 127,
      key: key ?? noteNum(o.pitch_keycenter) ?? 60,
      lovel: Number(o.lovel ?? 0),
      hivel: Number(o.hivel ?? 127),
      tune: Number(o.tune ?? 0),
      cutoff: o.fil_type && o.cutoff ? Number(o.cutoff) : 0,
      volume: Number(o.volume ?? 0),
    };
  });
}

async function decodeFlacs(files, outDir) {
  const require = createRequire(import.meta.url);
  let pw;
  try {
    pw = require('playwright');
  } catch {
    pw = require('/opt/node22/lib/node_modules/playwright');
  }
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const out = {};
  for (const { name, file } of files) {
    const dest = path.join(outDir, name + '.f32');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      out[name] = { file: path.relative(BENCH, dest), sr: SR, length: fs.statSync(dest).size / 4 };
      continue;
    }
    const b64 = fs.readFileSync(file).toString('base64');
    const res = await page.evaluate(
      async ({ b64, sr, maxSec }) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const ctx = new OfflineAudioContext(1, sr, sr);
        const buf = await ctx.decodeAudioData(u.buffer);
        const n = Math.min(buf.length, Math.round(maxSec * sr));
        const mono = new Float32Array(n);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
        }
        const bytes = new Uint8Array(mono.buffer);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { b64: btoa(s), length: n };
      },
      { b64, sr: SR, maxSec: MAX_SEC },
    );
    fs.writeFileSync(dest, Buffer.from(res.b64, 'base64'));
    out[name] = { file: path.relative(BENCH, dest), sr: SR, length: res.length };
    process.stdout.write('.');
  }
  await browser.close();
  process.stdout.write('\n');
  return out;
}

async function prepareUpright() {
  const archive = download(UPRIGHT);
  const sfzFile = extractUpright(archive);
  const regions = parseSfz(fs.readFileSync(sfzFile, 'utf8'));
  const outDir = path.join(BENCH, 'upright');
  fs.mkdirSync(outDir, { recursive: true });
  const names = [...new Set(regions.map((r) => r.sample))];
  const files = names.map((s) => ({ name: path.basename(s, path.extname(s)).replace(/#/g, 's'), file: path.join(path.dirname(sfzFile), s) }));
  const dec = await decodeFlacs(files, outDir);
  return {
    license: UPRIGHT.license,
    url: UPRIGHT.url,
    regions: regions.map((r) => {
      const d = dec[path.basename(r.sample, path.extname(r.sample)).replace(/#/g, 's')];
      return { lokey: r.lokey, hikey: r.hikey, lovel: r.lovel, hivel: r.hivel, key: r.key, tune: r.tune, cutoff: r.cutoff, volume: r.volume, file: d.file, sr: d.sr, length: d.length };
    }),
  };
}

// ---- YDP: SoundFont 2 -------------------------------------------------------------------------
function extractYdp(archive) {
  const dir = path.join(CACHE, 'ydp');
  let sf2 = findFile(dir, /\.sf2$/i);
  if (sf2) return sf2;
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['xjf', archive, '-C', dir], { stdio: 'inherit' });
  sf2 = findFile(dir, /\.sf2$/i);
  if (!sf2) throw new Error('no .sf2 in the YDP archive');
  return sf2;
}

// SoundFont 2: RIFF 'sfbk' { LIST INFO, LIST sdta { smpl }, LIST pdta { phdr pbag pmod pgen inst
// ibag imod igen shdr } }. Returns the zones of the first preset, resolved through its
// instruments: { lokey, hikey, lovel, hivel, key, tune (cents), sample: shdr entry }.
export function parseSf2(b) {
  const chunks = (off, end) => {
    const out = [];
    while (off + 8 <= end) {
      const id = b.toString('ascii', off, off + 4);
      const sz = b.readUInt32LE(off + 4);
      out.push({ id, off: off + 8, sz, list: id === 'LIST' ? b.toString('ascii', off + 8, off + 12) : null });
      off += 8 + sz + (sz & 1);
    }
    return out;
  };
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'sfbk') throw new Error('not a SoundFont 2 file');
  const top = chunks(12, b.length);
  const sdta = top.find((c) => c.list === 'sdta');
  const pdta = top.find((c) => c.list === 'pdta');
  const smpl = chunks(sdta.off + 4, sdta.off + sdta.sz).find((c) => c.id === 'smpl');
  const sub = chunks(pdta.off + 4, pdta.off + pdta.sz);
  const get = (id) => sub.find((c) => c.id === id);
  const shdr = get('shdr');
  const samples = [];
  for (let i = 0; i < shdr.sz / 46 - 1; i++) {
    const o = shdr.off + i * 46;
    samples.push({
      name: b.toString('ascii', o, o + 20).replace(/\0.*$/, ''),
      start: b.readUInt32LE(o + 20),
      end: b.readUInt32LE(o + 24),
      sr: b.readUInt32LE(o + 36),
      pitch: b.readUInt8(o + 40),
      corr: b.readInt8(o + 41),
    });
  }
  const readGens = (bagC, genC) => {
    const bags = [];
    for (let i = 0; i < bagC.sz / 4; i++) bags.push(b.readUInt16LE(bagC.off + i * 4));
    const gens = [];
    for (let i = 0; i < genC.sz / 4; i++) {
      const o = genC.off + i * 4;
      gens.push({ op: b.readUInt16LE(o), lo: b.readUInt8(o + 2), hi: b.readUInt8(o + 3), s: b.readInt16LE(o + 2) });
    }
    return (z) => {
      const g = {};
      for (let k = bags[z]; k < bags[z + 1]; k++) {
        const x = gens[k];
        g[x.op] = x.op === 43 || x.op === 44 ? [x.lo, x.hi] : x.s;
      }
      return g;
    };
  };
  const headers = (c, size) => {
    const out = [];
    for (let i = 0; i < c.sz / size; i++) {
      const o = c.off + i * size;
      out.push({ name: b.toString('ascii', o, o + 20).replace(/\0.*$/, ''), bag: b.readUInt16LE(o + (size === 38 ? 24 : 20)) });
    }
    return out;
  };
  const presets = headers(get('phdr'), 38);
  const insts = headers(get('inst'), 22);
  const pz = readGens(get('pbag'), get('pgen'));
  const iz = readGens(get('ibag'), get('igen'));
  const zones = [];
  for (let z = presets[0].bag; z < presets[1].bag; z++) {
    const pg = pz(z);
    if (pg[41] == null) continue; // global preset zone
    const inst = pg[41];
    const vr = pg[44] || [0, 127];
    const kr = pg[43] || [0, 127];
    let glob = {};
    for (let y = insts[inst].bag; y < insts[inst + 1].bag; y++) {
      const g = iz(y);
      if (g[53] == null) {
        glob = g;
        continue;
      }
      const G = { ...glob, ...g };
      const s = samples[G[53]];
      const k = G[43] || [0, 127];
      const v = G[44] || [0, 127];
      zones.push({
        lokey: Math.max(k[0], kr[0]),
        hikey: Math.min(k[1], kr[1]),
        lovel: Math.max(v[0], vr[0]),
        hivel: Math.min(v[1], vr[1]),
        key: G[58] != null && G[58] >= 0 ? G[58] : s.pitch,
        tune: (G[51] || 0) * 100 + (G[52] || 0) + s.corr,
        attenuation: ((G[48] || 0) + (pg[48] || 0)) / 10, // dB
        sample: s,
      });
    }
  }
  return { zones, smplOff: smpl.off };
}

function prepareYdp() {
  const archive = download(YDP);
  const sf2File = extractYdp(archive);
  const b = fs.readFileSync(sf2File);
  const { zones, smplOff } = parseSf2(b);
  const outDir = path.join(BENCH, 'ydp');
  fs.mkdirSync(outDir, { recursive: true });
  const written = new Map();
  const regions = [];
  for (const z of zones) {
    const s = z.sample;
    if (!written.has(s.name)) {
      const n = Math.min(s.end - s.start, Math.round(MAX_SEC * s.sr));
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = b.readInt16LE(smplOff + (s.start + i) * 2) / 32768;
      const dest = path.join(outDir, s.name + '.f32');
      fs.writeFileSync(dest, Buffer.from(f.buffer));
      written.set(s.name, { file: path.relative(BENCH, dest), sr: s.sr, length: n });
    }
    const d = written.get(s.name);
    regions.push({ lokey: z.lokey, hikey: z.hikey, lovel: z.lovel, hivel: z.hivel, key: z.key, tune: z.tune, cutoff: 0, volume: -z.attenuation, file: d.file, sr: d.sr, length: d.length });
  }
  return { license: YDP.license, url: YDP.url, regions };
}

export function benchManifest() {
  const f = path.join(BENCH, 'manifest.json');
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(BENCH, { recursive: true });
  if (!fs.existsSync(path.join(CACHE, 'manifest.json'))) {
    console.log('fetching the Salamander / speech / radio corpus first (tests/corpus-fetch.js)');
    spawnSync(process.execPath, [path.join(here, 'corpus-fetch.js')], { stdio: 'inherit' });
  }
  const instruments = {};
  try {
    instruments.upright = await prepareUpright();
    console.log(`upright: ${instruments.upright.regions.length} regions`);
  } catch (e) {
    console.warn(`! upright piano: ${e.message}`);
  }
  try {
    instruments.ydp = prepareYdp();
    console.log(`ydp: ${instruments.ydp.regions.length} regions`);
  } catch (e) {
    console.warn(`! YDP grand: ${e.message}`);
  }
  fs.writeFileSync(path.join(BENCH, 'manifest.json'), JSON.stringify({ instruments }, null, 1));
  console.log(`benchmark pianos ready in ${BENCH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
