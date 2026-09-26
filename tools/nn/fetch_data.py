"""Download the training sources for the listening model into tools/nn/.data/ (git-ignored).

    python tools/nn/fetch_data.py            # everything (~2.2 GB download, ~1.4 GB kept)
    python tools/nn/fetch_data.py --only iowa,gu

Only sources whose licence lets us ship weights trained on them (see docs/listening-model.md):

  instruments (piano presets / samples)
    salamander  Salamander Grand Piano V3 (Yamaha C5), Alexander Holm, CC BY 3.0 - FreePats SF2
    musescore   MuseScore_General.sf2, "Grand Piano" = AKAI "Splendid Grand" (Steinway D,
                public domain samples), soundfont MIT
    fluid       FluidR3_GM.sf2 (Frank Wen), MIT - Debian's pristine upstream tarball
    gu          GeneralUser GS v2 (S. Christian Collins), GeneralUser GS License v2.0 (use
                without restriction, including in software)
    iowa        University of Iowa Electronic Music Studios, Musical Instrument Samples:
                Steinway B piano, pp/mf/ff, every key ("may be downloaded and used for any
                projects, without restrictions")
  background noise for augmentation (never the recordings the benchmark uses)
    speech      LibriVox "20 Short Science Fiction Stories" chapters 1,4,5,6,8,9 (public
                domain); the benchmark / noise-eval use chapters 2,3,7
    radio       five other 1920/21 78 rpm records from the Great 78 Project (public domain in
                the US); the benchmark uses "O (Oh!)" and "It's All Over Now"

Held-out pianos (Upright Piano KW, YDP Grand) are never downloaded or read here.

Output: .data/inst/<name>/bank.npz  (all samples, 16 kHz mono float32, one array + offsets)
        .data/inst/<name>/regions.json
        .data/noise/<kind>-<i>.f32  (16 kHz mono float32)
"""
import argparse
import io
import json
import os
import struct
import subprocess
import sys
import tarfile

import numpy as np
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '.data')
RAW = os.path.join(DATA, 'raw')
INST = os.path.join(DATA, 'inst')
NOISE = os.path.join(DATA, 'noise')
SR = 16000
MAX_SEC = 9.0  # longest sample kept (no training note rings longer)

FP = 'https://freepats.zenvoid.org/Piano'
SOURCES = {
    'salamander': dict(url=f'{FP}/SalamanderGrandPiano/SalamanderGrandPiano-SF2-V3+20200602.tar.xz',
                       license='Salamander Grand Piano V3, Alexander Holm, CC BY 3.0',
                       page='https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html'),
    'musescore': dict(url='https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2',
                      license='MuseScore_General.sf2 v0.2, MIT (Grand Piano: AKAI "Splendid Grand", public domain samples)',
                      page='https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md'),
    'fluid': dict(url='https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont_3.1.orig.tar.gz',
                  license='FluidR3_GM.sf2, Frank Wen, MIT',
                  page='https://deb.debian.org/debian/pool/main/f/fluid-soundfont/'),
    'gu': dict(url='https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',
               license='GeneralUser GS v2, S. Christian Collins, GeneralUser GS License v2.0',
               page='https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt'),
    'iowa': dict(url='https://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/piano/',
                 license='University of Iowa Electronic Music Studios MIS piano (Steinway B), free to use without restriction',
                 page='https://theremin.music.uiowa.edu/MISpiano.html'),
}
IA = 'https://archive.org/download'
SPEECH = [f'{IA}/20shortsfstories_1908_librivox/20shortsfstories_{c:02d}_various_64kb.mp3' for c in (1, 4, 5, 6, 8, 9)]
RADIO = [
    f'{IA}/78_sunnyside-sal_arthur-fields-kendis-brockman_gbia0315372b/SUNNYSIDE%20SAL%20-%20ARTHUR%20FIELDS%20-%20KENDIS%20%26%20BROCKMAN.mp3',
    f'{IA}/78_learn-to-smile_john-mccormack-otto-harbach-louis-a-hirsch_gbia0055060a/Learn%20to%20Smile%20-%20John%20McCormack%20-%20Otto%20Harbach.mp3',
    f'{IA}/78_sleepy-head_orlandos-orchestra-brown-hill-levine_gbia0083216a/Sleepy%20Head%20-%20Orlando%27s%20Orchestra%20-%20Brown.mp3',
    f'{IA}/78_swanee-river-moon_charles-hart-elliot-shaw-pitman-clarke_gbia0046433b/Swanee%20River%20Moon%20-%20Charles%20Hart%20-%20Elliot%20Shaw.mp3',
    f'{IA}/78_playthings_percy-st-albyn_gbia3014393b/PLAYTHINGS%20-%20Percy%20St.%20Albyn.mp3',
]
IOWA_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']


