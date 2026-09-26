# Training the listening model

A small causal neural network that transcribes piano audio in real time. It runs in the browser
as `js/audio/nn/nn-transcriber.js` (a drop-in replacement for the DSP `js/audio/transcriber.js`);
this folder trains it. Design, data, licences and results: [docs/listening-model.md](../../docs/listening-model.md).

Everything large lives in `tools/nn/.data/` and `tools/nn/.venv/` (both git-ignored). No audio or
dataset is ever committed; only the weights (`assets/models/piano-nn.bin`, ~25 KB) and the parity
fixture (`tools/nn/fixtures/parity.json`) are.

## Reproduce

Commands run from the repository root. Times are for this 4-core machine limited to 2 threads,
while another job used the other cores.

```sh
# 0. Python environment (CPU torch, ~195 MB)                                          ~2 min
python3 -m venv tools/nn/.venv
tools/nn/.venv/bin/pip install -r tools/nn/requirements.txt
export OMP_NUM_THREADS=2

# 1. Instruments and background recordings (licences checked, see the doc)   ~2.2 GB, ~15 min
#    -> .data/inst/<name>/{bank.npz,regions.json} (16 kHz), .data/noise/*.f32
tools/nn/.venv/bin/python tools/nn/fetch_data.py

# 2. The app's own music (40 levels, warm-ups, rhythm drills, 76 song arrangements) and the
#    room-noise simulations of tests/noise-sim.js                                        ~20 s
node tools/nn/dump_content.mjs

# 3. Render the clips (piano content -> sampler -> room)                              ~50 min
cd tools/nn
PY=.venv/bin/python
$PY make_data.py --hours 1.5 --split val --seed 999 --workers 2        # 1.7 h validation
$PY make_data.py --hours 30 --split train --seed 1 --workers 2         # 30 h
$PY make_data.py --hours 8 --split train-b --seed 2 --workers 1 \
    --inst-weights synth=0.35,iowa=0.2,salamander=0.15,musescore=0.1,fluid=0.1,gu=0.1
$PY make_data.py --hours 6 --split train-c --seed 3 --workers 1 \
    --content-weights bass=0.45,extremes=0.2,chords=0.15,app=0.1,soup=0.1

# 4. Train (noise, microphone EQ, level and clipping are mixed in on the fly).       ~6.5 h
#    The shipped model grew in stages (each a warm start: new weights start at zero, so a stage
#    begins exactly where the last one ended). Each run below was stopped at the checkpoint
#    named, i.e. part-way through its one-cycle learning-rate schedule; the schedule length
#    (--steps) is part of the recipe. train.py reads every train*-shard present at start:
#    stage 1 saw train (30 h), stage 2 train + train-b (38 h), stages 3-4 all 44 h.
#  stage 1: 2 windows, 12 partials, 40 ms decision window        stop after the step-500 eval
$PY train.py --steps 2000 --out .data/runs/main
cp .data/runs/main/best.pt .data/v1-s500.pt
#  stage 2: + 64 ms window, 60 ms decision window (90 ms below C3)  stop after step 400
$PY train.py --steps 1600 --lr 2e-3 --eval-every 200 --wins 2048,1024,512 --k-onset 6 --k-bass 9 \
    --pos-weight 2 --init-from .data/v1-s500.pt --out .data/runs/v2
cp .data/runs/v2/last.pt .data/v2-s400.pt
#  stage 3: + partials 10, 12, 14, 16 (the bass)                   stop after step 200
$PY train.py --steps 1200 --lr 2e-3 --eval-every 200 --wins 2048,1024,512 --k-onset 6 --k-bass 9 \
    --pos-weight 2 --harm-ext 1 --init-from .data/v2-s400.pt --out .data/runs/v3
cp .data/runs/v3/last.pt .data/v3-s200.pt
#  stage 4: same model, resumed on a shorter schedule (to step 800)  runs to the end
$PY train.py --steps 800 --lr 2e-3 --eval-every 200 --wins 2048,1024,512 --k-onset 6 --k-bass 9 \
    --pos-weight 2 --harm-ext 1 --resume .data/v3-s200.pt --out .data/runs/v3b
cp .data/runs/v3b/best.pt .data/final.pt

# 5. Export, tune the decoder (thresholds, confidence calibration) on validation mixtures
#    of the TRAINING pianos, export again with it; choose the hybrid's rules the same way ~1 h
$PY export.py .data/final.pt .data/final.bin
$PY dump_val.py
node calibrate.mjs .data/final.bin --write .data/decoder.json
$PY export.py .data/final.pt ../../assets/models/piano-nn.bin .data/decoder.json
node eval_hybrid.mjs ../../assets/models/piano-nn.bin
cd ../..

# 5b. The hybrid's free-play arbiter (js/audio/nn/arbiter.js): record both engines on the
#     training pianos (the benchmark's material generator at other seeds on Salamander and, via
#     arbiter_dry.py, on MuseScore / FluidR3 / GeneralUser / Iowa / the synth; the validation
#     mixtures; noise clips at other seeds), then fit it                          ~45 min + ~1 h
node tools/nn/arbiter_rec.mjs dump-mats && tools/nn/.venv/bin/python tools/nn/arbiter_dry.py
for s in sal inst valmix noise; do node tools/nn/arbiter_rec.mjs $s; done
HIDDEN=8 node tools/nn/arbiter_fit.mjs fit --write    # -> js/audio/nn/arbiter-model.js
node tools/nn/arbiter_fit.mjs eval inst current       # replay offline, scored like the benchmark

# 6. Check: JS inference = PyTorch (parity fixture), then the benchmark (the judge)
node --test tests/nn-*.test.js
TRANSCRIBER=js/audio/nn/nn-transcriber.js node tests/bench-listen.js
TRANSCRIBER=js/audio/nn/hybrid-transcriber.js node tests/bench-listen.js
node tools/nn/compare.mjs dsp=a.json nn=b.json hybrid=c.json   # side by side
```

