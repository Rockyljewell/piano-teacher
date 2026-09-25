// Downloads and decodes the real-audio evaluation corpus into tests/.cache/ (git-ignored).
//
//   node tests/corpus-fetch.js
//
// What it fetches (everything is free to use; nothing is committed to the repo):
//  - Salamander Grand Piano v3 samples (Yamaha C5), by Alexander Holm, CC-BY 3.0,
//    as hosted by the Tone.js project: https://tonejs.github.io/audio/salamander/
//    One sample every minor third from A0 to C8 (30 files).
//  - Speech: three LibriVox readings (public domain, https://librivox.org), 100 s excerpts.
//  - Radio music with vocals: two US 78 rpm recordings from 1920/21 (public domain in the US),
//    digitised by the Great 78 Project / Internet Archive.
//
// Decoding uses headless Chromium (Playwright) so MP3s are decoded exactly as Safari/Chrome
// would, resampled to 48 kHz mono float32 and stored as raw little-endian .f32 files plus a
// manifest.json. Tests that need the corpus skip themselves when it is missing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(here, '.cache');
const RAW = path.join(CACHE, 'raw');
const PCM = path.join(CACHE, 'pcm');
const SR = 48000;

const NOTE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
export const SALAMANDER_MIDIS = [];
for (let m = 21; m <= 108; m += 3) SALAMANDER_MIDIS.push(m);
const salName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

const IA = 'https://archive.org/download';
export const SOURCES = [
  ...SALAMANDER_MIDIS.map((m) => ({
    key: `piano-${m}`,
    kind: 'piano',
    midi: m,
    url: `https://tonejs.github.io/audio/salamander/${salName(m)}.mp3`,
    maxSec: 10,
    license: 'Salamander Grand Piano v3, Alexander Holm, CC-BY 3.0',
  })),
  {
    key: 'speech-1',
    kind: 'speech',
    url: `${IA}/20shortsfstories_1908_librivox/20shortsfstories_02_various_64kb.mp3`,
    range: '200000-1000000',
    maxSec: 100,
    license: 'LibriVox recording, public domain',
  },
  {
    key: 'speech-2',
    kind: 'speech',
    url: `${IA}/20shortsfstories_1908_librivox/20shortsfstories_03_various_64kb.mp3`,
    range: '200000-1000000',
    maxSec: 100,
    license: 'LibriVox recording, public domain',
  },
  {
    key: 'speech-3',
    kind: 'speech',
    url: `${IA}/20shortsfstories_1908_librivox/20shortsfstories_07_various_64kb.mp3`,
    range: '200000-1000000',
    maxSec: 100,
    license: 'LibriVox recording, public domain',
  },
  {
    key: 'radio-1',
    kind: 'radio',
    url: `${IA}/78_o-oh_billy-murray-gay-johnson_gbia0083371b/O%20%28Oh%21%29%20-%20Billy%20Murray%20-%20Gay%20-%20Johnson.mp3`,
    range: '300000-2300000',
    maxSec: 100,
    license: '"O (Oh!)", Billy Murray, 1920 - public domain in the US (Great 78 Project)',
  },
  {
    key: 'radio-2',
    kind: 'radio',
    url: `${IA}/78_its-all-over-now_aileen-stanley-al-von-tilzer_gbia0072365b/It%27s%20All%20Over%20Now%20-%20Aileen%20Stanley%20-%20Al.%20Von%20Tilzer.mp3`,
    range: '300000-2300000',
    maxSec: 100,
    license: '"It\'s All Over Now", Aileen Stanley, 1920 - public domain in the US (Great 78 Project)',
  },
];

function download(src) {
  const ext = path.extname(new URL(src.url).pathname) || '.mp3';
  const file = path.join(RAW, src.key + ext);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  const args = ['-sSLf', '--retry', '3', '-o', file];
  if (src.range) args.push('-r', src.range);
  args.push(src.url);
  execFileSync('curl', args, { stdio: 'inherit' });
  return file;
}

async function decodeAll(items) {
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
  for (const { src, file } of items) {
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
        // Return as base64 of the float32 bytes.
        const bytes = new Uint8Array(mono.buffer);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { b64: btoa(s), length: n, channels: buf.numberOfChannels, srcRate: buf.sampleRate };
      },
      { b64, sr: SR, maxSec: src.maxSec },
    );
    const pcm = Buffer.from(res.b64, 'base64');
    const f = path.join(PCM, src.key + '.f32');
    fs.writeFileSync(f, pcm);
    out[src.key] = { file: path.basename(f), sr: SR, length: res.length, kind: src.kind, midi: src.midi, url: src.url, license: src.license };
    process.stdout.write('.');
  }
  await browser.close();
  process.stdout.write('\n');
  return out;
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(PCM, { recursive: true });
  const items = [];
  for (const src of SOURCES) {
    try {
      items.push({ src, file: download(src) });
    } catch (e) {
      console.warn(`! could not download ${src.key}: ${e.message}`);
    }
  }
  console.log(`downloaded ${items.length}/${SOURCES.length}; decoding...`);
  const manifest = await decodeAll(items);
  fs.writeFileSync(path.join(CACHE, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`corpus ready in ${CACHE} (${Object.keys(manifest).length} files)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