def curl(url, dest, rng=None):
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.part'
    cmd = ['curl', '-sSLf', '--retry', '4', '--retry-delay', '3', '-o', tmp, url]
    if rng:
        cmd[1:1] = ['-r', rng]
    print('  get', url, flush=True)
    subprocess.run(cmd, check=True)
    os.replace(tmp, dest)
    return dest


def to16k(x, sr):
    x = np.asarray(x, dtype=np.float64)
    if sr == SR:
        return x.astype(np.float32)
    from math import gcd
    g = gcd(int(sr), SR)
    return resample_poly(x, SR // g, int(sr) // g).astype(np.float32)


def trim_attack(x, pre=0.001):
    """Trim leading silence: the attack sits at t = pre (like tests/bench-sampler.js)."""
    pk = np.max(np.abs(x)) + 1e-12
    idx = np.nonzero(np.abs(x) > 0.03 * pk)[0]
    first = int(idx[0]) if len(idx) else 0
    return x[max(0, first - int(pre * SR)):]


# ---------------------------------------------------------------------------------------------
# SoundFont 2
def parse_sf2(b):
    """Zones of preset bank 0 / program 0 (the grand piano), resolved through its instruments."""
    def chunks(off, end):
        out = []
        while off + 8 <= end:
            cid = b[off:off + 4].decode('latin1')
            sz = struct.unpack_from('<I', b, off + 4)[0]
            lst = b[off + 8:off + 12].decode('latin1') if cid == 'LIST' else None
            out.append((cid, off + 8, sz, lst))
            off += 8 + sz + (sz & 1)
        return out
    assert b[0:4] == b'RIFF' and b[8:12] == b'sfbk', 'not a SoundFont 2'
    top = chunks(12, len(b))
    sdta = next(c for c in top if c[3] == 'sdta')
    pdta = next(c for c in top if c[3] == 'pdta')
    smpl = next(c for c in chunks(sdta[1] + 4, sdta[1] + sdta[2]) if c[0] == 'smpl')
    sub = {c[0]: c for c in chunks(pdta[1] + 4, pdta[1] + pdta[2])}

    def recs(cid, size):
        _, off, sz, _ = sub[cid]
        return [b[off + i * size: off + (i + 1) * size] for i in range(sz // size)]
    shdr = []
    for r in recs('shdr', 46)[:-1]:
        name = r[:20].split(b'\0')[0].decode('latin1')
        start, end, sl, el, sr = struct.unpack_from('<5I', r, 20)
        pitch, corr = struct.unpack_from('<Bb', r, 40)
        link, stype = struct.unpack_from('<HH', r, 42)
        shdr.append(dict(name=name, start=start, end=end, sl=sl, el=el, sr=sr, pitch=pitch, corr=corr, type=stype))

    def gens(bag_id, gen_id):
        bags = [struct.unpack_from('<H', r, 0)[0] for r in recs(bag_id, 4)]
        gl = []
        for r in recs(gen_id, 4):
            op = struct.unpack_from('<H', r, 0)[0]
            if op in (43, 44):
                val = (r[2], r[3])
            else:
                val = struct.unpack_from('<h', r, 2)[0]
            gl.append((op, val))
        def zone(z):
            return {op: v for op, v in gl[bags[z]:bags[z + 1]]}
        return zone
    phdr = []
    for r in recs('phdr', 38):
        name = r[:20].split(b'\0')[0].decode('latin1')
        preset, bank, bag = struct.unpack_from('<HHH', r, 20)
        phdr.append(dict(name=name, preset=preset, bank=bank, bag=bag))
    inst = []
    for r in recs('inst', 22):
        inst.append(dict(name=r[:20].split(b'\0')[0].decode('latin1'), bag=struct.unpack_from('<H', r, 20)[0]))
    pz = gens('pbag', 'pgen')
    iz = gens('ibag', 'igen')
    pi = next(i for i, p in enumerate(phdr[:-1]) if p['bank'] == 0 and p['preset'] == 0)
    pname = phdr[pi]['name']
    zones = []
    pglob = {}
    for z in range(phdr[pi]['bag'], phdr[pi + 1]['bag']):
        pg = pz(z)
        if 41 not in pg:
            pglob = pg
            continue
        pg = {**pglob, **pg}
        ii = pg[41]
        kr = pg.get(43, (0, 127))
        vr = pg.get(44, (0, 127))
        iglob = {}
        for y in range(inst[ii]['bag'], inst[ii + 1]['bag']):
            g = iz(y)
            if 53 not in g:
                iglob = g
                continue
            G = {**iglob, **g}
            s = shdr[G[53]]
            k = G.get(43, (0, 127))
            v = G.get(44, (0, 127))
            lo, hi = max(k[0], kr[0]), min(k[1], kr[1])
            vlo, vhi = max(v[0], vr[0]), min(v[1], vr[1])
            if lo > hi or vlo > vhi:
                continue
            add = lambda op, d=0: G.get(op, d) + (pg.get(op, 0) if op not in (43, 44, 53, 54, 58) else 0)
            zones.append(dict(
                lokey=lo, hikey=hi, lovel=vlo, hivel=vhi,
                key=G[58] if G.get(58, -1) >= 0 else s['pitch'],
                tune=add(51) * 100 + add(52) + s['corr'],  # cents
                atten=add(48) / 10.0 * 0.4,  # dB (the 0.4 factor is the common SF2 EMU convention)
                mode=G.get(54, 0) & 3,
                start=s['start'] + add(0) + 32768 * add(4),
                end=s['end'] + add(1) + 32768 * add(12),
                sl=s['sl'] + add(2) + 32768 * add(45),
                el=s['el'] + add(3) + 32768 * add(50),
                sr=s['sr'], stype=s['type'], sname=s['name'],
                fc=add(8, 13500), q=add(9),
                delay=add(33, -12000), attack=add(34, -12000), hold=add(35, -12000),
                decay=add(36, -12000), sustain=add(37), release=add(38, -12000),
                k2hold=add(39), k2decay=add(40),
            ))
    return pname, zones, smpl[1]


def build_sf2_bank(name, sf2_path):
    b = open(sf2_path, 'rb').read()
    pname, zones, smpl_off = parse_sf2(b)
    print(f'  {name}: preset "{pname}", {len(zones)} zones', flush=True)
    # stereo pairs: keep the left (or mono) sample of each key/vel range only
    seen = set()
    keep = []
    for z in zones:
        k = (z['lokey'], z['hikey'], z['lovel'], z['hivel'])
        if z['stype'] & 4 and any((zz['lokey'], zz['hikey'], zz['lovel'], zz['hivel']) == k and zz['stype'] & 2 for zz in zones):
            continue  # right channel of a stereo pair whose left we keep
        if k in seen:
            continue
        seen.add(k)
        keep.append(z)
    datas, regions, cache = [], [], {}
    off = 0
    for z in keep:
        key = (z['start'], z['end'], z['sr'])
        if key not in cache:
            n = z['end'] - z['start']
            raw = np.frombuffer(b, dtype='<i2', count=n, offset=smpl_off + 2 * z['start']).astype(np.float32) / 32768.0
            looped = z['mode'] in (1, 3) and z['el'] > z['sl'] + 8
            y = to16k(raw, z['sr'])
            ratio = SR / z['sr']
            # the attack trim shifts the loop points too
            pk = np.max(np.abs(y)) + 1e-12
            idx = np.nonzero(np.abs(y) > 0.03 * pk)[0]
            first = max(0, int(idx[0]) - int(0.001 * SR)) if len(idx) else 0
            y = y[first:]
            sl = (z['sl'] - z['start']) * ratio - first
            el = (z['el'] - z['start']) * ratio - first
            if len(y) - 3 < el < len(y) + 8:
                el = len(y) - 3.0  # loop end at the sample end (resampling rounds it off)
            if not looped or sl < 0 or el > len(y) - 2 or el - sl < 16:
                looped = False
                y = y[:int(MAX_SEC * SR)]
                sl = el = 0.0
            cache[key] = (off, len(y), looped, sl, el)
            datas.append(y)
            off += len(y)
        o, n, looped, sl, el = cache[key]
        regions.append(dict(lokey=z['lokey'], hikey=z['hikey'], lovel=z['lovel'], hivel=z['hivel'], key=z['key'], tune=z['tune'],
                            atten=z['atten'], off=o, n=n, loop=bool(looped), sl=sl, el=el, fc=z['fc'], q=z['q'],
                            attack=z['attack'], hold=z['hold'], decay=z['decay'], sustain=z['sustain'], release=z['release'],
                            k2hold=z['k2hold'], k2decay=z['k2decay'], name=z['sname']))
    save_bank(name, np.concatenate(datas), regions, pname)


def save_bank(name, data, regions, desc):
    d = os.path.join(INST, name)
    os.makedirs(d, exist_ok=True)
    np.savez(os.path.join(d, 'bank.npz'), data=data.astype(np.float32))
    meta = dict(name=name, desc=desc, license=SOURCES[name]['license'], url=SOURCES[name]['url'], page=SOURCES[name]['page'], sr=SR, regions=regions)
    json.dump(meta, open(os.path.join(d, 'regions.json'), 'w'), indent=0)
    print(f'  {name}: {len(regions)} regions, {len(data) / SR / 60:.1f} min of samples', flush=True)


def fetch_salamander():
    arc = curl(SOURCES['salamander']['url'], os.path.join(RAW, 'salamander-sf2.tar.xz'))
    sf2 = os.path.join(RAW, 'salamander.sf2')
    if not os.path.exists(sf2):
        with tarfile.open(arc) as t:
            m = next(m for m in t.getmembers() if m.name.lower().endswith('.sf2'))
            with t.extractfile(m) as f, open(sf2, 'wb') as g:
                g.write(f.read())
    build_sf2_bank('salamander', sf2)


def fetch_musescore():
    sf2 = curl(SOURCES['musescore']['url'], os.path.join(RAW, 'MuseScore_General.sf2'))
    build_sf2_bank('musescore', sf2)


def fetch_fluid():
    arc = curl(SOURCES['fluid']['url'], os.path.join(RAW, 'fluid-soundfont_3.1.orig.tar.gz'))
    sf2 = os.path.join(RAW, 'FluidR3_GM.sf2')
    if not os.path.exists(sf2):
        with tarfile.open(arc) as t:
            m = next(m for m in t.getmembers() if m.name.endswith('FluidR3_GM.sf2'))
            with t.extractfile(m) as f, open(sf2, 'wb') as g:
                g.write(f.read())
    build_sf2_bank('fluid', sf2)


def fetch_gu():
    sf2 = curl(SOURCES['gu']['url'], os.path.join(RAW, 'GeneralUser-GS.sf2'))
    build_sf2_bank('gu', sf2)


def fetch_iowa():
    import soundfile as sf
    base = SOURCES['iowa']['url']
    datas, regions = [], []
    off = 0
    vel = {'pp': (0, 50), 'mf': (51, 94), 'ff': (95, 127)}
    for dyn in ('pp', 'mf', 'ff'):
        for midi in range(21, 109):
            nm = f'Piano.{dyn}.{IOWA_NOTES[midi % 12]}{midi // 12 - 1}.aiff'
            dest = os.path.join(RAW, 'iowa', nm)
            try:
                curl(base + nm, dest)
            except subprocess.CalledProcessError:
                continue  # a few keys are missing at some dynamics (e.g. pp A0)
            x, sr = sf.read(dest, dtype='float32', always_2d=True)
            y = to16k(x.mean(axis=1), sr)
            y = y - np.mean(y[: int(0.05 * SR)])  # DC
            y = trim_attack(y)[: int(MAX_SEC * SR)]
            datas.append(y)
            lo, hi = vel[dyn]
            regions.append(dict(lokey=midi, hikey=midi, lovel=lo, hivel=hi, key=midi, tune=0, atten=0.0, off=off, n=len(y), loop=False, sl=0, el=0,
                                fc=13500, q=0, attack=-12000, hold=-12000, decay=-12000, sustain=0, release=-12000, k2hold=0, k2decay=0, name=nm))
            off += len(y)
            os.remove(dest)  # keep only the 16 kHz bank
    save_bank('iowa', np.concatenate(datas), regions, 'Steinway B, pp/mf/ff, every key')


def fetch_noise():
    import soundfile as sf
    os.makedirs(NOISE, exist_ok=True)
    for kind, urls, rng in (('speech', SPEECH, '300000-3300000'), ('radio', RADIO, '200000-2600000')):
        for i, u in enumerate(urls):
            out = os.path.join(NOISE, f'{kind}-{i}.f32')
            if os.path.exists(out):
                continue
            mp3 = curl(u, os.path.join(RAW, f'{kind}-{i}.mp3'), rng)
            # a byte range of an MP3 starts mid-frame: skip to the first frame sync
            b = open(mp3, 'rb').read()
            k, x = -1, None
            for _ in range(200):
                k += 1
                while k < len(b) - 1 and not (b[k] == 0xFF and (b[k + 1] & 0xE0) == 0xE0):
                    k += 1
                try:
                    x, sr = sf.read(io.BytesIO(b[k:]), dtype='float32', always_2d=True)
                    break
                except Exception:
                    continue
            if x is None:
                raise RuntimeError(f'cannot decode {mp3}')
            y = to16k(x.mean(axis=1), sr)
            y.astype('<f4').tofile(out)
            print(f'  {kind}-{i}: {len(y) / SR:.0f} s', flush=True)


STEPS = dict(noise=fetch_noise, gu=fetch_gu, musescore=fetch_musescore, fluid=fetch_fluid, salamander=fetch_salamander, iowa=fetch_iowa)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    todo = a.only.split(',') if a.only else list(STEPS)
    for k in todo:
        if os.path.exists(os.path.join(INST, k, 'regions.json')):
            print(f'{k}: ready')
            continue
        print(f'{k}:', flush=True)
        try:
            STEPS[k]()
        except Exception as e:  # keep going: every source is optional
            print(f'! {k}: {e}', file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc()