`NN_WEIGHTS=/path/to/file.bin` makes `nn-transcriber.js` load another weights file (Node only), so
a checkpoint can be benchmarked without replacing the shipped one:
`NN_WEIGHTS=tools/nn/.data/main.bin TRANSCRIBER=js/audio/nn/nn-transcriber.js QUICK=1 node tests/bench-listen.js`.

## Files

| file | what |
| --- | --- |
| `fetch_data.py` | downloads the instruments / noise, SoundFont 2 parser, builds 16 kHz sample banks |
| `dump_content.mjs` | the app's generator + song library as note lists; noise-sim clips |
| `content.py` | what is played: app pieces plus chords, octaves, both-hands chords, clusters, scales, arpeggios, trills, repeated notes, runs, pedal textures, note soup |
| `synth.py` | the sampler (velocity layers, pitch shift, loops, SF2 envelopes, dampers, pedal, sympathetic resonance) and the additive synth |
| `room.py` | synthetic room impulse responses, iPad-mic EQ curves |
| `make_data.py` | renders the clips into shards |
| `frontend.py` | the features (mirrored exactly by `js/audio/nn/frontend.js`) |
| `model.py` | the network (mirrored by `js/audio/nn/model.js`) |
| `train.py` | on-the-fly mixing (noise, EQ, level, clipping, metronome ticks), targets, loss, validation |
| `export.py` | batch-norm folding, float16 weights file, parity fixture |
| `dump_val.py`, `calibrate.mjs` | decoder thresholds and confidence calibration on validation mixtures |
| `eval_hybrid.mjs` | records both engines on the validation mixtures and replays the hybrid's (earlier, fixed) rules to choose them |
| `arbiter_rec.mjs`, `arbiter_dry.py` | record both engines' notes and the network's per-frame probabilities on the training pianos, for the arbiter |
| `arbiter_fit.mjs` | fits the hybrid's free-play arbiter (logistic + small tanh layer, thresholds), replays it offline exactly as the app runs it |
| `compare.mjs` | benchmark reports side by side |

The held-out benchmark pianos (Upright KW, YDP grand) are never read by anything here, except
`arbiter_rec.mjs heldout`, which records them for diagnosis only (nothing is fitted on it).
